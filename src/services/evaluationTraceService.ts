import { AgentTrace, PlanningResult, TraceStep } from "../types/plan";

export interface EvaluationRouteEvidence {
  overview: PlanningResult["routeOverview"];
  constraints: {
    city: string;
    startPoint: string;
    endPoint?: string;
    durationMinutes?: number;
    budget?: number;
    transportMode?: "walk" | "transit" | "mixed";
    weatherPreference?: "avoid_rain" | "indoor_first" | "outdoor_ok";
    maxLegMinutes?: number;
    preferences: string[];
    party: PlanningResult["constraints"]["party"];
    experience: PlanningResult["constraints"]["experience"];
    accessibility: PlanningResult["constraints"]["accessibility"];
    styleSummary?: string;
  };
  stops: Array<{
    name: string;
    category: string;
    address?: string;
    estimatedStayMinutes: number;
    estimatedCost: number;
    estimatedCostPerPerson?: number;
    reason: string;
    highlight?: string;
    bookingInfo?: string;
    suitabilityTags?: string[];
    styleMatches?: string[];
  }>;
  routeLegs: PlanningResult["routeLegs"];
  corrections: string[];
}

export function buildEvaluationRouteEvidence(result: PlanningResult): EvaluationRouteEvidence {
  return {
    overview: result.routeOverview,
    constraints: {
      city: result.constraints.city,
      startPoint: result.constraints.startPoint,
      endPoint: result.constraints.endPoint,
      durationMinutes: result.constraints.durationMinutes,
      budget: result.constraints.budget,
      transportMode: result.constraints.transportMode,
      weatherPreference: result.constraints.weatherPreference,
      maxLegMinutes: result.constraints.maxLegMinutes,
      preferences: result.constraints.preferences,
      party: result.constraints.party,
      experience: result.constraints.experience,
      accessibility: result.constraints.accessibility,
      styleSummary: result.constraints.style.summary || result.constraints.style.rawText
    },
    stops: result.stops.map((stop) => ({
      name: stop.name,
      category: stop.category,
      address: stop.address,
      estimatedStayMinutes: stop.estimatedStayMinutes,
      estimatedCost: stop.estimatedCost,
      estimatedCostPerPerson: stop.estimatedCostPerPerson,
      reason: stop.reason,
      highlight: stop.highlight,
      bookingInfo: stop.bookingInfo,
      suitabilityTags: stop.suitabilityTags,
      styleMatches: stop.styleMatches
    })),
    routeLegs: result.routeLegs,
    corrections: result.corrections ?? []
  };
}

function describeAccessibility(evidence: EvaluationRouteEvidence): string {
  const accessibility = evidence.constraints.accessibility ?? {};
  return [
    accessibility.wheelchairAccessRequired ? "轮椅可通行" : undefined,
    accessibility.stepFreeRequired ? "全程无台阶" : undefined,
    accessibility.elevatorRequired ? "需要电梯" : undefined,
    accessibility.accessibleRestroomRequired ? "需要无障碍卫生间" : undefined,
    accessibility.frequentRestRequired ? "需要频繁休息点" : undefined
  ].filter(Boolean).join("、") || "无特殊要求";
}

function buildStructuredFinalAnswer(result: PlanningResult, evidence: EvaluationRouteEvidence): string {
  const route = evidence.stops.length > 0
    ? [evidence.constraints.startPoint, ...evidence.stops.map((stop) => stop.name)].join(" → ")
    : "未生成可用站点";
  const stopLines = evidence.stops.map((stop, index) =>
    `${index + 1}. ${stop.name}（${stop.category}）：停留${stop.estimatedStayMinutes}分钟，` +
    `预计费用¥${stop.estimatedCost}；${stop.reason}`
  );
  const legLines = (evidence.routeLegs ?? []).map((leg, index) =>
    `${index + 1}. ${leg.originName ?? leg.origin} → ${leg.destinationName ?? leg.destination}：` +
    `${leg.mode}，${leg.distanceMeters}米，${leg.durationMinutes}分钟${leg.estimated ? "（估算）" : ""}`
  );
  const overview = evidence.overview;
  return [
    result.summary,
    `路线顺序：${route}`,
    `约束：城市=${evidence.constraints.city}，起点=${evidence.constraints.startPoint}，` +
      `时长上限=${evidence.constraints.durationMinutes ?? "不限"}分钟，预算=${evidence.constraints.budget ?? "不限"}元，` +
      `偏好=${evidence.constraints.preferences.join("、") || "未指定"}，天气策略=${evidence.constraints.weatherPreference ?? "常规"}。`,
    `无障碍硬约束：${describeAccessibility(evidence)}。`,
    overview
      ? `核算：总时长${overview.time.totalMinutes}分钟（交通${overview.time.travelMinutes}分钟、停留${overview.time.stayMinutes}分钟），` +
        `总费用¥${overview.cost.total}${overview.cost.budget != null ? `，预算上限¥${overview.cost.budget}` : ""}；` +
        `天气=${overview.weather.summary}，风险=${overview.weather.risk}。`
      : `核算：总时长${result.totalEstimatedMinutes}分钟，总费用¥${result.totalEstimatedCost}。`,
    "站点明细：",
    ...(stopLines.length ? stopLines : ["无"]),
    "路线分段：",
    ...(legLines.length ? legLines : ["无"]),
    ...(overview?.importantNotes.length ? ["重要说明：", ...overview.importantNotes] : []),
    ...(evidence.corrections.length ? ["自动修正：", ...evidence.corrections] : [])
  ].join("\n");
}

/** Add the structured route returned to clients to the evaluation-only trace. */
export function buildEvaluationTrace(result: PlanningResult): AgentTrace {
  if (!result.trace || result.responseKind !== "route") {
    if (!result.trace) throw new Error("Agent did not produce an evaluation trace");
    return result.trace;
  }

  const evidence = buildEvaluationRouteEvidence(result);
  const steps: TraceStep[] = result.trace.steps.map((step) => ({ ...step }));
  let finalIndex = -1;
  for (let index = steps.length - 1; index >= 0; index--) {
    if (steps[index].type === "final_answer") {
      finalIndex = index;
      break;
    }
  }
  const insertAt = finalIndex >= 0 ? finalIndex : steps.length;
  steps.splice(insertAt, 0, { type: "tool_result", tool: "route_summary", output: evidence });
  const detailedAnswer = buildStructuredFinalAnswer(result, evidence);
  if (finalIndex >= 0) {
    steps[insertAt + 1] = { ...steps[insertAt + 1], content: detailedAnswer };
  } else {
    steps.push({ type: "final_answer", content: detailedAnswer });
  }
  return { ...result.trace, steps };
}
