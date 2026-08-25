export const JOURNAL_LAYOUT_RECIPES = [
  "center-fragment",
  "lower-left-float",
  "upper-right-block",
  "dual-panel",
  "irregular-cutout",
  "type-led",
  "dot-orbit",
  "single-specimen"
] as const;

export const JOURNAL_ACCENTS = [
  "cobalt",
  "tomato",
  "pear",
  "violet",
  "lemon",
  "cyan"
] as const;

export type JournalLayoutRecipe = typeof JOURNAL_LAYOUT_RECIPES[number];
export type JournalAccent = typeof JOURNAL_ACCENTS[number];

export const JOURNAL_TEXT_PLACEMENTS = ["right", "left", "below", "overlay"] as const;
export const JOURNAL_PHOTO_TREATMENTS = ["natural", "soft-xerox", "risograph", "torn-paper", "film-grain"] as const;
export const JOURNAL_TAPE_POSITIONS = ["none", "upper-left", "upper-center", "upper-right", "side"] as const;
export const JOURNAL_TYPOGRAPHY_MODES = ["archive-stack", "edge-caption", "fragmented-letters", "diagonal-note", "quiet-serif"] as const;
export const JOURNAL_TEXTURE_MODES = ["paper-fibers", "xerox-softness", "risograph-grain", "letterpress-bleed", "halftone", "scan-noise"] as const;
export const JOURNAL_ACCENT_FORMS = ["ink-block", "torn-strip", "stamp-circle", "brush-stroke"] as const;
export const JOURNAL_DECORATION_KINDS = ["route-line", "orbit", "registration-dots", "corner-marks", "underline", "botanical"] as const;

export interface JournalBlockPlacement {
  blockId: string;
  /** Page-local coordinates in percent; backend normalizes them into safe bounds. */
  page: "left" | "right";
  x: number;
  y: number;
  width: number;
  rotation: number;
  zIndex: number;
  textPlacement: typeof JOURNAL_TEXT_PLACEMENTS[number];
  photoTreatment: typeof JOURNAL_PHOTO_TREATMENTS[number];
  tapePosition: typeof JOURNAL_TAPE_POSITIONS[number];
}

export interface JournalDecoration {
  kind: typeof JOURNAL_DECORATION_KINDS[number];
  /** Page-local coordinates in percent. Decorations are kept outside the spine corridor. */
  page: "left" | "right";
  x: number;
  y: number;
  rotation: number;
  scale: number;
}

export interface JournalVisualDirection {
  typographyMode: typeof JOURNAL_TYPOGRAPHY_MODES[number];
  textureMode: typeof JOURNAL_TEXTURE_MODES[number];
  accentForm: typeof JOURNAL_ACCENT_FORMS[number];
  accentPage: "left" | "right";
  accentX: number;
  accentY: number;
  accentWidth: number;
  accentHeight: number;
  accentRotation: number;
  decorations: JournalDecoration[];
}

export interface JournalVisualAnalysis {
  blockId: string;
  subjectSummary: string;
  visualMood: string;
  dominantColors: string[];
  recommendedAccent: JournalAccent;
  focalRegion: string;
  negativeSpace: string[];
  safeTextAreas: string[];
  composition: string;
  illustrationIdea: string;
}

export interface JournalVisionImageInput {
  blockId: string;
  imageUrl: string;
}

export interface JournalLayoutBlockInput {
  id: string;
  kind: "photo-text" | "text";
  renderMode?: "original-photo" | "cutout-illustration" | "gathered-collage";
  title: string;
  text: string;
  placeName?: string;
  aspectRatio?: number;
  orientation?: "portrait" | "landscape" | "square";
  /** Zero-based order of the source walk moment; absent for freeform uploads. */
  journeyOrder?: number;
  journeyMomentId?: string;
  journeyBranch?: boolean;
  visual?: JournalVisualAnalysis;
}

export const JOURNAL_ILLUSTRATION_MODES = ["distilled-contour", "gathered-collage"] as const;
export type JournalIllustrationMode = typeof JOURNAL_ILLUSTRATION_MODES[number];
/** Generation support. gathered-collage remains in the legacy render union so
 * previously generated journals can still be displayed and deleted. */
export const JOURNAL_GENERATABLE_ILLUSTRATION_MODES = ["distilled-contour"] as const;

export const JOURNAL_ILLUSTRATION_STYLE_PRESETS = [
  "scene-distillation",
  "solid-color-block",
  "minimal-risograph",
  "xerox-photo-fragment",
  "old-print-illustration",
  "flat-silhouette"
] as const;
export type JournalIllustrationStylePreset = typeof JOURNAL_ILLUSTRATION_STYLE_PRESETS[number];
/** Presets exposed by the active generation workflow. The remaining values are
 * retained only so old saved requests can still be read safely. */
export const JOURNAL_GENERATABLE_ILLUSTRATION_STYLE_PRESETS = [
  "scene-distillation",
  "solid-color-block"
] as const;

export interface JournalLayoutRequest {
  title: string;
  city?: string;
  note?: string;
  routeStops?: string[];
  currentRecipes?: JournalLayoutRecipe[];
  currentPlacements?: JournalBlockPlacement[];
  narrativeMode?: "freeform" | "route-journey";
  blocks: JournalLayoutBlockInput[];
  images?: JournalVisionImageInput[];
}

export interface JournalSpreadPlan {
  id: string;
  blockIds: string[];
  recipe: JournalLayoutRecipe;
  /** A spread is two physical pages; a single cluster must never sit on the spine. */
  anchorPage?: "left" | "right" | "split";
  placements?: JournalBlockPlacement[];
  visualDirection?: JournalVisualDirection;
  accent: JournalAccent;
  headline: string;
  microtext: string;
  rationale: string;
}

export interface JournalLayoutResponse {
  mode: "ai" | "fallback";
  provider?: string;
  model?: string;
  aiCaption: string;
  spreads: JournalSpreadPlan[];
  vision?: {
    used: boolean;
    status: "used" | "unavailable" | "skipped";
    provider?: string;
    model?: string;
    analyzed: number;
    message?: string;
  };
}

export interface JournalIllustrationRequest {
  sourceImage: string;
  blockId: string;
  photoId: string;
  mode?: JournalIllustrationMode;
  title?: string;
  text?: string;
  placeName?: string;
  city?: string;
  /** Optional structural shortcut. Free-form styleDescription remains open-ended. */
  stylePresetId?: JournalIllustrationStylePreset;
  styleDescription?: string;
}

export interface JournalIllustrationResponse {
  assetId: string;
  imageUrl: string;
  provider: "volcengine-ark";
  model: string;
  prompt: string;
  styleDescription: string;
  mode: JournalIllustrationMode;
  workflow: {
    skill: string;
    version: "v1.3" | "v0.1";
    visionUsed: boolean;
    visionModel?: string;
    summary: string;
  };
  generatedAt: string;
  cached: boolean;
}
