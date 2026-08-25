export type ConstraintSource = "request" | "current_turn" | "llm" | "skill" | "recent_context" | "memory" | "derived" | "default";
export type ConstraintPriority = "hard" | "soft";

export type AgentIntent =
  | "route_create"
  | "route_modify"
  | "route_compare"
  | "route_review"
  | "poi_discovery"
  | "navigation_query"
  | "info_query"
  | "memory_query"
  | "history_query"
  | "preference_feedback"
  | "social_copy"
  | "general_chat";

export type AgentResponseKind = "route" | "comparison" | "information" | "memory" | "social_copy" | "chat";

export interface IntentClassification {
  intent: AgentIntent;
  confidence: number;
  reason: string;
}

export interface ContentSection {
  title: string;
  items: string[];
}

export type InformationSourceType = "official_api" | "official_link" | "unverified";

export interface InformationSource {
  title: string;
  url: string;
  domain: string;
  snippet?: string;
  sourceType: InformationSourceType;
  verificationReason: string;
  provider: "tavily" | "amap" | "venue_provider";
  retrievedAt: string;
  publishedAt?: string;
}

export interface ComparisonOption {
  name: string;
  metrics: Record<string, string>;
  pros: string[];
  cons: string[];
}

export interface RouteComparison {
  dimensions: string[];
  options: ComparisonOption[];
  recommendation: string;
  missingInformation?: string[];
}

export interface SocialCopyVariant {
  tone: string;
  text: string;
  hashtags: string[];
}

export type SocialCopyPlatform = "moments" | "xiaohongshu" | "weibo" | "caption" | "general";
export type SocialCopyStyleSource = "default" | "preset" | "custom" | "reference";

export interface SocialCopyStyleProfile {
  /** User-facing name. Custom natural-language wording is preserved here. */
  label: string;
  rawText: string;
  source: SocialCopyStyleSource;
  signature: {
    sentenceRhythm: string;
    narrativeMove: string;
    detailLens: string;
    diction: string;
    ending: string;
  };
  avoidances: string[];
}

export interface SocialCopyResult {
  variants: SocialCopyVariant[];
  basedOnRoute: boolean;
  platform?: SocialCopyPlatform;
  styleProfile?: SocialCopyStyleProfile;
  /** Present only when a generated candidate had to be replaced by the safe fallback. */
  generationDiagnostics?: {
    fallbackTriggered: boolean;
    fallbackVariants: Array<{
      variantIndex: number;
      tone: string;
      originalText?: string;
      reasons: string[];
      fallbackText: string;
    }>;
    regeneration?: {
      attempted: boolean;
      attempts: number;
      reasons: string[];
      exhausted: boolean;
    };
  };
}

export interface IntentResponsePayload {
  title: string;
  answer: string;
  sections: ContentSection[];
  comparison?: RouteComparison;
  socialCopy?: SocialCopyResult;
  /** Server-owned citations collected from tools. The LLM is not allowed to fabricate these. */
  sources?: InformationSource[];
}

export interface RouteWeatherSummary {
  summary: string;
  risk: "low" | "medium" | "high" | "unknown";
  rainProbability: number;
  /** False when no departure time was supplied or the target is outside the forecast horizon. */
  decisionUsable?: boolean;
  forecastKind?: "hourly" | "daily" | "unavailable";
  targetDate?: string;
  timeRange?: { start: string; end: string };
  airQuality?: { aqi: number; category: string };
  warning?: string;
  advice: string[];
}

export interface RouteOverview {
  title: string;
  city: string;
  startPoint: string;
  endPoint?: string;
  stopCount: number;
  partyLabel: string;
  time: {
    totalMinutes: number;
    travelMinutes: number;
    stayMinutes: number;
    startAt?: string;
    endAt?: string;
    precision?: TravelTimePrecision;
  };
  cost: {
    total: number;
    perPerson?: number;
    budget?: number;
  };
  weather: RouteWeatherSummary;
  importantNotes: string[];
  tradeoffs?: ConstraintTradeoff[];
}

/**
 * A transparent disclosure of a constraint conflict, compromise, or data
 * limitation.  The planner keeps hard constraints authoritative, but exposes
 * the resulting trade-off so the user can choose a different optimization
 * direction on the next turn.
 */
export interface ConstraintTradeoff {
  id: string;
  kind: "conflict" | "uncertainty";
  severity: "info" | "warning" | "critical";
  affectedConstraints: string[];
  issue: string;
  decision: string;
  alternatives: string[];
  userChoiceRequired: boolean;
}

export interface ConstraintLedgerEntry {
  path: string;
  value: unknown;
  source: ConstraintSource;
  priority: ConstraintPriority;
  sourceId?: string;
  sourceLabel?: string;
}

export interface PartyConstraints {
  total: number;
  adults?: number;
  children?: number;
  childAges?: number[];
  seniors?: number;
  stroller?: boolean;
  mobilityNeeds: string[];
}

export interface RouteExperienceConstraints {
  familyFriendly?: boolean;
  pace?: "relaxed" | "normal" | "intensive";
  restStopRequired?: boolean;
  restroomPreferred?: boolean;
  avoidCrowds?: boolean;
}

/** Hard accessibility requirements that must not be treated as style hints. */
export interface AccessibilityConstraints {
  wheelchairAccessRequired?: boolean;
  stepFreeRequired?: boolean;
  elevatorRequired?: boolean;
  accessibleRestroomRequired?: boolean;
  frequentRestRequired?: boolean;
}

/**
 * An open-ended semantic description of the requested route style.
 * Theme names deliberately remain strings: examples such as "romantic" or
 * "literary" must not become the boundary of what the agent can understand.
 */
export interface StyleTag {
  name: string;
  weight: number;
  evidence?: string;
}

export interface DesiredScene {
  description: string;
  importance: number;
  searchHints?: string[];
}

export interface StyleIntent {
  /** Relevant wording preserved from the user instead of reducing it to a label. */
  rawText: string;
  /** A short semantic interpretation generated by the model or fallback compiler. */
  summary: string;
  tags: StyleTag[];
  desiredScenes: DesiredScene[];
  /** Negative aesthetics or scene qualities, e.g. "too commercial". */
  avoidances: string[];
  /** Searchable place qualities/categories, not fabricated POI names. */
  searchHints: string[];
  /** Desired progression between stops, expressed as open natural-language stages. */
  narrativeArc: string[];
  confidence: number;
}

/** Input form accepted from clients; nested fields are intentionally partial. */
export interface StyleIntentInput {
  rawText?: string;
  summary?: string;
  tags?: Array<{ name: string; weight?: number; evidence?: string }>;
  desiredScenes?: Array<{ description: string; importance?: number; searchHints?: string[] }>;
  avoidances?: string[];
  searchHints?: string[];
  narrativeArc?: string[];
  confidence?: number;
}

export type AgentSkillActivation = "manual" | "recommended";
export type AgentSkillPriority = "preference" | "requirement";

/** User-authored Agent behavior stored server-side and selected per turn. */
export interface AgentSkill {
  id: string;
  userId: string;
  name: string;
  description: string;
  instruction: string;
  enabled: boolean;
  applicableIntents: AgentIntent[];
  activation: AgentSkillActivation;
  priority: AgentSkillPriority;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentSkillInput {
  id: string;
  name: string;
  description?: string;
  instruction: string;
  priority?: AgentSkillPriority;
  applicableIntents?: AgentIntent[];
  version?: number;
}

export interface AgentSkillExecution {
  skillId: string;
  name: string;
  version: number;
  status: "applied" | "partially_applied" | "skipped";
  appliedRules: string[];
  overriddenRules: string[];
  unsupportedRules: string[];
}

export type TravelTimePeriod = "morning" | "afternoon" | "evening" | "night";
export type TravelTimePrecision = "exact" | "period" | "date_only" | "unspecified";

/**
 * Absolute travel-time anchor used by weather, arrival scheduling and
 * multi-turn route modification. The product currently serves mainland-China
 * AMap routes, so Asia/Shanghai is the supported operational timezone.
 */
export interface TravelTemporalConstraint {
  timezone: "Asia/Shanghai";
  precision: TravelTimePrecision;
  visitDate?: string;
  startTime?: string;
  departureAt?: string;
  period?: TravelTimePeriod;
  sourceText?: string;
  inferred?: boolean;
}

export interface TravelTemporalInput {
  timezone?: "Asia/Shanghai";
  visitDate?: string;
  startTime?: string;
  departureAt?: string;
  period?: TravelTimePeriod;
  precision?: TravelTimePrecision;
  sourceText?: string;
  inferred?: boolean;
  /** Internal merge hint: a time-only phrase temporarily used today's date. */
  dateInferred?: boolean;
}

export interface UserConstraints {
  city: string;
  startPoint: string;
  durationMinutes?: number;   // undefined = no time limit
  budget?: number;            // undefined = no budget limit
  preferences: string[];
  peopleCount?: number;
  party: PartyConstraints;
  experience: RouteExperienceConstraints;
  accessibility: AccessibilityConstraints;
  style: StyleIntent;
  /** Controls how aggressively the planner looks beyond mainstream map results. */
  discoveryMode: PlaceDiscoveryMode;
  /** Orthogonal execution policy. `discoveryMode` remains as a legacy summary. */
  discoveryPolicy: PlaceDiscoveryPolicy;
  /** The planned departure date/time; never silently defaults to request time. */
  temporal: TravelTemporalConstraint;
  constraintLedger: ConstraintLedgerEntry[];
  transportMode?: "walk" | "transit" | "mixed";
  weatherPreference?: "avoid_rain" | "indoor_first" | "outdoor_ok";
  weatherRisk?: "low" | "medium" | "high";
  endPoint?: string;          // user-specified final destination
  maxLegMinutes?: number;     // max time per leg (walk/transit)
  /** True when preferences came from the current turn, not defaults or memory. */
  preferencesExplicit?: boolean;
  /** True when the value came from the current turn or recent thread context. */
  transportModeExplicit?: boolean;
  weatherPreferenceExplicit?: boolean;
  maxLegMinutesExplicit?: boolean;
  partyExplicit?: boolean;
  experienceExplicit?: boolean;
  styleExplicit?: boolean;
}

export interface PlanRequest {
  task?: string;
  /** Metadata only; uploaded binary content is handled by dedicated media APIs. */
  attachments?: string[];
  /** Skill identity is separate from task so it cannot alter intent routing. */
  activeSkillIds?: string[];
  /** Snapshot supplied by trusted clients; authenticated server records remain authoritative when available. */
  activeSkills?: AgentSkillInput[];
  city?: string;
  startPoint?: string;
  durationMinutes?: number;
  budget?: number;
  preferences?: string[];
  peopleCount?: number;
  party?: Partial<PartyConstraints>;
  experience?: RouteExperienceConstraints;
  accessibility?: AccessibilityConstraints;
  /** Optional structured style profile for advanced clients. Natural-language task is also parsed. */
  style?: StyleIntentInput;
  /** Raw open-ended style wording from a simple form field. */
  styleDescription?: string;
  /** reliable = map-only, balanced = web-assisted for styled routes, hidden_gems = actively seek niche places. */
  discoveryMode?: PlaceDiscoveryMode;
  /** Advanced clients can control source trust, novelty and exposure avoidance independently. */
  discoveryPolicy?: PlaceDiscoveryPolicyInput;
  /** Structured departure time. Natural-language task expressions are also normalized. */
  temporal?: TravelTemporalInput;
  transportMode?: "walk" | "transit" | "mixed";
  weatherPreference?: "avoid_rain" | "indoor_first" | "outdoor_ok";
  weatherRisk?: "low" | "medium" | "high";
  endPoint?: string;
  maxLegMinutes?: number;
  /** Frontend model selector: 'flash' = deepseek-v4-flash, 'pro' = deepseek-v4-pro */
  preferredModel?: "flash" | "pro";
  /** Memory scope. Memory is disabled for legacy requests without a userId. */
  userId?: string;
  /** Conversation scope used for recent-turn memory. */
  threadId?: string;
}

export interface RouteStop {
  name: string;
  category: PoiCategory;
  /** Broad operational kind plus an open provider/user-facing subtype. */
  kind?: PoiKind;
  subtype?: string;
  amapTypeCode?: string;
  estimatedCost: number;
  estimatedStayMinutes: number;
  reason: string;
  location?: string;
  address?: string;
  /** City reported by the POI provider, used to reject cross-city results. */
  city?: string;
  rating?: number;
  distanceMeters?: number;
  /** Group total at this stop. */
  estimatedCostPerPerson?: number;
  /** Constraint matches used to explain why this POI was selected. */
  suitabilityTags?: string[];
  /** Semantic reasons this stop contributes to the requested style. */
  styleMatches?: string[];
  /** Combined lexical/vector/LLM style relevance, normalized to 0..1. */
  styleScore?: number;
  styleConflicts?: string[];
  /** Where this place was first discovered; coordinates may still be verified by AMap. */
  discoverySource?: PoiDiscoverySource;
  verificationStatus?: PoiVerificationStatus;
  evidenceUrls?: string[];
  discoveryReasons?: string[];
  discoveryConfidence?: number;
  /** CityWalk-specific usefulness, normalized to 0..1. */
  cityWalkScore?: number;
  /** LLM 生成的费用明细，说明每一项开销来源 */
  costBreakdown?: string;
  /** LLM 生成的亮点描述，一句话说明该地点特色 */
  highlight?: string;
  /** LLM 生成的预约提醒，如"需提前3天在公众号预约"、"免预约直接进入" */
  bookingInfo?: string;
  /** Estimated schedule generated only when the trip has a departure time. */
  estimatedArrivalAt?: string;
  estimatedDepartureAt?: string;
}

export interface RouteLeg {
  origin: string;
  destination: string;
  originName?: string;
  destinationName?: string;
  distanceMeters: number;
  durationMinutes: number;
  mode: "walk" | "transit" | "bicycling";
  /** True when distance/time comes from a straight-line fallback rather than a routing API. */
  estimated?: boolean;
  /** Human-readable disclosure when the requested route mode or provider result had to fall back. */
  fallbackReason?: string;
  /** The two pins are the same place or adjacent entrances, so no road route is meaningful. */
  samePlaceTransfer?: boolean;
  estimatedDepartureAt?: string;
  estimatedArrivalAt?: string;
}

/**
 * Functional categories remain finite because routing constraints need stable
 * dwell-time and accessibility behavior.  The open `subtype` and `tags`
 * fields carry the real-world diversity instead of collapsing every unknown
 * place into `sight`.
 */
export type PoiCategory =
  | "bookstore"
  | "cafe"
  | "sight"
  | "museum"
  | "mall"
  | "park"
  | "restaurant"
  | "shop"
  | "market"
  | "studio"
  | "street_scene"
  | "event";

export type PoiKind = "business" | "culture" | "landscape" | "street_scene" | "event";
export type PoiDiscoverySource = "amap" | "web" | "curated" | "community" | "user";
export type PoiVerificationStatus = "verified" | "map_matched" | "unverified";
export type PlaceDiscoveryMode = "reliable" | "balanced" | "hidden_gems";

/**
 * Place discovery is intentionally split into independent axes. A user may
 * request a long-tail place while still requiring map-only verification, or
 * keep classic landmarks while avoiding overexposed restaurants.
 */
export type PlaceDiscoverySourcePolicy = "map_only" | "web_when_relevant" | "web_assisted";
export type PlaceNoveltyPreference = "mainstream" | "neutral" | "long_tail";
export type PlaceExposureScope = "all" | PoiCategory;
export type PlaceExposureStrength = "soft" | "strict";

export interface PlaceDiscoveryPolicy {
  sourcePolicy: PlaceDiscoverySourcePolicy;
  noveltyPreference: PlaceNoveltyPreference;
  avoidOverexposed: boolean;
  exposureScopes: PlaceExposureScope[];
  exposureStrength: PlaceExposureStrength;
}

export interface PlaceDiscoveryPolicyInput {
  sourcePolicy?: PlaceDiscoverySourcePolicy;
  noveltyPreference?: PlaceNoveltyPreference;
  avoidOverexposed?: boolean;
  exposureScopes?: PlaceExposureScope[];
  exposureStrength?: PlaceExposureStrength;
}

/** A place name explicitly extracted from public search evidence. */
export interface WebDiscoveredPlace {
  name: string;
  subtype?: string;
  tags: string[];
  evidence: string;
  sourceUrl: string;
  confidence: number;
}

export interface AgentPlanStep {
  id: string;
  description: string;
  toolHint: "weather" | "poi_search" | "route_plan" | "constraint_check";
  dependsOn: string[];
  status: "pending" | "running" | "completed" | "failed";
}

export type StateEventType = "PLAN" | "THINK" | "ACTION" | "OBS" | "REFLECT" | "RESULT" | "ERROR";

export interface StateEvent {
  event_type: StateEventType;
  step_id?: string;
  total_steps?: number;
  content: string;
  tool_call?: {
    tool: string;
    input?: Record<string, unknown>;
    output?: unknown;
  };
  timestamp: string;
  context_snapshot?: Record<string, unknown>;
}

export type TraceStepType = "thought" | "tool_call" | "tool_result" | "final_answer";

export interface TraceStep {
  type: TraceStepType;
  content?: string;
  tool?: string;
  input?: Record<string, unknown>;
  output?: unknown;
}

export interface AgentTrace {
  task: string;
  steps: TraceStep[];
  metadata: {
    model?: string;
    agent_version?: string;
    total_tokens?: number;
    response_time_ms?: number;
    agent_id?: string;
    [key: string]: unknown;
  };
}

export interface PlanningResult {
  /** Server-owned history identity, used by direct favorite operations. */
  historyId?: string;
  intent: IntentClassification;
  responseKind: AgentResponseKind;
  title: string;
  summary: string;
  /** Direct answer for non-route intents. Route facts live in routeOverview/stops/routeLegs. */
  answer?: string;
  sections?: ContentSection[];
  comparison?: RouteComparison;
  socialCopy?: SocialCopyResult;
  skillExecutions?: AgentSkillExecution[];
  sources?: InformationSource[];
  routeOverview?: RouteOverview;
  totalEstimatedCost: number;
  totalEstimatedMinutes: number;
  stops: RouteStop[];
  constraints: UserConstraints;
  routeLegs?: RouteLeg[];
  startLocation?: string;
  decisionLog: string[];
  planSteps?: AgentPlanStep[];
  events?: StateEvent[];
  trace?: AgentTrace;
  weatherRisk?: "low" | "medium" | "high";
  corrections?: string[];
  /** Explicit conflicts/compromises and the decision made by the planner. */
  tradeoffs?: ConstraintTradeoff[];
  memory?: {
    recalled: Array<{
      id: string;
      kind: "semantic" | "episodic" | "procedural";
      text: string;
      score: number;
      retrieval?: "lexical" | "vector" | "hybrid";
      lexicalScore?: number;
      vectorScore?: number;
    }>;
    learned?: Array<{
      event: "ADD" | "UPDATE" | "DELETE" | "NONE";
      key?: string;
      text?: string;
      reason: string;
    }>;
  };
}
