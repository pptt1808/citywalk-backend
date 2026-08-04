import { z } from "zod";
import { env } from "../config/env";
import { JOURNAL_ACCENTS, JournalVisionImageInput, JournalVisualAnalysis } from "../types/journal";

interface ArkResponsesPayload {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  error?: { message?: string };
}

export interface JournalVisionResult {
  provider: "volcengine-ark";
  model: string;
  analyses: JournalVisualAnalysis[];
}

const flexibleStringList = (max: number, itemMax: number) => z.preprocess((value) => {
  const normalized = typeof value === "string"
    ? value.split(/[,，、;；\n]+/u).map((item) => item.trim()).filter(Boolean)
    : value;
  return Array.isArray(normalized) ? normalized.slice(0, max) : normalized;
}, z.array(z.string().trim().max(itemMax)).max(max).default([]));

const AnalysisSchema = z.object({
  blockId: z.string().trim().min(1).max(128),
  subjectSummary: z.string().trim().max(240).default("未识别到明确主体"),
  visualMood: z.string().trim().max(120).default("自然记录"),
  dominantColors: flexibleStringList(6, 40),
  recommendedAccent: z.enum(JOURNAL_ACCENTS).default("cobalt"),
  focalRegion: z.string().trim().max(80).default("center"),
  negativeSpace: flexibleStringList(6, 80),
  safeTextAreas: flexibleStringList(6, 80),
  composition: z.string().trim().max(240).default("主体居中"),
  illustrationIdea: z.string().trim().max(240).default("保留照片作为图像锚点")
});

const ResponseSchema = z.preprocess((value) => {
  if (Array.isArray(value)) return { images: value };
  return value;
}, z.object({ images: z.array(AnalysisSchema).max(8) }));

function outputText(payload: ArkResponsesPayload): string | undefined {
  if (payload.output_text?.trim()) return payload.output_text.trim();
  const parts = payload.output?.flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" || item.type === "text" || !item.type)
    .map((item) => item.text?.trim())
    .filter((item): item is string => Boolean(item)) ?? [];
  return parts.length ? parts.join("\n") : undefined;
}

function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}|\[[\s\S]*\]/u);
    if (!match) throw new Error("Ark vision response is not JSON");
    return JSON.parse(match[0]);
  }
}

export class JournalVisionService {
  isConfigured(): boolean {
    return Boolean(env.ARK_API_KEY);
  }

  async analyze(images: JournalVisionImageInput[], signal?: AbortSignal): Promise<JournalVisionResult | undefined> {
    if (!this.isConfigured() || !images.length) return undefined;
    const selected = images.slice(0, 8);
    const allowedIds = new Set(selected.map((image) => image.blockId));
    const content: Array<Record<string, string>> = [{
      type: "input_text",
      text: `你是旅行手账的视觉编辑。请逐张分析下面 ${selected.length} 张照片，只输出 JSON：{"images":[...]}。
每张结果必须使用给定 blockId，字段为 blockId、subjectSummary、visualMood、dominantColors、recommendedAccent、focalRegion、negativeSpace、safeTextAreas、composition、illustrationIdea。
negativeSpace 和 safeTextAreas 使用 top/upper-left/upper-right/center/left/right/lower-left/lower-right/bottom 等位置描述；recommendedAccent 只能是 ${JOURNAL_ACCENTS.join("、")}。subjectSummary 只描述真实可见主体，不推断人物身份或敏感属性。illustrationIdea 提炼一个可用于剪影、旧印刷插图或 risograph 图形的非敏感视觉锚点。不要提出强制裁剪原图。`
    }];
    selected.forEach((image, index) => {
      content.push({ type: "input_text", text: `图片 ${index + 1}，blockId=${image.blockId}` });
      content.push({ type: "input_image", image_url: image.imageUrl });
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("Ark vision request timed out")), env.ARK_VISION_TIMEOUT_MS);
    timeout.unref?.();
    const abortParent = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abortParent, { once: true });
    try {
      const response = await fetch(`${env.ARK_BASE_URL.replace(/\/$/u, "")}/responses`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.ARK_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: env.ARK_VISION_MODEL,
          // Visual editing is a structured extraction task. Disabling reasoning
          // cuts typical latency from ~14s to ~2s and prevents multi-image timeouts.
          thinking: { type: "disabled" },
          max_output_tokens: 2800,
          store: false,
          input: [{ role: "user", content }]
        }),
        signal: controller.signal
      });
      const payload = await response.json() as ArkResponsesPayload;
      if (!response.ok) throw new Error(`Ark vision HTTP ${response.status}: ${payload.error?.message ?? "request failed"}`);
      const text = outputText(payload);
      if (!text) throw new Error("Ark vision returned no output text");
      const parsed = ResponseSchema.parse(parseJson(text));
      const byId = new Map(parsed.images.filter((item) => allowedIds.has(item.blockId)).map((item) => [item.blockId, item]));
      return {
        provider: "volcengine-ark",
        model: env.ARK_VISION_MODEL,
        analyses: selected.flatMap((image) => {
          const analysis = byId.get(image.blockId);
          return analysis ? [analysis] : [];
        })
      };
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortParent);
    }
  }
}

export const journalVisionService = new JournalVisionService();
