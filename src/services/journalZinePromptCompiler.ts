import { JournalIllustrationMode, JournalIllustrationRequest } from "../types/journal";
import { JournalZineAnalysis, JournalZineCard } from "./journalZineAnalysisService";

export const JOURNAL_ZINE_WORKFLOWS = {
  "distilled-contour": { skill: "scene-distillation-zine", version: "v1.3" as const },
  "gathered-collage": { skill: "scenes-gathered-zine", version: "v1.3" as const }
} as const;

const DEFAULT_STYLE = "轻盈的旅行钢笔淡彩：松弛断续的手绘线、透明水彩晕染、少量彩铅和干燥印刷颗粒";

export interface JournalZinePromptResult {
  prompt: string;
  styleDescription: string;
  skill: string;
  version: "v1.3";
  summary: string;
}

function normalized(value: string | undefined, max: number): string {
  return (value ?? "").replace(/\s+/gu, " ").trim().slice(0, max);
}

function list(values: string[], fallback: string): string {
  return values.length ? values.join("；") : fallback;
}

function sharedFacts(card: JournalZineCard): string {
  return `【视觉分析卡：只作为事实约束】
语义核心：${card.semanticNucleus}
核心主体：${list(card.coreSubjects, "输入照片中最清晰的核心主体")}
辅助元素：${list(card.supportingElements, "无")}
不可改变的空间事实：${list(card.spatialInvariants, "保持主体数量、关系、朝向和地标识别结构")}
主导动作：${card.dominantGesture}
视觉重量：${card.visualWeight}
原生色板：${list(card.nativePalette, "沿用照片原生主色")}
可转化源形状：${list(card.sourceShapeCandidates, "核心主体外轮廓")}
安静区域：${list(card.quietAreas, "主体开放侧")}
最低语义保真：${card.semanticMinimum}`;
}

function contextLine(input: JournalIllustrationRequest): string {
  const value = [
    normalized(input.city, 80), normalized(input.placeName, 120),
    normalized(input.title, 160), normalized(input.text, 260)
  ].filter(Boolean).join(" · ");
  return value || "无额外旅行文字；严格依据输入照片";
}

function compileDistilled(input: JournalIllustrationRequest, analysis: JournalZineAnalysis, styleDescription: string): string {
  const card = analysis.card;
  return `[Runtime workflow: scene-distillation-zine-v1-3 / Natural isolated contour / Standard Accent]
[Visual Card: ${analysis.visionUsed ? `Ark ${analysis.visionModel ?? "vision"}` : "safe fallback"}]
目标：把参考照片蒸馏成一枚可直接落在旅行手账纸面上的原创轮廓插画资产。参考照片只提供语义证据，最终图像不得复制、嵌入、裁切、拼贴、描摹或保留任何摄影像素、照片矩形或写实区域。

${sharedFacts(card)}
材质与天气：${list(card.materialWeather, "手工纸张与干燥印刷痕迹")}
情绪残留：${card.emotionalResidue}
明确舍弃：${list(card.discardList, "无关背景、摄影细节、完整场景")}
转化机会：${list(card.transformationOpportunities, "主体轮廓转成断续墨线")}

【表达链】
表达命题：${card.expressiveProposition}
中心张力：${card.centralTension}
视觉隐喻：${card.visualMetaphor}
形式体现：只使用 ${card.formalGrammar} 这一种主语法；构图家族 ${card.compositionFamily}。
开放解释：${card.interpretiveOpening}

【生成规格】
只保留 2-4 个真实源事实，删除 65%-90% 的现实细节。画面 68%-85% 是连续安静的纸白，活跃主体簇只占 12%-32%，由一个主形体和 1-3 个辅助形体构成；不要完整描画原场景。主体边缘以 Natural isolated contour 直接接触纸面：自然、干净、有机，不得出现撕纸白边、贴纸轮廓、光晕、描边、厚重阴影、相框、矩形底板或地面投影。强调色只允许一种：${card.accentHue}，作用是${card.accentRole}，不得变成装饰噪音。
视觉风格附加方向：${styleDescription}。旅行语境：${contextLine(input)}。附加方向不能覆盖视觉分析卡中的人数、物体数量、姿态、相对关系和地标结构。

【透明提取安全区】
整个画布背景必须是单一、平坦、均匀的暖白色 #F4F0E6，无纸纹、无渐变、无噪点；主体不能碰画布四边。这层暖白只供服务端移除，绝不是相框。
严禁生成任何文字、字母、数字、标题、字幕、logo、胶带、书本、海报 mockup、UI、卡片、商业矢量图、卡通贴纸、3D 或全幅写实场景。最终只输出“原创插画 + 可移除的纯暖白背景”，网页中的手写文字将由独立、可编辑的 DOM 层完成。`;
}

function compileGathered(input: JournalIllustrationRequest, analysis: JournalZineAnalysis, styleDescription: string): string {
  const card = analysis.card;
  return `[Runtime workflow: scenes-gathered-zine-v1-3 / Source-derived illustration field]
[Visual Card: ${analysis.visionUsed ? `Ark ${analysis.visionModel ?? "vision"}` : "safe fallback"}]
目标：依据输入照片制作一个没有外框的拾景拼贴图像层，让真实照片锚点与从照片内部提取的原创插画场自然长在同一张暖白纸上。它不是照片卡片、相框、拍立得或现成模板。

${sharedFacts(card)}
抽象映射—保留：${list(card.abstractionRetain, "核心主体与一个地点线索")}
抽象映射—合并：${list(card.abstractionMerge, "重复的次要纹理")}
抽象映射—删去：${list(card.abstractionOmit, "无关背景和商业文字")}
抽象映射—转化：${list(card.abstractionTransform, "源轮廓转为插画节奏")}
抽象映射—露出：${list(card.abstractionExpose, "纸张负空间")}

【构图规格】
严格保留输入图的方向与核心主体事实。一个真实照片锚点约占画面 ${Math.round(card.photoAllocation)}%，源生插画场约占 ${Math.round(card.illustrationAllocation)}%，其余形成有效负空间；照片不得铺满画布。照片与纸张只沿一条手工纤维撕边相接：${card.tornEdgePlan}。这条过渡必须柔和、真实、非装饰性；禁止干净矩形蒙版、厚白边、贴纸描边、模糊光晕、假阴影、胶带、相框和卡片边界。
插画场从照片中真实可见的轮廓、色块、建筑线、植物节奏或运动方向生成，删除 60%-80% 细节，茂密纹理删除 85%-95%。全图只使用 ${card.gatheredGrammar} 一种抽象语法，布局家族 ${card.layoutFamily}。只新增一种从原照提取的高饱和色 ${card.accentHue}，并把它用于${card.accentRole}；不得添加与照片无关的花朵、星星、邮票、箭头或通用旅行贴纸。
整体纸面至少 55%-75% 保持安静，尤其保护这些区域：${list(card.quietAreas, "主体开放侧") }。视觉风格附加方向：${styleDescription}。旅行语境：${contextLine(input)}。附加方向不能虚构人物、建筑、天气、地点或经历。

【网页编辑适配】
输出是一张完整的不透明 PNG 纸面拼贴图像层，暖白纸色统一为 #F4F0E6，但不要生成外边框。严禁生成任何文字、乱码、标题、字母、数字、logo、海报 mockup、书本或 UI；手写标题与正文由网页的独立可编辑文字层排在图像开放侧，不能烘焙进图片。`;
}

export function compileJournalZinePrompt(
  input: JournalIllustrationRequest,
  mode: JournalIllustrationMode,
  analysis: JournalZineAnalysis
): JournalZinePromptResult {
  const styleDescription = normalized(input.styleDescription, 300) || DEFAULT_STYLE;
  const workflow = JOURNAL_ZINE_WORKFLOWS[mode];
  const prompt = mode === "gathered-collage"
    ? compileGathered(input, analysis, styleDescription)
    : compileDistilled(input, analysis, styleDescription);
  const summary = mode === "gathered-collage"
    ? `保留“${analysis.card.semanticNucleus}”的照片锚点，并用 ${analysis.card.gatheredGrammar} 源生插画场连接纸白`
    : `把“${analysis.card.semanticNucleus}”蒸馏为 ${analysis.card.formalGrammar} 的独立轮廓插画`;
  return { prompt, styleDescription, skill: workflow.skill, version: workflow.version, summary };
}
