import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import sharp from "sharp";
import { env } from "../config/env";
import { JournalIllustrationMode, JournalIllustrationRequest } from "../types/journal";
import { journalAssetStore, JournalIllustrationAsset } from "./journalAssetStore";
import { createFallbackJournalZineAnalysis, detectSourceOrientation, journalZineAnalysisService } from "./journalZineAnalysisService";
import { compileJournalZinePrompt, JOURNAL_ZINE_WORKFLOWS } from "./journalZinePromptCompiler";

interface ArkImagePayload {
  data?: Array<{ url?: string; b64_json?: string }>;
  error?: { code?: string; message?: string };
  code?: string;
  message?: string;
}

export class JournalIllustrationError extends Error {
  constructor(
    public readonly code: "NOT_CONFIGURED" | "INVALID_SOURCE" | "PROVIDER_ERROR" | "INVALID_OUTPUT" | "QUOTA_EXCEEDED" | "BUSY",
    message: string
  ) {
    super(message);
    this.name = "JournalIllustrationError";
  }
}

export interface JournalIllustrationResult {
  asset: JournalIllustrationAsset;
  cached: boolean;
  mode: JournalIllustrationMode;
  workflow: {
    skill: string;
    version: "v1.3" | "v0.1";
    visionUsed: boolean;
    visionModel?: string;
    summary: string;
  };
}

const inflight = new Map<string, Promise<JournalIllustrationResult>>();
const activeUsers = new Set<string>();
const legacyCutoutCache = new Map<string, Promise<Buffer>>();

function normalizeText(value: string | undefined, max: number): string {
  return (value ?? "").replace(/\s+/gu, " ").trim().slice(0, max);
}

/**
 * Seedream currently returns an opaque image even when the requested asset is
 * a paper cutout. Remove only the near-uniform paper color connected to the
 * canvas edges, then trim the transparent margin. Interior white details stay
 * intact because the flood fill cannot cross the drawn outline.
 */
export async function extractPaperCutout(bytes: Buffer): Promise<Buffer> {
  const decoded = await sharp(bytes).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = decoded.info;
  if (channels !== 4 || width < 8 || height < 8) return sharp(bytes).png().toBuffer();
  const pixels = decoded.data;
  const red: number[] = [];
  const green: number[] = [];
  const blue: number[] = [];
  const stride = Math.max(1, Math.floor(Math.min(width, height) / 180));
  const sample = (x: number, y: number) => {
    const offset = (y * width + x) * channels;
    red.push(pixels[offset]);
    green.push(pixels[offset + 1]);
    blue.push(pixels[offset + 2]);
  };
  for (let x = 0; x < width; x += stride) {
    sample(x, 0);
    sample(x, height - 1);
  }
  for (let y = 0; y < height; y += stride) {
    sample(0, y);
    sample(width - 1, y);
  }
  const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 244;
  const background = [median(red), median(green), median(blue)];
  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let head = 0;
  let tail = 0;
  const distanceAt = (index: number): number => {
    const offset = index * channels;
    const dr = pixels[offset] - background[0];
    const dg = pixels[offset + 1] - background[1];
    const db = pixels[offset + 2] - background[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };
  const enqueue = (index: number, threshold: number) => {
    if (visited[index] || distanceAt(index) > threshold) return;
    visited[index] = 1;
    queue[tail++] = index;
  };
  for (let x = 0; x < width; x += 1) {
    enqueue(x, 48);
    enqueue((height - 1) * width + x, 48);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width, 48);
    enqueue(y * width + width - 1, 48);
  }
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    if (x > 0) enqueue(index - 1, 68);
    if (x < width - 1) enqueue(index + 1, 68);
    if (index >= width) enqueue(index - width, 68);
    if (index < pixelCount - width) enqueue(index + width, 68);
  }
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let index = 0; index < pixelCount; index += 1) {
    const alphaOffset = index * channels + 3;
    if (visited[index]) {
      const distance = distanceAt(index);
      pixels[alphaOffset] = distance <= 38 ? 0 : Math.round(Math.min(1, (distance - 38) / 30) * 255);
    }
    if (pixels[alphaOffset] > 18) {
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return sharp(bytes).png().toBuffer();
  const padding = Math.max(8, Math.round(Math.max(width, height) * .025));
  const left = Math.max(0, minX - padding);
  const top = Math.max(0, minY - padding);
  const right = Math.min(width - 1, maxX + padding);
  const bottom = Math.min(height - 1, maxY + padding);
  return sharp(pixels, { raw: { width, height, channels } })
    .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
}

/** Mode-specific post-processing is deliberately separate: a distilled asset
 * needs alpha, while a gathered scene needs its warm paper field preserved. */
export async function prepareGeneratedIllustration(bytes: Buffer, mode: JournalIllustrationMode): Promise<Buffer> {
  return mode === "gathered-collage"
    ? sharp(bytes).rotate().flatten({ background: "#f4f0e6" }).png({ compressionLevel: 9, palette: false }).toBuffer()
    : extractPaperCutout(bytes);
}

function sourceBytes(dataUrl: string): Buffer {
  const matched = dataUrl.match(/^data:image\/(?:jpeg|jpg|png|webp);base64,([a-zA-Z0-9+/=]+)$/u);
  if (!matched) throw new JournalIllustrationError("INVALID_SOURCE", "原始照片格式不受支持");
  const bytes = Buffer.from(matched[1], "base64");
  if (!bytes.length || bytes.length > 8_000_000) {
    throw new JournalIllustrationError("INVALID_SOURCE", "原始照片为空或超过 8MB");
  }
  return bytes;
}

function outputMime(bytes: Buffer, header?: string | null): "image/jpeg" | "image/png" | "image/webp" {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (header === "image/png" || header === "image/jpeg" || header === "image/webp") return header;
  throw new JournalIllustrationError("INVALID_OUTPUT", "生图服务返回的内容不是受支持的图片");
}

function isPrivateOutputHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (host === "localhost" || host === "::1" || host.endsWith(".local")) return true;
  if (/^127\./u.test(host) || /^10\./u.test(host) || /^192\.168\./u.test(host)) return true;
  const match = host.match(/^172\.(\d{1,3})\./u);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

async function withTimeout<T>(
  timeoutMs: number,
  parentSignal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Seedream request timed out")), timeoutMs);
  timeout.unref?.();
  const abortParent = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener("abort", abortParent, { once: true });
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", abortParent);
  }
}

async function downloadOutput(urlValue: string, signal?: AbortSignal): Promise<{ bytes: Buffer; mimeType: string }> {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new JournalIllustrationError("INVALID_OUTPUT", "生图服务返回了无效图片地址");
  }
  if (url.protocol !== "https:" || isPrivateOutputHost(url.hostname)) {
    throw new JournalIllustrationError("INVALID_OUTPUT", "生图服务返回了不安全的图片地址");
  }
  return withTimeout(60_000, signal, async (downloadSignal) => {
    const response = await fetch(url, { signal: downloadSignal, redirect: "follow" });
    if (!response.ok) throw new JournalIllustrationError("INVALID_OUTPUT", `生成图片下载失败（HTTP ${response.status}）`);
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > env.JOURNAL_MAX_GENERATED_IMAGE_BYTES) {
      throw new JournalIllustrationError("INVALID_OUTPUT", "生成图片超过服务端保存限制");
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > env.JOURNAL_MAX_GENERATED_IMAGE_BYTES) {
      throw new JournalIllustrationError("INVALID_OUTPUT", "生成图片为空或超过服务端保存限制");
    }
    return { bytes, mimeType: outputMime(bytes, response.headers.get("content-type")?.split(";")[0]) };
  });
}

async function requestImage(input: JournalIllustrationRequest, prompt: string, signal?: AbortSignal): Promise<{ bytes: Buffer; mimeType: string }> {
  return withTimeout(env.ARK_IMAGE_TIMEOUT_MS, signal, async (requestSignal) => {
    const response = await fetch(`${env.ARK_BASE_URL.replace(/\/$/u, "")}/images/generations`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.ARK_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: env.ARK_IMAGE_MODEL,
        prompt,
        image: [input.sourceImage],
        sequential_image_generation: "disabled",
        response_format: "url",
        size: env.ARK_IMAGE_SIZE,
        stream: false,
        watermark: env.ARK_IMAGE_WATERMARK
      }),
      signal: requestSignal
    });
    const raw = await response.text();
    let payload: ArkImagePayload;
    try {
      payload = JSON.parse(raw) as ArkImagePayload;
    } catch {
      throw new JournalIllustrationError("PROVIDER_ERROR", `Seedream 返回了无效响应（HTTP ${response.status}）`);
    }
    if (!response.ok) {
      const message = payload.error?.message ?? payload.message ?? "图片生成请求失败";
      throw new JournalIllustrationError("PROVIDER_ERROR", `Seedream HTTP ${response.status}: ${message}`);
    }
    const first = payload.data?.[0];
    if (first?.url) return downloadOutput(first.url, requestSignal);
    if (first?.b64_json) {
      const bytes = Buffer.from(first.b64_json, "base64");
      if (!bytes.length || bytes.length > env.JOURNAL_MAX_GENERATED_IMAGE_BYTES) {
        throw new JournalIllustrationError("INVALID_OUTPUT", "生成图片为空或超过服务端保存限制");
      }
      return { bytes, mimeType: outputMime(bytes) };
    }
    throw new JournalIllustrationError("INVALID_OUTPUT", "Seedream 没有返回生成图片");
  });
}

export class JournalIllustrationService {
  isConfigured(): boolean {
    return Boolean(env.ARK_API_KEY && env.ARK_IMAGE_MODEL);
  }

  async transparentBytes(asset: JournalIllustrationAsset): Promise<Buffer> {
    if (asset.mimeType === "image/png") return fs.readFile(asset.filePath);
    const cached = legacyCutoutCache.get(asset.id);
    if (cached) return cached;
    const task = fs.readFile(asset.filePath).then(extractPaperCutout).catch((error) => {
      legacyCutoutCache.delete(asset.id);
      throw error;
    });
    legacyCutoutCache.set(asset.id, task);
    // Keep the compatibility cache bounded; new PNG assets bypass it.
    if (legacyCutoutCache.size > 16) {
      const oldest = legacyCutoutCache.keys().next().value as string | undefined;
      if (oldest && oldest !== asset.id) legacyCutoutCache.delete(oldest);
    }
    return task;
  }

  async generate(userId: string, input: JournalIllustrationRequest, signal?: AbortSignal): Promise<JournalIllustrationResult> {
    if (!this.isConfigured()) throw new JournalIllustrationError("NOT_CONFIGURED", "尚未配置 Seedream 图片生成服务");
    const bytes = sourceBytes(input.sourceImage);
    const mode: JournalIllustrationMode = input.mode ?? "distilled-contour";
    if (mode === "gathered-collage") {
      throw new JournalIllustrationError("INVALID_SOURCE", "极简纸刊生成已停用，请使用场景蒸馏");
    }
    const sourceHash = createHash("sha256").update(bytes).digest("hex");
    // Cache identity is based on source + user intent + workflow versions, not
    // on the vision model's prose. Repeating the same explicit generation must
    // not create a fresh billable image merely because analysis wording varies.
    const requestHash = createHash("sha256")
      .update(JSON.stringify({
        mode,
        compiler: "scene-distillation-zine-v1.3-runtime-4",
        context: {
          title: normalizeText(input.title, 160),
          text: normalizeText(input.text, 260),
          placeName: normalizeText(input.placeName, 120),
          city: normalizeText(input.city, 80),
          styleDescription: normalizeText(input.styleDescription, 300),
          stylePresetId: input.stylePresetId
        },
        visionModel: env.ARK_VISION_MODEL,
        imageModel: env.ARK_IMAGE_MODEL,
        size: env.ARK_IMAGE_SIZE,
        watermark: env.ARK_IMAGE_WATERMARK
      }))
      .digest("hex");
    const cacheKey = `${sourceHash}:${requestHash}`;
    const cached = journalAssetStore.getByCacheKey(userId, cacheKey);
    if (cached) {
      const workflow = JOURNAL_ZINE_WORKFLOWS[mode];
      const visionUsed = !cached.prompt.includes("[Visual Card: safe fallback]");
      return {
        asset: cached,
        cached: true,
        mode,
        workflow: {
          ...workflow,
          visionUsed,
          visionModel: visionUsed ? env.ARK_VISION_MODEL : undefined,
          summary: "已复用同一张照片的场景蒸馏结果"
        }
      };
    }

    const inflightKey = `${userId}:${cacheKey}`;
    const current = inflight.get(inflightKey);
    if (current) return current;
    if (activeUsers.has(userId)) {
      throw new JournalIllustrationError("BUSY", "当前已有一张插画正在生成，请完成后再试");
    }
    const rollingWindowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    if (journalAssetStore.countUsageSince(userId, rollingWindowStart) >= env.JOURNAL_IMAGE_DAILY_LIMIT) {
      throw new JournalIllustrationError("QUOTA_EXCEEDED", `过去 24 小时已达到 ${env.JOURNAL_IMAGE_DAILY_LIMIT} 张插画限额`);
    }
    activeUsers.add(userId);
    const task = (async (): Promise<JournalIllustrationResult> => {
      let analysis;
      try {
        analysis = await journalZineAnalysisService.analyze(bytes, input, mode, signal);
      } catch (error) {
        if (signal?.aborted) throw error;
        console.warn(`[JournalIllustration] zine visual analysis failed, continuing with safe card: ${error instanceof Error ? error.message : String(error)}`);
        const metadata = await sharp(bytes).metadata();
        analysis = createFallbackJournalZineAnalysis(
          mode,
          detectSourceOrientation(metadata.width, metadata.height, metadata.orientation)
        );
      }
      const compiled = compileJournalZinePrompt(input, mode, analysis);
      const { prompt, styleDescription } = compiled;
      const generated = await requestImage(input, prompt, signal);
      const outputBytes = await prepareGeneratedIllustration(generated.bytes, mode);
      const asset = journalAssetStore.save({
        userId,
        cacheKey,
        model: env.ARK_IMAGE_MODEL,
        prompt,
        styleDescription,
        mimeType: "image/png",
        bytes: outputBytes
      });
      return {
        asset,
        cached: false,
        mode,
        workflow: {
          skill: compiled.skill,
          version: compiled.version,
          visionUsed: analysis.visionUsed,
          visionModel: analysis.visionModel,
          summary: compiled.summary
        }
      };
    })().finally(() => {
      inflight.delete(inflightKey);
      activeUsers.delete(userId);
    });
    inflight.set(inflightKey, task);
    return task;
  }
}

export const journalIllustrationService = new JournalIllustrationService();
