import { randomUUID } from "node:crypto";
import { LlmRouter } from "../llm/llmRouter";
import { journalVisionService, JournalVisionResult } from "./journalVisionService";
import {
  JOURNAL_ACCENTS,
  JOURNAL_ACCENT_FORMS,
  JOURNAL_DECORATION_KINDS,
  JOURNAL_TEXTURE_MODES,
  JOURNAL_TYPOGRAPHY_MODES,
  JournalAccent,
  JournalBlockPlacement,
  JournalDecoration,
  JournalLayoutBlockInput,
  JournalLayoutRequest,
  JournalLayoutResponse,
  JournalSpreadPlan,
  JournalVisualDirection
} from "../types/journal";

function shortText(value: string, max: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function fallbackRecipe(blocks: JournalLayoutBlockInput[], spreadIndex: number): JournalSpreadPlan["recipe"] {
  if (blocks.length === 1) {
    const block = blocks[0];
    if (block.kind === "text") return "type-led";
    if (block.orientation === "portrait") return spreadIndex % 2 ? "upper-right-block" : "center-fragment";
    if (block.orientation === "landscape") return "lower-left-float";
    return "single-specimen";
  }
  if (blocks.length === 2) return spreadIndex % 3 === 2 ? "irregular-cutout" : "dual-panel";
  return spreadIndex % 2 ? "dot-orbit" : "irregular-cutout";
}

function partitionBlocks(blocks: JournalLayoutBlockInput[]): JournalLayoutBlockInput[][] {
  const groups: JournalLayoutBlockInput[][] = [];
  for (let index = 0; index < blocks.length;) {
    // Two editable story blocks are the safe visual limit of the fixed book
    // canvas. A third block gets its own spread instead of overflowing the page.
    const size = Math.min(2, blocks.length - index);
    groups.push(blocks.slice(index, index + size));
    index += size;
  }
  return groups;
}

function partitionJourneyBlocks(blocks: JournalLayoutBlockInput[]): JournalLayoutBlockInput[][] {
  const groups: JournalLayoutBlockInput[][] = [];
  let pending: JournalLayoutBlockInput[] = [];
  for (let index = 0; index < blocks.length;) {
    const momentId = blocks[index].journeyMomentId;
    const related: JournalLayoutBlockInput[] = [];
    while (index < blocks.length && momentId && blocks[index].journeyMomentId === momentId) related.push(blocks[index++]);
    if (!momentId) related.push(blocks[index++]);
    if (related.length > 1) {
      if (pending.length) groups.push(pending.splice(0));
      for (let offset = 0; offset < related.length; offset += 2) groups.push(related.slice(offset, offset + 2));
    } else {
      pending.push(related[0]);
      if (pending.length === 2) groups.push(pending.splice(0));
    }
  }
  if (pending.length) groups.push(pending);
  return groups;
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  const finite = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.round(Math.max(min, Math.min(max, finite)) * 10) / 10;
}

const VERTICAL_STAGGER_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [22, 36],
  [35, 23],
  [25, 40],
  [39, 26]
];

/** Keep paired page clusters from sitting on one mechanical baseline. */
function ensureVerticalRhythm(placements: JournalBlockPlacement[], spreadIndex: number): JournalBlockPlacement[] {
  if (placements.length !== 2 || Math.abs(placements[0].y - placements[1].y) >= 8) return placements;
  const [firstY, secondY] = VERTICAL_STAGGER_PAIRS[spreadIndex % VERTICAL_STAGGER_PAIRS.length];
  return placements.map((placement, index) => ({ ...placement, y: index === 0 ? firstY : secondY }));
}

function fallbackPlacements(blocks: JournalLayoutBlockInput[], spreadIndex: number): JournalBlockPlacement[] {
  const rotations = [-2.1, 1.7, -1.4, 2.4];
  const verticalPair = VERTICAL_STAGGER_PAIRS[spreadIndex % VERTICAL_STAGGER_PAIRS.length];
  return blocks.map((block, index) => {
    const page = blocks.length === 2 ? index === 0 ? "left" : "right" : spreadIndex % 2 ? "right" : "left";
    const width = block.kind === "text" ? 78 : block.orientation === "landscape" ? 80 : block.orientation === "portrait" ? 62 : 70;
    return {
      blockId: block.id,
      page,
      x: page === "left" ? 10 + spreadIndex % 3 * 2 : 12 + spreadIndex % 2 * 3,
      y: blocks.length === 2
        ? verticalPair[index]
        : block.orientation === "landscape" ? 38 : 25 + (spreadIndex % 3) * 5,
      width,
      rotation: rotations[(spreadIndex + index) % rotations.length],
      zIndex: index + 1,
      textPlacement: block.kind === "text" || block.orientation === "landscape" ? "below" : index % 2 ? "left" : "right",
      // Layout is geometry only. Original photos must never be silently
      // recolored; illustration generation is a separate, explicit action.
      photoTreatment: "natural",
      tapePosition: block.kind === "text" || block.renderMode === "cutout-illustration" || block.renderMode === "gathered-collage"
        ? "none"
        : index % 2 ? "upper-right" : "upper-left"
    };
  });
}

function fallbackVisualDirection(spreadIndex: number, anchorPage: JournalSpreadPlan["anchorPage"]): JournalVisualDirection {
  const emptyPage: JournalDecoration["page"] = anchorPage === "left" ? "right" : anchorPage === "right" ? "left" : spreadIndex % 2 ? "left" : "right";
  const accentPositions = [
    { x: 73, y: 18, width: 16, height: 5, rotation: -4 },
    { x: 10, y: 72, width: 13, height: 8, rotation: 6 },
    { x: 76, y: 64, width: 10, height: 10, rotation: -7 },
    { x: 9, y: 18, width: 18, height: 4, rotation: 3 }
  ];
  const accent = accentPositions[spreadIndex % accentPositions.length];
  const decorationKinds = JOURNAL_DECORATION_KINDS as readonly JournalDecoration["kind"][];
  return {
    typographyMode: JOURNAL_TYPOGRAPHY_MODES[spreadIndex % JOURNAL_TYPOGRAPHY_MODES.length],
    textureMode: JOURNAL_TEXTURE_MODES[spreadIndex % JOURNAL_TEXTURE_MODES.length],
    accentForm: JOURNAL_ACCENT_FORMS[spreadIndex % JOURNAL_ACCENT_FORMS.length],
    accentPage: emptyPage,
    accentX: accent.x,
    accentY: accent.y,
    accentWidth: accent.width,
    accentHeight: accent.height,
    accentRotation: accent.rotation,
    decorations: [
      { kind: decorationKinds[spreadIndex % decorationKinds.length], page: emptyPage, x: spreadIndex % 2 ? 18 : 70, y: spreadIndex % 2 ? 58 : 76, rotation: spreadIndex % 2 ? -8 : 7, scale: 1 },
      { kind: decorationKinds[(spreadIndex + 3) % decorationKinds.length], page: emptyPage === "left" ? "right" : "left", x: spreadIndex % 2 ? 78 : 13, y: 16 + spreadIndex % 3 * 7, rotation: spreadIndex % 2 ? 5 : -5, scale: .75 }
    ]
  };
}

function safeVisualDirection(
  raw: JournalVisualDirection | undefined,
  spreadIndex: number,
  anchorPage: JournalSpreadPlan["anchorPage"]
): JournalVisualDirection {
  const fallback = fallbackVisualDirection(spreadIndex, anchorPage);
  const typographyMode = JOURNAL_TYPOGRAPHY_MODES.includes(raw?.typographyMode as typeof JOURNAL_TYPOGRAPHY_MODES[number])
    ? raw!.typographyMode : fallback.typographyMode;
  const textureMode = JOURNAL_TEXTURE_MODES.includes(raw?.textureMode as typeof JOURNAL_TEXTURE_MODES[number])
    ? raw!.textureMode : fallback.textureMode;
  const accentForm = JOURNAL_ACCENT_FORMS.includes(raw?.accentForm as typeof JOURNAL_ACCENT_FORMS[number])
    ? raw!.accentForm : fallback.accentForm;
  const accentPage = raw?.accentPage === "left" || raw?.accentPage === "right" ? raw.accentPage : fallback.accentPage;
  const accentWidth = clamp(raw?.accentWidth, 7, 22, fallback.accentWidth);
  const accentHeight = clamp(raw?.accentHeight, 3, 14, fallback.accentHeight);
  const decorations = (raw?.decorations ?? []).slice(0, 3).flatMap((decoration): JournalDecoration[] => {
    if (!JOURNAL_DECORATION_KINDS.includes(decoration.kind as typeof JOURNAL_DECORATION_KINDS[number])) return [];
    return [{
      kind: decoration.kind,
      page: decoration.page === "right" ? "right" : "left",
      x: clamp(decoration.x, 6, 90, 50),
      y: clamp(decoration.y, 10, 88, 50),
      rotation: clamp(decoration.rotation, -24, 24, 0),
      scale: clamp(decoration.scale, .55, 1.5, 1)
    }];
  });
  return {
    typographyMode,
    textureMode,
    accentForm,
    accentPage,
    accentX: clamp(raw?.accentX, 5, 95 - accentWidth, fallback.accentX),
    accentY: clamp(raw?.accentY, 8, 90 - accentHeight, fallback.accentY),
    accentWidth,
    accentHeight,
    accentRotation: clamp(raw?.accentRotation, -14, 14, fallback.accentRotation),
    decorations: decorations.length ? decorations : fallback.decorations
  };
}

function safePlacements(
  input: JournalLayoutRequest,
  blockIds: string[],
  raw: JournalBlockPlacement[] | undefined,
  spreadIndex: number,
  anchorPage: JournalSpreadPlan["anchorPage"]
): JournalBlockPlacement[] {
  const blockMap = new Map(input.blocks.map((block) => [block.id, block]));
  const rawMap = new Map((raw ?? []).filter((placement) => blockIds.includes(placement.blockId)).map((placement) => [placement.blockId, placement]));
  const defaults = new Map(fallbackPlacements(blockIds.flatMap((id) => {
    const block = blockMap.get(id);
    return block ? [block] : [];
  }), spreadIndex).map((placement) => [placement.blockId, placement]));

  const placements: JournalBlockPlacement[] = blockIds.flatMap((blockId, index): JournalBlockPlacement[] => {
    const block = blockMap.get(blockId);
    const fallback = defaults.get(blockId);
    if (!block || !fallback) return [];
    const candidate = rawMap.get(blockId);
    const page: JournalBlockPlacement["page"] = blockIds.length === 2
      ? index === 0 ? "left" : "right"
      : candidate?.page === "left" || candidate?.page === "right"
        ? candidate.page
        : anchorPage === "right" ? "right" : "left";
    const width = clamp(candidate?.width, 50, 82, fallback.width);
    const generatedIllustration = block.renderMode === "cutout-illustration" || block.renderMode === "gathered-collage";
    const textPlacement: JournalBlockPlacement["textPlacement"] = generatedIllustration && candidate?.textPlacement === "overlay"
      ? "below"
      : candidate?.textPlacement ?? fallback.textPlacement;
    return [{
      blockId,
      page,
      x: clamp(candidate?.x, 6, 94 - width, fallback.x),
      y: clamp(candidate?.y, 20, 50, fallback.y),
      width,
      rotation: clamp(candidate?.rotation, -4, 4, fallback.rotation),
      zIndex: clamp(candidate?.zIndex, 1, 4, fallback.zIndex),
      textPlacement,
      photoTreatment: "natural",
      tapePosition: block.kind === "text" || generatedIllustration ? "none" : candidate?.tapePosition ?? fallback.tapePosition
    }];
  });
  return ensureVerticalRhythm(placements, spreadIndex);
}

function fallbackPlan(input: JournalLayoutRequest): JournalLayoutResponse {
  const accents = JOURNAL_ACCENTS as readonly JournalAccent[];
  const blockGroups = input.narrativeMode === "route-journey"
    ? partitionJourneyBlocks(input.blocks)
    : partitionBlocks(input.blocks);
  const spreads = blockGroups.map((blocks, index): JournalSpreadPlan => {
    const anchorPage: JournalSpreadPlan["anchorPage"] = blocks.length === 2 ? "split" : index % 2 ? "right" : "left";
    return {
      id: `spread_${randomUUID()}`,
      blockIds: blocks.map((block) => block.id),
      recipe: fallbackRecipe(blocks, index),
      anchorPage,
      placements: fallbackPlacements(blocks, index),
      visualDirection: fallbackVisualDirection(index, anchorPage),
      accent: accents[index % accents.length],
      headline: shortText(blocks.find((block) => block.title)?.title || input.title || "城市片段", 28),
      microtext: shortText([input.city, blocks.find((block) => block.placeName)?.placeName].filter(Boolean).join(" · ") || "CITYWALK ARCHIVE", 48),
      rationale: "依据图文数量与照片长宽比生成的本地 zine 版式"
    };
  });
  const places = input.routeStops?.slice(0, 3).join("、");
  return {
    mode: "fallback",
    aiCaption: shortText(input.note || (places ? `从${places}经过，把没有说完的城市片段留在纸上。` : "把路上的光、声音和停顿收进纸页。"), 180),
    spreads
  };
}

export function normalizeAiPlan(input: JournalLayoutRequest, response: JournalLayoutResponse): JournalLayoutResponse {
  const allowed = new Set(input.blocks.map((block) => block.id));
  const seen = new Set<string>();
  let spreads: JournalSpreadPlan[] = response.spreads.flatMap((spread, index): JournalSpreadPlan[] => {
    const blockIds = spread.blockIds.filter((id) => allowed.has(id) && !seen.has(id)).slice(0, 2);
    blockIds.forEach((id) => seen.add(id));
    let anchorPage: JournalSpreadPlan["anchorPage"] = blockIds.length === 2
      ? "split"
      : spread.anchorPage === "left" || spread.anchorPage === "right"
        ? spread.anchorPage
        : index % 2 ? "right" : "left";
    const placements = safePlacements(input, blockIds, spread.placements, index, anchorPage);
    if (blockIds.length === 1) anchorPage = placements[0]?.page ?? anchorPage;
    return blockIds.length ? [{
      ...spread,
      id: spread.id || `spread_${randomUUID()}`,
      blockIds,
      anchorPage,
      placements,
      visualDirection: safeVisualDirection(spread.visualDirection, index, anchorPage)
    }] : [];
  });
  const missing = input.blocks.filter((block) => !seen.has(block.id));
  if (missing.length) spreads.push(...fallbackPlan({ ...input, blocks: missing }).spreads);
  if (!spreads.length && input.blocks.length) return fallbackPlan(input);
  if (input.narrativeMode === "route-journey") {
    const sourceOrder = new Map(input.blocks.map((block, index) => [block.id, index]));
    const orderedBlocks = [...input.blocks].sort((left, right) => {
      const leftJourney = left.journeyOrder;
      const rightJourney = right.journeyOrder;
      if (leftJourney !== undefined || rightJourney !== undefined) {
        if (leftJourney === undefined) return 1;
        if (rightJourney === undefined) return -1;
        if (leftJourney !== rightJourney) return leftJourney - rightJourney;
      }
      return (sourceOrder.get(left.id) ?? 0) - (sourceOrder.get(right.id) ?? 0);
    });
    const placementById = new Map(spreads.flatMap((spread) => spread.placements ?? []).map((placement) => [placement.blockId, placement]));
    const spreadByBlock = new Map(spreads.flatMap((spread) => spread.blockIds.map((blockId) => [blockId, spread] as const)));
    spreads = partitionJourneyBlocks(orderedBlocks).map((blocks, index): JournalSpreadPlan => {
      const blockIds = blocks.map((block) => block.id);
      const anchorPage: JournalSpreadPlan["anchorPage"] = blocks.length === 2 ? "split" : index % 2 ? "right" : "left";
      const template = spreadByBlock.get(blockIds[0]) ?? spreads[index]
        ?? fallbackPlan({ ...input, blocks }).spreads[0];
      const rawPlacements = blockIds.flatMap((blockId) => {
        const placement = placementById.get(blockId);
        return placement ? [placement] : [];
      });
      return {
        ...template,
        id: template?.id || `spread_${randomUUID()}`,
        blockIds,
        anchorPage,
        placements: safePlacements(input, blockIds, rawPlacements, index, anchorPage),
        visualDirection: safeVisualDirection(template?.visualDirection, index, anchorPage),
        rationale: `按漫步顺序连接第 ${blocks[0].journeyOrder !== undefined ? blocks[0].journeyOrder + 1 : index * 2 + 1} 个沿途片段`
      };
    });
  }
  const previous = input.currentRecipes ?? [];
  const sameSequence = spreads.length === previous.length
    && spreads.every((spread, index) => spread.recipe === previous[index]);
  if (sameSequence && spreads.length) {
    const first = spreads[0];
    const alternate = first.blockIds.length === 2
      ? first.recipe === "dual-panel" ? "irregular-cutout" : "dual-panel"
      : first.recipe === "single-specimen" ? "center-fragment"
        : first.recipe === "center-fragment" ? "upper-right-block"
          : "single-specimen";
    spreads[0] = { ...first, recipe: alternate };
  }
  return { ...response, spreads };
}

export class JournalLayoutService {
  private readonly llm = new LlmRouter();

  async generate(input: JournalLayoutRequest, signal?: AbortSignal): Promise<JournalLayoutResponse> {
    const { images = [], ...layoutInput } = input;
    let vision: JournalVisionResult | undefined;
    let visionMessage: string | undefined;
    try {
      vision = await journalVisionService.analyze(images, signal);
    } catch (error) {
      console.warn(`[JournalLayout] vision analysis failed, continuing with metadata: ${error instanceof Error ? error.message : String(error)}`);
      visionMessage = error instanceof Error && /timed out|abort/iu.test(error.message)
        ? "视觉分析响应超时，已继续使用图文信息排版"
        : "视觉分析本次不可用，已继续使用图文信息排版";
    }
    const analysisById = new Map(vision?.analyses.map((analysis) => [analysis.blockId, analysis]) ?? []);
    const enrichedInput: JournalLayoutRequest = {
      ...layoutInput,
      blocks: layoutInput.blocks.map((block) => ({ ...block, visual: analysisById.get(block.id) }))
    };
    const visionInfo = {
      used: Boolean(vision?.analyses.length),
      status: (vision?.analyses.length ? "used" : images.length ? "unavailable" : "skipped") as "used" | "unavailable" | "skipped",
      provider: vision?.provider,
      model: vision?.model,
      analyzed: vision?.analyses.length ?? 0,
      message: visionMessage
    };
    if (!enrichedInput.blocks.length) return { ...fallbackPlan(enrichedInput), vision: visionInfo };
    try {
      const result = await this.llm.composeJournalLayout(enrichedInput, signal);
      if (!result) return { ...fallbackPlan(enrichedInput), vision: visionInfo };
      return { ...normalizeAiPlan(enrichedInput, {
        mode: "ai",
        provider: result.provider,
        model: result.model,
        aiCaption: result.data.aiCaption,
        spreads: result.data.spreads
      }), vision: visionInfo };
    } catch (error) {
      console.warn(`[JournalLayout] AI layout failed, using fallback: ${error instanceof Error ? error.message : String(error)}`);
      return { ...fallbackPlan(enrichedInput), vision: visionInfo };
    }
  }
}

export const journalLayoutService = new JournalLayoutService();
