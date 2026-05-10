// ─── API Types (mirrors backend src/types/plan.ts) ─────────────────────────

export type PoiCategory =
  | 'bookstore'
  | 'cafe'
  | 'sight'
  | 'museum'
  | 'mall'
  | 'park'
  | 'restaurant'

export interface RouteStop {
  name: string
  category: PoiCategory
  estimatedCost: number
  estimatedStayMinutes: number
  reason: string
  location?: string
  address?: string
  rating?: number
  distanceMeters?: number
  /** LLM 生成的费用明细，说明每一项开销来源 */
  costBreakdown?: string
  /** LLM 生成的亮点描述，一句话说明该地点特色 */
  highlight?: string
}

export interface RouteLeg {
  origin: string
  destination: string
  distanceMeters: number
  durationMinutes: number
  mode: 'walk' | 'transit' | 'bicycling'
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

export interface TraceStep {
  step_type: 'thought' | 'tool_call' | 'tool_result' | 'final_answer'
  content: string
  tool?: string
  tool_input?: Record<string, unknown>
  tool_output?: unknown
  timestamp: string
}

export interface AgentTrace {
  trace_id: string
  query: string
  steps: TraceStep[]
  final_answer: string
  metadata: {
    model: string
    total_tokens?: number
    duration_ms?: number
    tool_calls_count?: number
    corrections_count?: number
  }
}

export interface PlanningResult {
  summary: string
  totalEstimatedCost: number
  totalEstimatedMinutes: number
  stops: RouteStop[]
  routeLegs?: RouteLeg[]
  startLocation?: string
  decisionLog: string[]
  planSteps?: AgentPlanStep[]
  events?: StateEvent[]
  trace?: AgentTrace
  weatherRisk?: 'low' | 'medium' | 'high'
  corrections?: string[]
}

export interface PlanRequest {
  task?: string
  city?: string
  budget?: number
  durationHours?: number
  preferences?: string[]
  avoidRain?: boolean
  startLocation?: string
  /** 'flash' = deepseek-v4-flash (快速), 'pro' = deepseek-v4-pro (深思) */
  preferredModel?: 'flash' | 'pro'
}

// ─── API Fetch Helpers ───────────────────────────────────────────────────────

const BASE = import.meta.env.VITE_API_BASE ?? ''

async function request<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

export async function apiHealth(): Promise<{ status: string }> {
  const res = await fetch(`${BASE}/api/health`)
  if (!res.ok) throw new Error('health check failed')
  return res.json()
}
