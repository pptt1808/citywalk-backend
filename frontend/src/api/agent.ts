// ─── API Types (mirrors backend src/types/plan.ts) ─────────────────────────

export type PoiCategory =
  | 'bookstore'
  | 'cafe'
  | 'sight'
  | 'museum'
  | 'mall'
  | 'park'
  | 'restaurant'
  | 'shop'
  | 'market'
  | 'studio'
  | 'street_scene'
  | 'event'

export type PlaceDiscoveryMode = 'reliable' | 'balanced' | 'hidden_gems'

export type AgentIntent =
  | 'route_create' | 'route_modify' | 'route_compare' | 'route_review'
  | 'poi_discovery' | 'navigation_query' | 'info_query' | 'memory_query'
  | 'history_query' | 'preference_feedback' | 'social_copy' | 'general_chat'
export type AgentSkillActivation = 'manual' | 'recommended'
export type AgentSkillPriority = 'preference' | 'requirement'
export interface AgentSkill {
  id: string
  userId?: string
  name: string
  description: string
  instruction: string
  enabled: boolean
  applicableIntents: AgentIntent[]
  activation: AgentSkillActivation
  priority: AgentSkillPriority
  version: number
  createdAt: string
  updatedAt: string
}
export interface AgentSkillInput {
  id: string
  name: string
  description?: string
  instruction: string
  priority?: AgentSkillPriority
  applicableIntents?: AgentIntent[]
  version?: number
}
export interface AgentSkillExecution {
  skillId: string
  name: string
  version: number
  status: 'applied' | 'partially_applied' | 'skipped'
  appliedRules: string[]
  overriddenRules: string[]
  unsupportedRules: string[]
}
export type AgentResponseKind = 'route' | 'comparison' | 'information' | 'memory' | 'social_copy' | 'chat'
export interface IntentClassification { intent: AgentIntent; confidence: number; reason: string }
export interface ContentSection { title: string; items: string[] }
export interface ComparisonOption { name: string; metrics: Record<string, string>; pros: string[]; cons: string[] }
export interface RouteComparison { dimensions: string[]; options: ComparisonOption[]; recommendation: string; missingInformation?: string[] }
export interface SocialCopyVariant { tone: string; text: string; hashtags: string[] }
export type SocialCopyPlatform = 'moments' | 'xiaohongshu' | 'weibo' | 'caption' | 'general'
export type SocialCopyStyleSource = 'default' | 'preset' | 'custom' | 'reference'
export interface SocialCopyStyleProfile {
  label: string
  rawText: string
  source: SocialCopyStyleSource
  signature: {
    sentenceRhythm: string
    narrativeMove: string
    detailLens: string
    diction: string
    ending: string
  }
  avoidances: string[]
}
export interface SocialCopyResult {
  variants: SocialCopyVariant[]
  basedOnRoute: boolean
  platform?: SocialCopyPlatform
  styleProfile?: SocialCopyStyleProfile
  generationDiagnostics?: {
    fallbackTriggered: boolean
    fallbackVariants: Array<{
      variantIndex: number
      tone: string
      originalText?: string
      reasons: string[]
      fallbackText: string
    }>
    regeneration?: {
      attempted: boolean
      attempts: number
      reasons: string[]
      exhausted: boolean
    }
  }
}
export type InformationSourceType = 'official_api' | 'official_link' | 'unverified'
export interface InformationSource {
  title: string
  url: string
  domain: string
  snippet?: string
  sourceType: InformationSourceType
  verificationReason: string
  provider: 'tavily' | 'amap' | 'venue_provider'
  retrievedAt: string
  publishedAt?: string
}
export interface RouteWeatherSummary {
  summary: string; risk: 'low' | 'medium' | 'high' | 'unknown'; rainProbability: number
  decisionUsable?: boolean; forecastKind?: 'hourly' | 'daily' | 'unavailable'; targetDate?: string
  timeRange?: { start: string; end: string }
  airQuality?: { aqi: number; category: string }; warning?: string; advice: string[]
}
export interface ConstraintTradeoff {
  id: string
  kind: 'conflict' | 'uncertainty'
  severity: 'info' | 'warning' | 'critical'
  affectedConstraints: string[]
  issue: string
  decision: string
  alternatives: string[]
  userChoiceRequired: boolean
}
export interface RouteOverview {
  title: string; city: string; startPoint: string; endPoint?: string; stopCount: number; partyLabel: string
  time: { totalMinutes: number; travelMinutes: number; stayMinutes: number; startAt?: string; endAt?: string; precision?: TravelTimePrecision }
  cost: { total: number; perPerson?: number; budget?: number }
  weather: RouteWeatherSummary; importantNotes: string[]; tradeoffs?: ConstraintTradeoff[]
}

export type ConstraintSource = 'request' | 'current_turn' | 'recent_context' | 'llm' | 'skill' | 'memory' | 'derived' | 'default'
export type ConstraintPriority = 'hard' | 'soft'

export interface ConstraintLedgerEntry {
  path: string
  value: unknown
  source: ConstraintSource
  priority: ConstraintPriority
  sourceId?: string
  sourceLabel?: string
}

export interface PartyConstraints {
  total: number
  adults?: number
  children?: number
  childAges?: number[]
  seniors?: number
  stroller?: boolean
  mobilityNeeds: string[]
}

export interface RouteExperienceConstraints {
  familyFriendly?: boolean
  pace?: 'relaxed' | 'normal' | 'intensive'
  restStopRequired?: boolean
  restroomPreferred?: boolean
  avoidCrowds?: boolean
}

export interface StyleTag {
  name: string
  weight: number
  evidence?: string
}

export interface DesiredScene {
  description: string
  importance: number
  searchHints?: string[]
}

export interface StyleIntent {
  rawText: string
  summary: string
  tags: StyleTag[]
  desiredScenes: DesiredScene[]
  avoidances: string[]
  searchHints: string[]
  narrativeArc: string[]
  confidence: number
}

export interface StyleIntentInput {
  rawText?: string
  summary?: string
  tags?: Array<{ name: string; weight?: number; evidence?: string }>
  desiredScenes?: Array<{ description: string; importance?: number; searchHints?: string[] }>
  avoidances?: string[]
  searchHints?: string[]
  narrativeArc?: string[]
  confidence?: number
}

export type PlaceDiscoverySourcePolicy = 'map_only' | 'web_when_relevant' | 'web_assisted'
export type PlaceNoveltyPreference = 'mainstream' | 'neutral' | 'long_tail'
export type PlaceExposureScope = 'all' | PoiCategory
export type PlaceExposureStrength = 'soft' | 'strict'

export interface PlaceDiscoveryPolicy {
  sourcePolicy: PlaceDiscoverySourcePolicy
  noveltyPreference: PlaceNoveltyPreference
  avoidOverexposed: boolean
  exposureScopes: PlaceExposureScope[]
  exposureStrength: PlaceExposureStrength
}

export type PlaceDiscoveryPolicyInput = Partial<PlaceDiscoveryPolicy>

export type TravelTimePeriod = 'morning' | 'afternoon' | 'evening' | 'night'
export type TravelTimePrecision = 'exact' | 'period' | 'date_only' | 'unspecified'
export interface TravelTemporalConstraint {
  timezone: 'Asia/Shanghai'
  precision: TravelTimePrecision
  visitDate?: string
  startTime?: string
  departureAt?: string
  period?: TravelTimePeriod
  sourceText?: string
  inferred?: boolean
}
export type TravelTemporalInput = Partial<TravelTemporalConstraint>

export interface UserConstraints {
  city: string
  startPoint: string
  durationMinutes?: number
  budget?: number
  preferences: string[]
  peopleCount?: number
  party: PartyConstraints
  experience: RouteExperienceConstraints
  style: StyleIntent
  discoveryMode: PlaceDiscoveryMode
  discoveryPolicy: PlaceDiscoveryPolicy
  temporal: TravelTemporalConstraint
  constraintLedger: ConstraintLedgerEntry[]
  transportMode?: 'walk' | 'transit' | 'mixed'
  weatherPreference?: 'avoid_rain' | 'indoor_first' | 'outdoor_ok'
  weatherRisk?: 'low' | 'medium' | 'high'
  endPoint?: string
  maxLegMinutes?: number
  preferencesExplicit?: boolean
  transportModeExplicit?: boolean
  weatherPreferenceExplicit?: boolean
  maxLegMinutesExplicit?: boolean
  partyExplicit?: boolean
  experienceExplicit?: boolean
  styleExplicit?: boolean
}

export interface RouteStop {
  name: string
  category: PoiCategory
  kind?: 'business' | 'culture' | 'landscape' | 'street_scene' | 'event'
  subtype?: string
  amapTypeCode?: string
  estimatedCost: number
  estimatedStayMinutes: number
  reason: string
  location?: string
  address?: string
  city?: string
  rating?: number
  distanceMeters?: number
  estimatedCostPerPerson?: number
  suitabilityTags?: string[]
  styleMatches?: string[]
  styleScore?: number
  styleConflicts?: string[]
  discoverySource?: 'amap' | 'web' | 'curated' | 'community' | 'user'
  verificationStatus?: 'verified' | 'map_matched' | 'unverified'
  evidenceUrls?: string[]
  discoveryReasons?: string[]
  discoveryConfidence?: number
  cityWalkScore?: number
  /** LLM 生成的费用明细，说明每一项开销来源 */
  costBreakdown?: string
  /** LLM 生成的亮点描述，一句话说明该地点特色 */
  highlight?: string
  /** LLM 生成的预约提醒 */
  bookingInfo?: string
  estimatedArrivalAt?: string
  estimatedDepartureAt?: string
}

export interface RouteLeg {
  origin: string
  destination: string
  originName?: string
  destinationName?: string
  distanceMeters: number
  durationMinutes: number
  mode: 'walk' | 'transit' | 'bicycling'
  estimated?: boolean
  fallbackReason?: string
  samePlaceTransfer?: boolean
  estimatedDepartureAt?: string
  estimatedArrivalAt?: string
}

export type StateEventType =
  | 'PLAN'
  | 'THINK'
  | 'ACTION'
  | 'OBS'
  | 'REFLECT'
  | 'RESULT'
  | 'ERROR'

export interface StateEvent {
  event_type: StateEventType
  step_id?: string
  total_steps?: number
  content: string
  tool_call?: {
    tool: string
    input?: Record<string, unknown>
    output?: unknown
  }
  timestamp: string
  context_snapshot?: Record<string, unknown>
}

export interface AgentPlanStep {
  id: string
  description: string
  toolHint: 'weather' | 'poi_search' | 'route_plan' | 'constraint_check'
  dependsOn: string[]
  status: 'pending' | 'running' | 'completed' | 'failed'
}

export type TraceStepType = 'thought' | 'tool_call' | 'tool_result' | 'final_answer'

export interface TraceStep {
  type: TraceStepType
  content?: string
  tool?: string
  input?: Record<string, unknown>
  output?: unknown
}

export interface AgentTrace {
  task: string
  steps: TraceStep[]
  metadata: {
    model?: string
    agent_version?: string
    total_tokens?: number
    response_time_ms?: number
    agent_id?: string
    [key: string]: unknown
  }
}

export interface PlanningResult {
  historyId?: string
  intent: IntentClassification
  responseKind: AgentResponseKind
  title: string
  summary: string
  answer?: string
  sections?: ContentSection[]
  comparison?: RouteComparison
  socialCopy?: SocialCopyResult
  skillExecutions?: AgentSkillExecution[]
  sources?: InformationSource[]
  routeOverview?: RouteOverview
  totalEstimatedCost: number
  totalEstimatedMinutes: number
  stops: RouteStop[]
  constraints: UserConstraints
  routeLegs?: RouteLeg[]
  startLocation?: string
  decisionLog: string[]
  planSteps?: AgentPlanStep[]
  events?: StateEvent[]
  trace?: AgentTrace
  weatherRisk?: 'low' | 'medium' | 'high'
  corrections?: string[]
  tradeoffs?: ConstraintTradeoff[]
  memory?: {
    recalled: Array<{
      id: string
      kind: 'semantic' | 'episodic' | 'procedural'
      text: string
      score: number
      retrieval?: 'lexical' | 'vector' | 'hybrid'
      lexicalScore?: number
      vectorScore?: number
    }>
    learned?: Array<{
      event: 'ADD' | 'UPDATE' | 'DELETE' | 'NONE'
      key?: string
      text?: string
      reason: string
    }>
  }
}

export interface PlanRequest {
  task?: string
  attachments?: string[]
  activeSkillIds?: string[]
  activeSkills?: AgentSkillInput[]
  city?: string
  startPoint?: string
  durationMinutes?: number
  budget?: number
  preferences?: string[]
  peopleCount?: number
  party?: Partial<PartyConstraints>
  experience?: RouteExperienceConstraints
  style?: StyleIntentInput
  styleDescription?: string
  discoveryMode?: PlaceDiscoveryMode
  discoveryPolicy?: PlaceDiscoveryPolicyInput
  temporal?: TravelTemporalInput
  transportMode?: 'walk' | 'transit' | 'mixed'
  weatherPreference?: 'avoid_rain' | 'indoor_first' | 'outdoor_ok'
  weatherRisk?: 'low' | 'medium' | 'high'
  endPoint?: string
  maxLegMinutes?: number
  /** 'flash' = deepseek-v4-flash (快速), 'pro' = deepseek-v4-pro (深思) */
  preferredModel?: 'flash' | 'pro'
  userId?: string
  threadId?: string
}

export type WalkAdjustmentReason = 'tired' | 'time_short' | 'rain' | 'crowded' | 'rest' | 'restroom' | 'custom' | 'deviation'
export interface WalkRouteRevision {
  id: string
  reason: WalkAdjustmentReason
  reasonLabel: string
  summary: string
  adjustedAt: string
  completedStopNames: string[]
  retainedStopNames: string[]
  removedStopNames: string[]
  addedStopNames: string[]
  remainingMinutes: number
  warnings: string[]
}
export interface WalkAdjustmentRequest {
  route: PlanningResult
  reason: WalkAdjustmentReason
  visitedStopNames: string[]
  skippedStopNames?: string[]
  currentLocation?: { lng: number; lat: number; accuracy?: number }
  remainingMinutes?: number
  customRequest?: string
}
export interface WalkAdjustmentResponse { route: PlanningResult; revision: WalkRouteRevision }

export interface WalkSyncSession<T> {
  walk: T
  version: number
  updatedAt: string
}

export type WalkBehaviorEventType =
  | 'walk_started' | 'moment_added' | 'stop_completed' | 'stop_skipped'
  | 'route_adjusted' | 'route_adjustment_undone' | 'walk_finished'

export interface WalkBehaviorEvent {
  eventId: string
  walkId: string
  eventType: WalkBehaviorEventType
  payload: Record<string, unknown>
  createdAt: string
}

export class WalkSyncConflictError<T> extends Error {
  constructor(readonly session: WalkSyncSession<T>) {
    super('其他设备已更新这段漫步')
    this.name = 'WalkSyncConflictError'
  }
}

// ─── API Fetch Helpers ───────────────────────────────────────────────────────

const BASE = import.meta.env.VITE_API_BASE ?? ''

async function request<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`[${res.status}] ${text}`)
  }
  return res.json() as Promise<T>
}

export async function apiCreatePlan(req: PlanRequest): Promise<PlanningResult> {
  return request<PlanningResult>('/api/plan', req)
}

export async function apiCreateTrace(req: PlanRequest): Promise<{ trace: AgentTrace }> {
  return request<{ trace: AgentTrace }>('/api/agent/trace', req)
}

async function requestWithMethod<T>(path: string, method: 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`[${res.status}] ${await res.text().catch(() => res.statusText)}`)
  return res.status === 204 ? undefined as T : await res.json() as T
}

export async function apiListSkills(): Promise<AgentSkill[]> {
  const res = await fetch(`${BASE}/api/skills`, { credentials: 'include' })
  if (!res.ok) throw new Error(`[${res.status}] ${await res.text().catch(() => res.statusText)}`)
  const payload = await res.json() as { entries?: AgentSkill[]; skills?: AgentSkill[] }
  return payload.entries ?? payload.skills ?? []
}

export async function apiCreateSkill(input: Omit<AgentSkill, 'userId' | 'createdAt' | 'updatedAt' | 'version'> & { id?: string; version?: number }): Promise<AgentSkill> {
  return request<AgentSkill>('/api/skills', input)
}

export async function apiUpdateSkill(id: string, patch: Partial<AgentSkill>): Promise<AgentSkill> {
  return requestWithMethod<AgentSkill>(`/api/skills/${encodeURIComponent(id)}`, 'PATCH', patch)
}

export async function apiDeleteSkill(id: string): Promise<void> {
  return requestWithMethod<void>(`/api/skills/${encodeURIComponent(id)}`, 'DELETE')
}

export async function apiAdjustWalkRoute(input: WalkAdjustmentRequest): Promise<WalkAdjustmentResponse> {
  const route = {
    ...input.route,
    events: undefined,
    trace: undefined,
    memory: undefined,
    planSteps: undefined
  }
  return request<WalkAdjustmentResponse>('/api/walks/adjust', { ...input, route })
}

export async function apiGetActiveWalk<T>(): Promise<{ session: WalkSyncSession<T> | null }> {
  const res = await fetch(`${BASE}/api/walks/active`, { credentials: 'include' })
  if (!res.ok) throw new Error('无法读取云端漫步记录')
  return res.json()
}

export async function apiSaveActiveWalk<T>(walk: T, baseVersion?: number): Promise<{ session: WalkSyncSession<T> }> {
  const res = await fetch(`${BASE}/api/walks/active`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ walk, baseVersion })
  })
  if (res.status === 409) {
    const conflict = await res.json() as { session: WalkSyncSession<T> }
    throw new WalkSyncConflictError(conflict.session)
  }
  if (!res.ok) {
    const payload = await res.json().catch(() => undefined) as { message?: string } | undefined
    throw new Error(payload?.message || '漫步记录同步失败')
  }
  return res.json()
}

export async function apiFinishActiveWalk(walkId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/walks/active/${encodeURIComponent(walkId)}/finish`, {
    method: 'POST', credentials: 'include'
  })
  if (!res.ok) throw new Error('云端漫步结束状态同步失败')
}

export async function apiRecordWalkEvent(event: WalkBehaviorEvent): Promise<void> {
  await request('/api/walks/events', event)
}

export interface MobileRouteHandoff {
  id: string
  route: PlanningResult
  source: 'web' | 'mobile' | 'demo'
  createdAt: string
  claimedAt?: string
}

export async function apiGetMobileRouteHandoff(): Promise<{ handoff: MobileRouteHandoff | null }> {
  const res = await fetch(`${BASE}/api/walks/handoff`, { credentials: 'include' })
  if (!res.ok) throw new Error('无法读取手机路线接力状态')
  return res.json()
}

export async function apiSendRouteToMobile(route: PlanningResult): Promise<{ handoff: MobileRouteHandoff }> {
  const cleanRoute = { ...route, events: undefined, trace: undefined, memory: undefined, planSteps: undefined }
  const res = await fetch(`${BASE}/api/walks/handoff`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ route: cleanRoute, source: 'web' })
  })
  if (!res.ok) {
    const payload = await res.json().catch(() => undefined) as { message?: string } | undefined
    throw new Error(payload?.message || '路线发送到手机失败')
  }
  return res.json()
}

export async function apiListSyncedJournals<T>(): Promise<{ entries: T[]; total: number }> {
  const res = await fetch(`${BASE}/api/journals`, { credentials: 'include' })
  if (!res.ok) throw new Error('无法读取移动端路线手账')
  return res.json()
}

export async function apiDeleteSyncedJournal(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/journals/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' })
  if (!res.ok && res.status !== 404) throw new Error('云端手账删除失败')
}

// ─── History ─────────────────────────────────────────────────────────────────

export interface HistoryEntry {
  id: string
  createdAt: string
  request: PlanRequest
  result: PlanningResult
}

export interface HistoryList {
  entries: HistoryEntry[]
  total: number
}

export async function apiListHistory(userId: string, limit = 20, offset = 0): Promise<HistoryList> {
  const query = new URLSearchParams({ userId, limit: String(limit), offset: String(offset) })
  const res = await fetch(`${BASE}/api/history?${query}`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to load history')
  return res.json()
}

export async function apiGetHistory(id: string, userId: string): Promise<HistoryEntry> {
  const res = await fetch(`${BASE}/api/history/${encodeURIComponent(id)}?userId=${encodeURIComponent(userId)}`, { credentials: 'include' })
  if (!res.ok) throw new Error('History entry not found')
  return res.json()
}

export async function apiDeleteHistory(id: string, userId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/history/${encodeURIComponent(id)}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE', credentials: 'include' })
  if (!res.ok) throw new Error('Failed to delete history entry')
}

// ─── Favorite routes (direct UI operation; never routed through the Agent) ──

export interface FavoriteRoute {
  id: string
  userId: string
  createdAt: string
  request?: PlanRequest
  result: PlanningResult
}

export async function apiListFavoriteRoutes(userId: string): Promise<{ entries: FavoriteRoute[]; total: number }> {
  const res = await fetch(`${BASE}/api/favorites?userId=${encodeURIComponent(userId)}`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to load favorite routes')
  return res.json()
}

export async function apiFavoriteRoute(userId: string, historyId: string): Promise<FavoriteRoute> {
  return request<FavoriteRoute>('/api/favorites', { userId, historyId })
}

export async function apiUnfavoriteRoute(id: string, userId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/favorites/${encodeURIComponent(id)}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE', credentials: 'include' })
  if (!res.ok) throw new Error('Failed to remove favorite route')
}

// ─── AI scrapbook layout ────────────────────────────────────────────────────

export type JournalLayoutRecipe =
  | 'center-fragment' | 'lower-left-float' | 'upper-right-block' | 'dual-panel'
  | 'irregular-cutout' | 'type-led' | 'dot-orbit' | 'single-specimen'
export type JournalAccent = 'cobalt' | 'tomato' | 'pear' | 'violet' | 'lemon' | 'cyan'
export interface JournalVisualDirection {
  typographyMode: 'archive-stack' | 'edge-caption' | 'fragmented-letters' | 'diagonal-note' | 'quiet-serif'
  textureMode: 'paper-fibers' | 'xerox-softness' | 'risograph-grain' | 'letterpress-bleed' | 'halftone' | 'scan-noise'
  accentForm: 'ink-block' | 'torn-strip' | 'stamp-circle' | 'brush-stroke'
  accentPage: 'left' | 'right'
  accentX: number
  accentY: number
  accentWidth: number
  accentHeight: number
  accentRotation: number
  decorations: Array<{
    kind: 'route-line' | 'orbit' | 'registration-dots' | 'corner-marks' | 'underline' | 'botanical'
    page: 'left' | 'right'
    x: number
    y: number
    rotation: number
    scale: number
  }>
}
export interface JournalBlockPlacement {
  blockId: string
  page: 'left' | 'right'
  x: number
  y: number
  width: number
  rotation: number
  zIndex: number
  textPlacement: 'right' | 'left' | 'below' | 'overlay'
  photoTreatment: 'natural' | 'soft-xerox' | 'risograph' | 'torn-paper' | 'film-grain'
  tapePosition: 'none' | 'upper-left' | 'upper-center' | 'upper-right' | 'side'
}

export interface JournalLayoutRequest {
  title: string
  city?: string
  note?: string
  routeStops?: string[]
  currentRecipes?: JournalLayoutRecipe[]
  currentPlacements?: JournalBlockPlacement[]
  narrativeMode?: 'freeform' | 'route-journey'
  images?: Array<{ blockId: string; imageUrl: string }>
  blocks: Array<{
    id: string
    kind: 'photo-text' | 'text'
    renderMode?: 'original-photo' | 'cutout-illustration' | 'gathered-collage'
    title: string
    text: string
    placeName?: string
    aspectRatio?: number
    orientation?: 'portrait' | 'landscape' | 'square'
    journeyOrder?: number
    journeyMomentId?: string
    journeyBranch?: boolean
  }>
}

export interface JournalLayoutResponse {
  mode: 'ai' | 'fallback'
  provider?: string
  model?: string
  aiCaption: string
  vision?: {
    used: boolean
    status: 'used' | 'unavailable' | 'skipped'
    provider?: string
    model?: string
    analyzed: number
    message?: string
  }
  spreads: Array<{
    id: string
    blockIds: string[]
    recipe: JournalLayoutRecipe
    anchorPage?: 'left' | 'right' | 'split'
    placements?: JournalBlockPlacement[]
    visualDirection?: JournalVisualDirection
    accent: JournalAccent
    headline: string
    microtext: string
    rationale: string
  }>
}

export async function apiGenerateJournalLayout(input: JournalLayoutRequest): Promise<JournalLayoutResponse> {
  return request<JournalLayoutResponse>('/api/journal/layout', input)
}

export interface JournalIllustrationRequest {
  sourceImage: string
  blockId: string
  photoId: string
  mode?: 'distilled-contour'
  title?: string
  text?: string
  placeName?: string
  city?: string
  stylePresetId?: 'scene-distillation' | 'solid-color-block'
  /** Open-ended natural language; UI presets are shortcuts, not an enum contract. */
  styleDescription?: string
}

export interface JournalIllustrationResponse {
  assetId: string
  imageUrl: string
  provider: 'volcengine-ark'
  model: string
  prompt: string
  styleDescription: string
  mode: 'distilled-contour' | 'gathered-collage'
  workflow: {
    skill: string
    version: 'v1.3' | 'v0.1'
    visionUsed: boolean
    visionModel?: string
    summary: string
  }
  generatedAt: string
  cached: boolean
}

export async function apiGenerateJournalIllustration(input: JournalIllustrationRequest): Promise<JournalIllustrationResponse> {
  return request<JournalIllustrationResponse>('/api/journal/illustrations', input)
}

export async function apiDeleteJournalIllustration(assetId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/journal/illustrations/${encodeURIComponent(assetId)}`, {
    method: 'DELETE',
    credentials: 'include'
  })
  if (!res.ok && res.status !== 404) throw new Error(`[${res.status}] ${await res.text().catch(() => res.statusText)}`)
}

// ─── Agent Memory ───────────────────────────────────────────────────────────

export type MemoryKind = 'semantic' | 'episodic' | 'procedural'

export interface MemoryItem {
  id: string
  userId: string
  kind: MemoryKind
  key: string
  text: string
  data: Record<string, unknown>
  city?: string
  polarity: 'positive' | 'negative' | 'neutral'
  confidence: number
  source: 'user_explicit' | 'user_feedback' | 'system_observed' | 'inferred'
  status: 'active' | 'deleted'
  createdAt: string
  updatedAt: string
}

export async function apiListMemories(userId: string, kind?: MemoryKind): Promise<{ entries: MemoryItem[]; total: number }> {
  const query = new URLSearchParams({ userId })
  if (kind) query.set('kind', kind)
  const res = await fetch(`${BASE}/api/memories?${query}`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to load memories')
  return res.json()
}

export async function apiDeleteMemory(id: string, userId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/memories/${encodeURIComponent(id)}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE', credentials: 'include' })
  if (!res.ok) throw new Error('Failed to delete memory')
}

export async function apiAddPlaceFeedback(input: {
  userId: string
  threadId?: string
  placeName: string
  poiId?: string
  city?: string
  sentiment: 'like' | 'dislike'
  tags?: string[]
  comment?: string
}): Promise<void> {
  await request('/api/memories/feedback/place', input)
}

// ─── Health ───────────────────────────────────────────────────────────────────

export interface HealthResponse {
  ok: boolean
  service: string
  timestamp: string
}

export async function apiHealth(): Promise<HealthResponse> {
  const res = await fetch(`${BASE}/api/health`, { credentials: 'include' })
  if (!res.ok) throw new Error('health check failed')
  return res.json()
}

// ─── SSE Streaming ──────────────────────────────────────────────────────────

export interface SseCallbacks {
  onEvents: (events: StateEvent[]) => void
  onResult: (result: PlanningResult) => void
  onError: (message: string) => void
}

function isPlanningResult(value: unknown): value is PlanningResult {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.title === 'string'
    && typeof candidate.summary === 'string'
    && typeof candidate.responseKind === 'string'
    && Array.isArray(candidate.stops)
}

export async function apiCreatePlanStream(req: PlanRequest, cbs: SseCallbacks, signal?: AbortSignal): Promise<void> {
  const res = await fetch(`${BASE}/api/agent/trace/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(req),
    signal,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`[${res.status}] ${text}`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''
  let currentEvent = ''
  let terminal = false
  let terminalError: string | undefined

  function processLine(line: string) {
    if (line.startsWith('event: ')) {
      currentEvent = line.slice(7).trim()
    } else if (line.startsWith('data: ')) {
      const data = line.slice(6)
      try {
        const parsed = JSON.parse(data)
        if (currentEvent === 'state') {
          cbs.onEvents(parsed.events ?? [])
        } else if (currentEvent === 'done') {
          if (!isPlanningResult(parsed.result)) throw new Error('Invalid done payload')
          terminal = true
          cbs.onResult(parsed.result)
        } else if (currentEvent === 'stream_error') {
          terminal = true
          terminalError = parsed.message ?? 'Stream error'
          cbs.onError(terminalError)
        }
      } catch {
        // skip unparseable lines
      }
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        processLine(line)
      }
    }
    // Flush remaining buffer after stream ends
    if (buffer.trim()) {
      processLine(buffer)
    }
    if (!terminal) throw new Error('SSE stream ended before a terminal event')
    if (terminalError) throw new Error(terminalError)
  } finally {
    reader.releaseLock()
  }
}
