import { createHash } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { env } from "../config/env";
import { JournalIllustrationMode, JournalIllustrationRequest } from "../types/journal";

interface ArkResponsesPayload {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  error?: { message?: string };
}

const flexibleList = (max: number, itemMax: number) => z.preprocess((value) => {
  const normalized = typeof value === "string"
    ? value.split(/[,，、;；\n]+/u).map((item) => item.trim()).filter(Boolean)
    : value;
  return Array.isArray(normalized) ? normalized.slice(0, max) : [];
}, z.array(z.string().trim().max(itemMax)).max(max).default([]));

const CardSchema = z.object({
  semanticNucleus: z.string().trim().max(180).default("旅途中最值得保留的真实瞬间"),
  coreSubjects: flexibleList(2, 100),
  supportingElements: flexibleList(3, 100),
  spatialInvariants: flexibleList(5, 120),
  dominantGesture: z.string().trim().max(140).default("主体形成清晰、可辨认的视觉动作"),
  visualWeight: z.string().trim().max(100).default("单一主视觉重量"),
  nativePalette: flexibleList(6, 40),
  sourceShapeCandidates: flexibleList(6, 100),
  quietAreas: flexibleList(5, 80),
  semanticMinimum: z.string().trim().max(180).default("保留核心主体与一个地点线索即可辨认"),
  materialWeather: flexibleList(4, 80),
  emotionalResidue: z.string().trim().max(140).default("一次克制、可回望的城市停顿"),
  discardList: flexibleList(8, 100),
  transformationOpportunities: flexibleList(5, 120),
  expressiveProposition: z.string().trim().max(180).default("用不完整的手工痕迹保留这个真实片刻"),
  centralTension: z.string().trim().max(140).default("现场的具体性与回忆的留白"),
  visualMetaphor: z.string().trim().max(140).default("一枚从旅途中留下的视觉碎片"),
  formalGrammar: z.enum([
    "cut-paper-mass", "dry-print-silhouette", "broken-contour", "rhythm-field",
    "fragment-stack", "orbit-drift"
  ]).catch("broken-contour"),
  compositionFamily: z.string().trim().max(80).default("asymmetric-isolated-cluster"),
  abstractionRetain: flexibleList(5, 100),
  abstractionMerge: flexibleList(5, 100),
  abstractionOmit: flexibleList(8, 100),
  abstractionTransform: flexibleList(5, 100),
  abstractionExpose: flexibleList(4, 100),
  gatheredGrammar: z.enum(["silhouette", "contour", "field", "rhythm", "cut-paper"]).catch("contour"),
  layoutFamily: z.string().trim().max(80).default("asymmetric-photo-illustration-field"),
  photoAllocation: z.coerce.number().min(25).max(60).catch(38),
  illustrationAllocation: z.coerce.number().min(40).max(70).catch(56),
  tornEdgePlan: z.string().trim().max(160).default("照片仅在一条不规则纤维撕边处过渡到插画场"),
  accentHue: z.string().trim().max(50).default("从照片中提取的一种高饱和色"),
  accentRole: z.string().trim().max(120).default("只用于连接主体、插画场与留白的结构节点"),
  interpretiveOpening: z.string().trim().max(160).default("保留足够纸白，让观看者补全未被画出的旅途")
});

export type JournalZineCard = z.infer<typeof CardSchema>;

export interface JournalZineAnalysis {
  mode: JournalIllustrationMode;
  visionUsed: boolean;
  visionModel?: string;
  card: JournalZineCard;
}

const analysisCache = new Map<string, Promise<JournalZineAnalysis>>();

function normalizedContext(input: JournalIllustrationRequest): string {
  return [input.city, input.placeName, input.title, input.text, input.styleDescription]
    .map((value) => (value ?? "").replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .join(" · ")
    .slice(0, 900);
}

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
    const match = trimmed.match(/\{[\s\S]*\}/u);
    if (!match) throw new Error("Ark zine analysis response is not JSON");
    return JSON.parse(match[0]);
  }
}

function baseFallback(): JournalZineCard {
  return CardSchema.parse({
    coreSubjects: ["输入照片中最清晰的核心主体"],
    supportingElements: ["一个能够确认地点或关系的真实线索"],
    spatialInvariants: ["保持人物或物体的数量、相对位置与朝向", "保持地标的识别结构"],
    nativePalette: ["输入照片的原生主色"],
    sourceShapeCandidates: ["核心主体外轮廓", "照片中重复出现的结构线"],
    quietAreas: ["主体开放侧", "画面边缘的低信息区域"],
    materialWeather: ["手工纸张", "干燥印刷痕迹"],
    discardList: ["无关远景", "摄影级细节", "矩形相框", "地面投影", "装饰性文字"],
    transformationOpportunities: ["把核心外轮廓转成断续墨线", "把局部色块转成纸片或孔版墨层"],
    abstractionRetain: ["主体数量", "相对位置", "最重要的识别轮廓"],
    abstractionMerge: ["相邻的次要纹理与重复结构"],
    abstractionOmit: ["不影响辨认的背景细节", "商业招牌文字", "摄影光斑"],
    abstractionTransform: ["建筑或植物线条转成简化节奏场"],
    abstractionExpose: ["主体开放侧的纸白"]
  });
}

export function createFallbackJournalZineAnalysis(mode: JournalIllustrationMode): JournalZineAnalysis {
  return { mode, visionUsed: false, card: baseFallback() };
}

function modeInstructions(mode: JournalIllustrationMode): string {
  if (mode === "gathered-collage") {
    return `本次执行 scenes-gathered-zine-v1-3 的 Scene Card。重点填写 abstractionRetain/abstractionMerge/abstractionOmit/abstractionTransform/abstractionExpose、gatheredGrammar、layoutFamily、photoAllocation、illustrationAllocation、tornEdgePlan、accentHue、accentRole。保留一个真实照片锚点，判断哪些源形状能延伸为插画场。`;
  }
  return `本次执行 scene-distillation-zine-v1-3 的 Distillation Card。重点填写 emotionalResidue、discardList、transformationOpportunities、expressiveProposition、centralTension、visualMetaphor、formalGrammar、compositionFamily、accentHue、accentRole、interpretiveOpening。照片只作为语义证据，判断最终原创插画应保留的 2-4 个源事实。`;
}

export class JournalZineAnalysisService {
  isConfigured(): boolean {
    return Boolean(env.ARK_API_KEY && env.ARK_VISION_MODEL);
  }

  async analyze(bytes: Buffer, input: JournalIllustrationRequest, mode: JournalIllustrationMode, signal?: AbortSignal): Promise<JournalZineAnalysis> {
    if (!this.isConfigured()) return createFallbackJournalZineAnalysis(mode);
    const context = normalizedContext(input);
    const key = createHash("sha256")
      .update(bytes)
      .update(JSON.stringify({ mode, context, model: env.ARK_VISION_MODEL, version: "zine-card-v1.3" }))
      .digest("hex");
    const existing = analysisCache.get(key);
    if (existing) return existing;

    const task = (async (): Promise<JournalZineAnalysis> => {
      const preview = await sharp(bytes).rotate().resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 78, mozjpeg: true })
        .toBuffer();
      const imageUrl = `data:image/jpeg;base64,${preview.toString("base64")}`;
      const prompt = `你是旅行独立杂志的视觉编辑。分析输入照片并只输出一个 JSON 对象，字段必须完全符合下列 Card：
semanticNucleus, coreSubjects(1-2), supportingElements(0-3), spatialInvariants, dominantGesture, visualWeight, nativePalette, sourceShapeCandidates, quietAreas, semanticMinimum, materialWeather,
emotionalResidue, discardList, transformationOpportunities, expressiveProposition, centralTension, visualMetaphor, formalGrammar, compositionFamily,
abstractionRetain, abstractionMerge, abstractionOmit, abstractionTransform, abstractionExpose, gatheredGrammar, layoutFamily, photoAllocation, illustrationAllocation, tornEdgePlan, accentHue, accentRole, interpretiveOpening。
${modeInstructions(mode)}
只写照片中真实可见的主体、数量、姿态、空间关系、色彩和材质，不猜测身份、年龄、地点或经历，不抄录招牌文字。coreSubjects 最多 2 个，supportingElements 最多 3 个；必须指出可删去 65%-90% 现实细节后仍能辨认的 semanticMinimum。formalGrammar 只能是 cut-paper-mass、dry-print-silhouette、broken-contour、rhythm-field、fragment-stack、orbit-drift；gatheredGrammar 只能是 silhouette、contour、field、rhythm、cut-paper。photoAllocation 25-60，illustrationAllocation 40-70。用户提供的文字语境只能帮助理解编辑意图，不能覆盖照片事实：${context || "无额外语境"}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error("Ark zine analysis timed out")), env.ARK_VISION_TIMEOUT_MS);
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
            thinking: { type: "disabled" },
            max_output_tokens: 3200,
            store: false,
            input: [{ role: "user", content: [
              { type: "input_image", image_url: imageUrl },
              { type: "input_text", text: prompt }
            ] }]
          }),
          signal: controller.signal
        });
        const payload = await response.json() as ArkResponsesPayload;
        if (!response.ok) throw new Error(`Ark zine analysis HTTP ${response.status}: ${payload.error?.message ?? "request failed"}`);
        const text = outputText(payload);
        if (!text) throw new Error("Ark zine analysis returned no output text");
        return {
          mode,
          visionUsed: true,
          visionModel: env.ARK_VISION_MODEL,
          card: CardSchema.parse(parseJson(text))
        };
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abortParent);
      }
    })().catch((error) => {
      analysisCache.delete(key);
      throw error;
    });
    analysisCache.set(key, task);
    if (analysisCache.size > 64) {
      const oldest = analysisCache.keys().next().value as string | undefined;
      if (oldest && oldest !== key) analysisCache.delete(oldest);
    }
    return task;
  }
}

export const journalZineAnalysisService = new JournalZineAnalysisService();
