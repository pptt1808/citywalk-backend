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
  spatialCue: z.string().trim().max(160).default("主体与环境之间最值得保留的一组方向或远近关系"),
  preservedAnchors: flexibleList(4, 120),
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
  compositionFamily: z.enum([
    "asymmetric-island", "torn-window", "directional-drift", "rhythmic-circulation",
    "staggered-fragments", "vertical-tension", "auxiliary-constellation"
  ]).catch("asymmetric-island"),
  edgeTreatment: z.enum([
    "torn-fiber", "layered-grayscale", "stippled-dissolution", "irregular-mark", "natural-isolated-contour"
  ]).catch("natural-isolated-contour"),
  secondaryEdgeTreatment: z.enum([
    "none", "torn-fiber", "layered-grayscale", "stippled-dissolution", "irregular-mark", "natural-isolated-contour"
  ]).catch("none"),
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
  accentForm: z.string().trim().max(100).default("不透明孔版墨或纸面色块"),
  accentPlacement: z.string().trim().max(120).default("位于视觉入口并与主形体接触或形成明确对位"),
  accentSourceRelation: z.string().trim().max(120).default("加强原图中有意义的小面积色彩或形成可信的温度对位"),
  accentValueContrast: z.string().trim().max(100).default("与暖白纸面和中性墨形成明确明度分离"),
  accentEyePath: z.string().trim().max(160).default("从强调色进入主体，沿主导方向移动，最后退出到纸白"),
  distributedAccentMotif: z.string().trim().max(120).default(""),
  typographyRole: z.string().trim().max(120).default("作为图像的克制反声，而不是说明性标题"),
  typographyBehavior: z.string().trim().max(180).default("根据视觉张力决定大小、方向、疏密与可读性"),
  typographyPlacement: z.string().trim().max(140).default("位于图像开放侧，并与主体保持有意义的间隔"),
  minimalLayoutFamily: z.enum([
    "center-fragment", "lower-left-float", "upper-right-block", "dual-panel",
    "irregular-cutout", "type-led", "dot-orbit", "single-specimen"
  ]).catch("lower-left-float"),
  minimalImageAnchor: z.enum([
    "tiny-faded-photo", "torn-paper-clipping", "flat-silhouette", "solid-color-block",
    "old-printed-illustration", "object-specimen", "translucent-geometric-overlay", "abstract-texture-window"
  ]).catch("old-printed-illustration"),
  minimalTypographyMode: z.enum([
    "fragmented-floating-letters", "phrase-against-image-edge", "archive-microtext",
    "diagonal-scattered-words", "gray-ghost-text", "headline-as-object",
    "text-inside-color-block", "almost-textless"
  ]).catch("phrase-against-image-edge"),
  minimalTextureMode: z.enum([
    "xerox-softness", "risograph-grain", "letterpress-ink-bleed", "halftone-degradation",
    "film-grain-photo", "scan-noise-paper-fibers", "aged-paper-mottling", "selected-text-motion-blur"
  ]).catch("xerox-softness"),
  minimalMoodMode: z.enum([
    "quiet", "summer", "solitude", "childhood", "seaside", "afternoon", "night", "memory", "slight-surrealism"
  ]).catch("memory"),
  interpretiveOpening: z.string().trim().max(160).default("保留足够纸白，让观看者补全未被画出的旅途")
});

export type JournalZineCard = z.infer<typeof CardSchema>;

export interface JournalZineAnalysis {
  mode: JournalIllustrationMode;
  sourceOrientation: "portrait" | "landscape" | "square";
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
    preservedAnchors: ["核心主体", "主导动作", "一处环境线索"],
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

export function createFallbackJournalZineAnalysis(
  mode: JournalIllustrationMode,
  orientation: JournalZineAnalysis["sourceOrientation"] = "square"
): JournalZineAnalysis {
  return { mode, sourceOrientation: orientation, visionUsed: false, card: baseFallback() };
}

export function isSolidColorBlockRequest(input: JournalIllustrationRequest): boolean {
  return input.stylePresetId === "solid-color-block"
    || [input.title, input.text, input.styleDescription].some((value) => value?.includes("单色块模式"));
}

export function minimalModeAllowsPhotoPixels(input: JournalIllustrationRequest): boolean {
  return input.stylePresetId === "xerox-photo-fragment";
}

export function resolveMinimalImageAnchor(
  input: JournalIllustrationRequest,
  suggested: JournalZineCard["minimalImageAnchor"] = "old-printed-illustration"
): JournalZineCard["minimalImageAnchor"] {
  if (input.stylePresetId === "xerox-photo-fragment") return "torn-paper-clipping";
  if (input.stylePresetId === "flat-silhouette") return "flat-silhouette";
  if (input.stylePresetId === "old-print-illustration") return "old-printed-illustration";
  if (input.stylePresetId === "minimal-risograph") {
    return suggested === "flat-silhouette" || suggested === "solid-color-block" || suggested === "old-printed-illustration"
      ? suggested
      : "old-printed-illustration";
  }
  // Custom prose and legacy requests default to a materially redrawn anchor.
  // Retaining source pixels must be an explicit UI choice, never an inference.
  return suggested === "flat-silhouette" || suggested === "solid-color-block" || suggested === "old-printed-illustration"
    ? suggested
    : "old-printed-illustration";
}

export function detectSourceOrientation(width?: number, height?: number, exifOrientation?: number): JournalZineAnalysis["sourceOrientation"] {
  if (!width || !height) return "square";
  const swap = exifOrientation === 5 || exifOrientation === 6 || exifOrientation === 7 || exifOrientation === 8;
  const displayWidth = swap ? height : width;
  const displayHeight = swap ? width : height;
  const ratio = displayWidth / displayHeight;
  if (ratio > 1.08) return "landscape";
  if (ratio < .92) return "portrait";
  return "square";
}

function modeInstructions(
  mode: JournalIllustrationMode,
  orientation: JournalZineAnalysis["sourceOrientation"],
  solidColorBlock: boolean,
  input: JournalIllustrationRequest
): string {
  if (mode === "gathered-collage") {
    const anchorRule = minimalModeAllowsPhotoPixels(input)
      ? "用户明确选择 xerox-photo-fragment：minimalImageAnchor 必须为 torn-paper-clipping，可保留一个经过主动裁切、复印退化的真实照片碎片。"
      : `用户没有选择照片碎片：摄影像素绝对禁止进入成品。minimalImageAnchor 只能在 old-printed-illustration、flat-silhouette、solid-color-block 中选择，快捷预设要求最终使用 ${resolveMinimalImageAnchor(input)}；必须重新绘制主体，而不是给原图加边框、滤镜或贴到纸上。`;
    return `本次严格执行 gc-minimal-zine-poster-v0-1 Standard Mode。原图方向为 ${orientation}，但此 skill 的最终纸面固定使用竖版 3:5。分别从 skill 的 Variation Engine 选择 minimalLayoutFamily、minimalTypographyMode、minimalTextureMode、minimalMoodMode，不得借用 scene-distillation 的 formalGrammar 代替。${anchorRule} 必须主动决定锚点处理和高饱和色作用。photoAllocation 与 illustrationAllocation 只表示小型视觉簇内部权重，整个视觉簇只占 8%-25%。`;
  }
  return `本次严格执行 scene-distillation-zine-v1-3。原图方向为 ${orientation}，最终比例应为 ${orientation === "landscape" ? "横版 5:3" : "竖版 3:5"}。照片只作语义证据，最终绝不能保留、裁切、拼贴、描摹或嵌入摄影像素。选择 2-4 个 preservedAnchors，并完整填写 expressiveProposition、centralTension、visualMetaphor、formalGrammar、compositionFamily、edgeTreatment、secondaryEdgeTreatment、accentHue、accentRole、accentForm、accentEyePath、distributedAccentMotif、typographyRole、typographyBehavior、typographyPlacement、interpretiveOpening。颜色模式为 ${solidColorBlock ? "精确触发的单色块模式" : "Standard Accent Mode"}。`;
}

export class JournalZineAnalysisService {
  isConfigured(): boolean {
    return Boolean(env.ARK_API_KEY && env.ARK_VISION_MODEL);
  }

  async analyze(bytes: Buffer, input: JournalIllustrationRequest, mode: JournalIllustrationMode, signal?: AbortSignal): Promise<JournalZineAnalysis> {
    const metadata = await sharp(bytes).metadata();
    const orientation = detectSourceOrientation(metadata.width, metadata.height, metadata.orientation);
    if (!this.isConfigured()) return { ...createFallbackJournalZineAnalysis(mode), sourceOrientation: orientation };
    const context = normalizedContext(input);
    const solidColorBlock = mode === "distilled-contour" && isSolidColorBlockRequest(input);
    const key = createHash("sha256")
      .update(bytes)
      .update(JSON.stringify({ mode, context, orientation, solidColorBlock, stylePresetId: input.stylePresetId, model: env.ARK_VISION_MODEL, version: "dual-zine-card-runtime-4" }))
      .digest("hex");
    const existing = analysisCache.get(key);
    if (existing) return existing;

    const task = (async (): Promise<JournalZineAnalysis> => {
      const preview = await sharp(bytes).rotate().resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 78, mozjpeg: true })
        .toBuffer();
      const imageUrl = `data:image/jpeg;base64,${preview.toString("base64")}`;
      const prompt = `你是旅行独立杂志的视觉编辑。分析输入照片并只输出一个 JSON 对象，字段必须完全符合下列 Card：
semanticNucleus, coreSubjects(1-2), supportingElements(0-3), spatialInvariants, spatialCue, preservedAnchors(2-4), dominantGesture, visualWeight, nativePalette, sourceShapeCandidates, quietAreas, semanticMinimum, materialWeather,
emotionalResidue, discardList, transformationOpportunities, expressiveProposition, centralTension, visualMetaphor, formalGrammar, compositionFamily, edgeTreatment, secondaryEdgeTreatment,
abstractionRetain, abstractionMerge, abstractionOmit, abstractionTransform, abstractionExpose, gatheredGrammar, layoutFamily, photoAllocation, illustrationAllocation, tornEdgePlan,
accentHue, accentRole, accentForm, accentEyePath, distributedAccentMotif, typographyRole, typographyBehavior, typographyPlacement, interpretiveOpening。
另外必须输出 accentPlacement, accentSourceRelation, accentValueContrast, minimalLayoutFamily, minimalImageAnchor, minimalTypographyMode, minimalTextureMode, minimalMoodMode。
${modeInstructions(mode, orientation, solidColorBlock, input)}
只写照片中真实可见的主体、数量、姿态、空间关系、色彩和材质，不猜测身份、年龄、地点或经历，不抄录招牌文字。coreSubjects 最多 2 个，supportingElements 最多 3 个，preservedAnchors 必须 2-4 个。expressiveProposition 必须具体说明作品让观看者感受或重新注意什么；centralTension 只选一组主要对立；visualMetaphor 只能来自原图物体、关系、材质或动作，不使用通用符号。formalGrammar 只能是 cut-paper-mass、dry-print-silhouette、broken-contour、rhythm-field、fragment-stack、orbit-drift；edgeTreatment 只能是 torn-fiber、layered-grayscale、stippled-dissolution、irregular-mark、natural-isolated-contour；secondaryEdgeTreatment 不需要时必须为 none；gatheredGrammar 只能是 silhouette、contour、field、rhythm、cut-paper。distributedAccentMotif 只有原图存在可重复且有意义的花、叶、果实、鸟、灯、石头、窗户或工具时才填写，否则为空字符串。photoAllocation 25-60，illustrationAllocation 40-70，它们只表示极简视觉簇内部比例。用户文字只能帮助理解表达意图，不能覆盖照片事实：${context || "无额外语境"}`;

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
            max_output_tokens: 4000,
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
        const card = CardSchema.parse(parseJson(text));
        return {
          mode,
          sourceOrientation: orientation,
          visionUsed: true,
          visionModel: env.ARK_VISION_MODEL,
          card: mode === "gathered-collage"
            ? { ...card, minimalImageAnchor: resolveMinimalImageAnchor(input, card.minimalImageAnchor) }
            : card
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
