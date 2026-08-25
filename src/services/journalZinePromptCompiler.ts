import { JournalIllustrationMode, JournalIllustrationRequest } from "../types/journal";
import {
  isSolidColorBlockRequest,
  JournalZineAnalysis,
  JournalZineCard,
  minimalModeAllowsPhotoPixels,
  resolveMinimalImageAnchor
} from "./journalZineAnalysisService";

export const JOURNAL_ZINE_WORKFLOWS = {
  "distilled-contour": { skill: "scene-distillation-zine-v1-3", version: "v1.3" as const },
  "gathered-collage": { skill: "gc-minimal-zine-poster-v0-1", version: "v0.1" as const }
} as const;

const DISTILLATION_STYLE = "触感平面纸刊插画：干墨、断续轮廓、纸纤维与克制印刷颗粒，所有形式服务于照片关系中发现的表达命题";
const MINIMAL_STYLE = "安静的日系与韩系独立杂志纸面：旧纸、复印柔化、孔版颗粒、实验性微型排印与一个明确高饱和色锚点";

export interface JournalZinePromptResult {
  prompt: string;
  styleDescription: string;
  skill: string;
  version: "v1.3" | "v0.1";
  summary: string;
}

function normalized(value: string | undefined, max: number): string {
  return (value ?? "").replace(/\s+/gu, " ").trim().slice(0, max);
}

function list(values: string[], fallback: string): string {
  return values.length ? values.join("；") : fallback;
}

function contextLine(input: JournalIllustrationRequest): string {
  const value = [
    normalized(input.city, 80), normalized(input.placeName, 120),
    normalized(input.title, 160), normalized(input.text, 260)
  ].filter(Boolean).join(" · ");
  return value || "无额外旅行文字，只依据参考照片";
}

function visionHeader(analysis: JournalZineAnalysis): string {
  return `[Visual Card: ${analysis.visionUsed ? `Ark ${analysis.visionModel ?? "vision"}` : "safe fallback"}]`;
}

function edgeDescription(card: JournalZineCard): string {
  const primary: Record<JournalZineCard["edgeTreatment"], string> = {
    "torn-fiber": "让源生方向上的不规则纸纤维成为插画与纸白之间的主要边界",
    "layered-grayscale": "沿源生边界叠放极窄的浅灰、中灰与克制炭黑纸层，不使用投影",
    "stippled-dissolution": "让稀疏网点与断裂颗粒沿原图运动方向消解到纸白中",
    "irregular-mark": "只用一至三个源生小形状延续边缘处的方向和节奏",
    "natural-isolated-contour": "让新绘制的有机轮廓直接接触纸面，不添加白边、光晕、贴纸描边或可见过渡效果"
  };
  const secondary = card.secondaryEdgeTreatment !== "none" && card.secondaryEdgeTreatment !== card.edgeTreatment
    ? `；仅在能澄清运动或层次时，辅以${primary[card.secondaryEdgeTreatment]}`
    : "";
  return `${primary[card.edgeTreatment]}${secondary}`;
}

function distillationColor(input: JournalIllustrationRequest, card: JournalZineCard): string {
  if (isSolidColorBlockRequest(input)) {
    return `Color mode: Solid Color-Block Mode. Use exactly one contiguous ${card.accentHue} field. Render every other printed form in neutral charcoal, graphite, warm gray, or off-black ink. Typography may use the neutral ink system and/or ${card.accentHue}, but no other chromatic color may appear anywhere. 这一连续色域以${card.accentForm}呈现，位于${card.accentPlacement}，占全幅约 3%-12% 或活跃簇的 25%-65%，作用是${card.accentRole}；不能拆成回声、圆点、条纹或多个色块。它与来源的关系是${card.accentSourceRelation}，并${card.accentValueContrast}。视线路径：${card.accentEyePath}。`;
  }
  const distributed = card.distributedAccentMotif
    ? `原图存在可信的可重复辅助元素“${card.distributedAccentMotif}”，把它以不同大小、间隔、方向和密度重新绘制成一套分布式强调；保持有意义的空缺，不能成为等距边框或彩纸屑。整套元素取代主色块与回声，不另加第二套颜色。`
    : "使用一个主要强调和至多两个更小回声；所有回声合计小于强调色总面积的 25%。";
  return `Color mode: Standard Accent Mode. 使用精确高饱和色“${card.accentHue}”，以${card.accentForm}执行${card.accentRole}，位于${card.accentPlacement}，总面积约占全幅 0.8%-3% 或活跃簇 10%-30%；它与来源的关系是${card.accentSourceRelation}，并${card.accentValueContrast}。${distributed} 视线路径：${card.accentEyePath}。不得把强调色描述为苍白、褪色、粉彩或低饱和，也不得出现第二种竞争性色彩。`;
}

function compileDistilled(input: JournalIllustrationRequest, analysis: JournalZineAnalysis, styleDescription: string): string {
  const card = analysis.card;
  const ratio = analysis.sourceOrientation === "landscape" ? "横版 5:3" : "竖版 3:5";
  const anchors = list(card.preservedAnchors, list(card.coreSubjects, "核心主体、主导动作与一处环境线索"));
  return `[Runtime workflow: scene-distillation-zine-v1-3 / ${isSolidColorBlockRequest(input) ? "Solid Color-Block Mode" : "Standard Accent Mode"}]\n${visionHeader(analysis)}\n\n` +
    `【1/5 表达及可见后果】表达命题：${card.expressiveProposition}。中心张力：${card.centralTension}。只使用一个来自原图的视觉隐喻：${card.visualMetaphor}。通过主体尺度、${card.dominantGesture}、${card.spatialCue}、间隔、遮挡与纸白把张力变成可见结构；让${card.interpretiveOpening}成为有意义而未被解释完的出口，删除一切只为了“显得艺术”的元素。\n\n` +
    `【2/5 画布与注意力几何】遵循原图 ${analysis.sourceOrientation} 方向，输出 ${ratio} 平面纸刊画布。保持 68%-85% 安静纸面，一个活跃插画簇占约 12%-32%，包含一个主形体、1-3 个辅助形体和一个克制纹理场；采用 ${card.compositionFamily}，根据“${card.visualWeight}”进行光学而非机械居中。视线从${card.accentEyePath}进入，经过主体关系，再退出到这些安静区域：${list(card.quietAreas, "主体开放侧与远离书脊的一侧")}。\n\n` +
    `【3/5 蒸馏主体与作者改写】参考照片仅作为 semantic reference。语义核心：${card.semanticNucleus}；只保留 2-4 个源锚点：${anchors}，并维持${list(card.spatialInvariants, "主体数量、关系与主导方向")}。删除约 65%-90% 描述性现实，明确舍弃：${list(card.discardList, "完整背景、冗余物体与写实细节")}。执行这些作者改写：${list(card.transformationOpportunities, "合并次要形体、夸张主导方向并把背景转成负空间")}。主语法只使用 ${card.formalGrammar}，最多辅以一种不竞争的语法；不得复制原照片构图、做滤镜、描摹或画成完整场景。\n\n` +
    `【4/5 边缘、颜色与可编辑排印】边缘：${edgeDescription(card)}，边界必须对应原图的动作、路径、压力或材质变化。${distillationColor(input, card)} 本产品中的标题与正文必须继续可编辑，因此不要把文字烘焙进位图；请在“${card.typographyPlacement}”保留能执行“${card.typographyRole}”的纸白，页面随后按“${card.typographyBehavior}”建立作者式排印。\n\n` +
    `【5/5 复制材质与硬性排除】${styleDescription}。整体应触感、平面、诗性且非商业：哑光吸墨纸、干墨、断线、纸纤维、复印或孔版颗粒、漫射光、低至中等对比。生成位图需要后续与可编辑手账合成，因此主体以外使用单一均匀暖白 #F4F0E6，纸纹集中在新绘插画内部。Do not reproduce, embed, crop, collage, trace, or retain photographic pixels or photorealistic regions from the reference. The final image must contain original illustration, paper, and typography only. For this editable-journal adaptation, typography is intentionally rendered later as DOM, so the generated raster contains original illustration and paper only. 严禁原照片碎片、照片窗口、写实区域、完整场景临摹、贴纸白边、模糊抠图光晕、通用符号、随机圆点或网格、胶带、印章、密集 scrapbook、广告层级、logo、CTA、光泽 mockup、卷纸、硬阴影、3D、电影光效、景深、霓虹、可爱卡通、动漫与水印。旅行语境：${contextLine(input)}。`;
}

const minimalAnchors: Record<JournalZineCard["minimalImageAnchor"], string> = {
  "tiny-faded-photo": "一小块经主动构图裁取的低对比照片局部",
  "torn-paper-clipping": "一个带不规则纤维撕边的照片或纸张裁片",
  "flat-silhouette": "一个从照片主体关系提炼出的平面剪影",
  "solid-color-block": "一个承载核心物体或关系的实色纸面块",
  "old-printed-illustration": "一个由源图主体重新绘制的旧印刷插图",
  "object-specimen": "一个从照片中分离出的物件标本",
  "translucent-geometric-overlay": "一处来自源图空间关系的半透明几何叠层",
  "abstract-texture-window": "一扇由照片局部纹理构成的抽象窗口"
};

const minimalTextures: Record<JournalZineCard["minimalTextureMode"], string> = {
  "xerox-softness": "复印柔化与轻微缺墨",
  "risograph-grain": "孔版颗粒与轻微套印偏移",
  "letterpress-ink-bleed": "凸版吸墨与克制墨晕",
  "halftone-degradation": "稀疏半调网点与局部退化",
  "film-grain-photo": "低对比旧照片颗粒",
  "scan-noise-paper-fibers": "扫描噪点与纸纤维",
  "aged-paper-mottling": "自然旧纸斑驳",
  "selected-text-motion-blur": "图像保持清楚，仅为随后排印预留一处可做文字运动模糊的开放边缘"
};

function compileMinimal(input: JournalIllustrationRequest, analysis: JournalZineAnalysis, styleDescription: string): string {
  const card = analysis.card;
  const allowsPhotoPixels = minimalModeAllowsPhotoPixels(input);
  const anchor = resolveMinimalImageAnchor(input, card.minimalImageAnchor);
  const anchorPolicy = allowsPhotoPixels
    ? `用户明确选择“复印照片碎片”：允许且只允许一个经过主动裁切的 source photo fragment。它必须明显经过灰阶复印、半调退化、缺墨与不规则纤维撕边处理，不能只是把完整原图缩小后贴在纸上。`
    : `Reference image is semantic evidence only. Do not reproduce, embed, crop, collage, trace, retain, or frame any photographic pixels or photorealistic region from it. 必须把主体重新绘制为${minimalAnchors[anchor]}，删除摄影光照、连续色调和写实纹理；严禁完整或局部原图、照片窗口、矩形照片、撕边照片、相框、滤镜照片与“照片贴在纸上”的效果。`;
  const supportInk = allowsPhotoPixels ? "纸张、照片和次要墨色" : "纸张、新绘插画和次要墨色";
  return `[Runtime workflow: gc-minimal-zine-poster-v0-1 / Standard Mode / ${allowsPhotoPixels ? "explicit-photo-fragment" : "material-redraw"}]\n${visionHeader(analysis)}\n\n` +
    `竖版 3:5 手机纸刊画布，满幅自然旧纸，无边框、无 mockup。70%-90% 是连续纸白，一个视觉簇只占约 8%-25%，采用 ${card.minimalLayoutFamily} 并位于中央、上中、下中、左下或右上但不贴边；用光学平衡决定位置，不得让照片或插画铺满画布。\n\n` +
    `把参考照片的语义核心“${card.semanticNucleus}”转成唯一图像锚点：${minimalAnchors[anchor]}。${anchorPolicy} 只能保留一个主视觉关系：${list(card.coreSubjects, "最清晰主体")}；保留${list(card.abstractionRetain, card.semanticMinimum)}，合并${list(card.abstractionMerge, "重复次要纹理")}并删除${list(card.abstractionOmit, "无关背景和商业文字")}。锚点以${minimalTextures[card.minimalTextureMode]}融入纸面，不得成为完整场景。\n\n` +
    `排印轴选择 ${card.minimalTypographyMode}：位于${card.typographyPlacement}的纸白留给网页可编辑文字，并按${card.typographyBehavior}形成稀疏编辑关系；图片内不要生成文字。${supportInk}保持灰黑与低对比，只使用一种明确高饱和色“${card.accentHue}”，以${card.accentForm}承担${card.accentRole}，置于${card.accentPlacement}；高饱和区域占全幅约 0.8%-2.5%，或视觉簇内部 15%-35%，缩略图中也必须可见。${styleDescription}是结构化预设对应的材料方向，必须落实，但不能削弱主色、增加第二主色或扩大成商业海报。\n\n` +
    `最终呈现为 ${card.minimalMoodMode} 情绪的平放扫描哑光纸刊：${minimalTextures[card.minimalTextureMode]}、漫射光、低至中等对比、无硬阴影和三维深度。避免全幅场景、商业标题、产品广告、logo、CTA、干净 UI 白底、光泽纸 mockup、3D、电影光效、霓虹、可爱卡通、动漫、时尚大片、密集 scrapbook、过多对象、贴纸、颜色和装饰纹理；网页会独立渲染可编辑标题与正文。旅行语境：${contextLine(input)}。`;
}

export function compileJournalZinePrompt(
  input: JournalIllustrationRequest,
  mode: JournalIllustrationMode,
  analysis: JournalZineAnalysis
): JournalZinePromptResult {
  const workflow = JOURNAL_ZINE_WORKFLOWS[mode];
  const styleDescription = normalized(input.styleDescription, 300) || (mode === "distilled-contour" ? DISTILLATION_STYLE : MINIMAL_STYLE);
  const prompt = mode === "gathered-collage"
    ? compileMinimal(input, analysis, styleDescription)
    : compileDistilled(input, analysis, styleDescription);
  const summary = mode === "gathered-collage"
    ? `以 gc-minimal-zine 的单锚点纸面语法重新编排“${analysis.card.semanticNucleus}”`
    : `以 scene-distillation 的表达链把“${analysis.card.semanticNucleus}”蒸馏为无摄影像素的原创插画`;
  return { prompt, styleDescription, skill: workflow.skill, version: workflow.version, summary };
}
