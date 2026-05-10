export interface UserConstraints {
  city: string;
  startPoint: string;
  durationMinutes: number;
  budget: number;
  preferences: string[];
  peopleCount?: number;
  transportMode?: "walk" | "transit" | "mixed";
  weatherPreference?: "avoid_rain" | "indoor_first" | "outdoor_ok";
  weatherRisk?: "low" | "medium" | "high";
}

export interface PlanRequest {
  task?: string;
  city?: string;
  startPoint?: string;
  durationMinutes?: number;
  budget?: number;
  preferences?: string[];
  peopleCount?: number;
  transportMode?: "walk" | "transit" | "mixed";
  weatherPreference?: "avoid_rain" | "indoor_first" | "outdoor_ok";
  weatherRisk?: "low" | "medium" | "high";
  /** Frontend model selector: 'flash' = deepseek-v4-flash, 'pro' = deepseek-v4-pro */
  preferredModel?: "flash" | "pro";
}

export interface RouteStop {
  name: string;
  category: PoiCategory;
  estimatedCost: number;
  estimatedStayMinutes: number;
  reason: string;
  location?: string;
  address?: string;
  rating?: number;
  distanceMeters?: number;
  /** LLM 生成的费用明细，说明每一项开销来源 */
  costBreakdown?: string;
  /** LLM 生成的亮点描述，一句话说明该地点特色 */
  highlight?: string;
  /** LLM 生成的预约提醒，如"需提前3天在公众号预约"、"免预约直接进入" */
  bookingInfo?: string;
}

export interface RouteLeg {
  origin: string;
  destination: string;
  distanceMeters: number;
  durationMinutes: number;
  mode: "walk" | "transit" | "bicycling";
}

export type PoiCategory = "bookstore" | "cafe" | "sight" | "museum" | "mall" | "park" | "restaurant";

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
  metadata?: {
    model?: string;
    agent_version?: string;
    total_tokens?: number;
    response_time_ms?: number;
    agent_id?: string;
    [key: string]: unknown;
  };
}

export interface PlanningResult {
  summary: string;
  totalEstimatedCost: number;
  totalEstimatedMinutes: number;
  stops: RouteStop[];
  routeLegs?: RouteLeg[];
  startLocation?: string;
  decisionLog: string[];
  planSteps?: AgentPlanStep[];
  events?: StateEvent[];
  trace?: AgentTrace;
  weatherRisk?: "low" | "medium" | "high";
  corrections?: string[];
}
