import { AgentTrace, PlanningResult, TraceStep } from "../types/plan";
import { WalkAdjustmentRequest, WalkAdjustmentResponse } from "../types/walk";

export type EvaluationCapability =
  | "route_generation"
  | "route_modification"
  | "social_copy"
  | "walk_adjustment"
  | "route_compare"
  | "route_review"
  | "place_services"
  | "memory_feedback"
  | "general";

export function capabilityForResult(result: PlanningResult): EvaluationCapability {
  const intent = result.intent.intent;
  if (intent === "route_create") return "route_generation";
  if (intent === "route_modify") return "route_modification";
  if (intent === "social_copy") return "social_copy";
  if (intent === "route_compare") return "route_compare";
  if (intent === "route_review") return "route_review";
  if (["poi_discovery", "navigation_query", "info_query"].includes(intent)) return "place_services";
  if (["memory_query", "history_query", "preference_feedback"].includes(intent)) return "memory_feedback";
  return "general";
}

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
    temporal: PlanningResult["constraints"]["temporal"];
    preferences: string[];
    party: PlanningResult["constraints"]["party"];
    experience: PlanningResult["constraints"]["experience"];
    accessibility: PlanningResult["constraints"]["accessibility"];
    discoveryPolicy: PlanningResult["constraints"]["discoveryPolicy"];
    styleSummary?: string;
  };
  stops: Array<{
    name: string;
    category: string;
    address?: string;
    estimatedStayMinutes: number;
    estimatedCost: number;
    estimatedCostPerPerson?: number;
    estimatedArrivalAt?: string;
    estimatedDepartureAt?: string;
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
      temporal: result.constraints.temporal,
      preferences: result.constraints.preferences,
      party: result.constraints.party,
      experience: result.constraints.experience,
      accessibility: result.constraints.accessibility,
      discoveryPolicy: result.constraints.discoveryPolicy,
      styleSummary: result.constraints.style.summary || result.constraints.style.rawText
    },
    stops: result.stops.map((stop) => ({
      name: stop.name,
      category: stop.category,
      address: stop.address,
      estimatedStayMinutes: stop.estimatedStayMinutes,
      estimatedCost: stop.estimatedCost,
      estimatedCostPerPerson: stop.estimatedCostPerPerson,
      estimatedArrivalAt: stop.estimatedArrivalAt,
      estimatedDepartureAt: stop.estimatedDepartureAt,
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
    `${index + 1}. ${stop.name}（${stop.category}）${stop.estimatedArrivalAt ? `：${stop.estimatedArrivalAt}到达` : ""}：停留${stop.estimatedStayMinutes}分钟，` +
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
      `出行时间=${evidence.constraints.temporal.departureAt ?? evidence.constraints.temporal.visitDate ?? "未指定"}，` +
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

function buildNonRouteFinalAnswer(result: PlanningResult): string {
  const lines = [result.answer || result.summary || result.title];
  for (const section of result.sections ?? []) {
    lines.push(`${section.title}：`, ...section.items.map((item) => `- ${item}`));
  }
  if (result.comparison) {
    lines.push("比较维度：" + (result.comparison.dimensions.join("、") || "未提供"));
    for (const option of result.comparison.options) {
      lines.push(
        `${option.name}：${Object.entries(option.metrics).map(([key, value]) => `${key}=${value}`).join("；") || "无量化信息"}`,
        ...(option.pros.length ? [`优点：${option.pros.join("；")}`] : []),
        ...(option.cons.length ? [`不足：${option.cons.join("；")}`] : [])
      );
    }
    if (result.comparison.recommendation) lines.push(`推荐：${result.comparison.recommendation}`);
    if (result.comparison.missingInformation?.length) {
      lines.push(`缺失信息：${result.comparison.missingInformation.join("；")}`);
    }
  }
  if (result.socialCopy) {
    for (const variant of result.socialCopy.variants) {
      lines.push(`${variant.tone}：${variant.text}`);
      if (variant.hashtags.length) lines.push(`标签：${variant.hashtags.join(" ")}`);
    }
  }
  return lines.filter(Boolean).join("\n");
}

/** Add the structured route returned to clients to the evaluation-only trace. */
export function buildEvaluationTrace(result: PlanningResult): AgentTrace {
  if (!result.trace) throw new Error("Agent did not produce an evaluation trace");

  const metadata = {
    ...result.trace.metadata,
    intent: result.intent.intent,
    response_kind: result.responseKind,
    capability: capabilityForResult(result)
  };

  if (result.responseKind !== "route") {
    const steps = result.trace.steps.map((step) => ({ ...step }));
    if (result.skillExecutions?.length) {
      steps.unshift({
        type: "tool_result",
        tool: "skill_execution",
        output: result.skillExecutions
      });
    }
    const finalAnswer = buildNonRouteFinalAnswer(result);
    let finalIndex = -1;
    for (let index = steps.length - 1; index >= 0; index--) {
      if (steps[index].type === "final_answer") {
        finalIndex = index;
        break;
      }
    }
    const resultEvidence = {
      title: result.title,
      answer: result.answer,
      sections: result.sections ?? [],
      comparison: result.comparison,
      socialCopy: result.socialCopy,
      sources: result.sources ?? [],
      skillExecutions: result.skillExecutions ?? []
    };
    const evidenceTool = result.intent.intent === "social_copy"
      ? "social_copy_result"
      : result.intent.intent === "route_compare" || result.intent.intent === "route_review"
        ? "analysis_result"
        : "agent_response";
    const insertAt = finalIndex >= 0 ? finalIndex : steps.length;
    if (result.socialCopy) {
      steps.splice(insertAt, 0, {
        type: "tool_result",
        tool: "social_copy_brief",
        output: {
          platform: result.socialCopy.platform,
          style: result.socialCopy.styleProfile?.label,
          basedOnRoute: result.socialCopy.basedOnRoute,
          variantCount: result.socialCopy.variants.length
        }
      });
    }
    steps.splice(insertAt, 0, { type: "tool_result", tool: evidenceTool, output: resultEvidence });
    if (evidenceTool !== "agent_response") {
      steps.splice(insertAt, 0, { type: "tool_result", tool: "agent_response", output: resultEvidence });
    }
    let finalAnswerIndex = -1;
    for (let index = steps.length - 1; index >= 0; index--) {
      if (steps[index].type === "final_answer") {
        finalAnswerIndex = index;
        break;
      }
    }
    if (finalAnswerIndex >= 0) steps[finalAnswerIndex] = { ...steps[finalAnswerIndex], content: finalAnswer };
    else steps.push({ type: "final_answer", content: finalAnswer });
    return { ...result.trace, steps, metadata };
  }

  const evidence = buildEvaluationRouteEvidence(result);
  const steps: TraceStep[] = result.trace.steps.map((step) => ({ ...step }));
  if (result.skillExecutions?.length) {
    steps.unshift({ type: "tool_result", tool: "skill_execution", output: result.skillExecutions });
  }
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
  return { ...result.trace, steps, metadata };
}

export function buildWalkAdjustmentEvaluationTrace(
  task: string,
  request: WalkAdjustmentRequest,
  response: WalkAdjustmentResponse,
  responseTimeMs: number
): AgentTrace {
  const inputEvidence = {
    reason: request.reason,
    visitedStopNames: request.visitedStopNames,
    skippedStopNames: request.skippedStopNames ?? [],
    currentLocation: request.currentLocation,
    remainingMinutes: request.remainingMinutes,
    customRequest: request.customRequest,
    originalRoute: {
      title: request.route.title,
      totalEstimatedMinutes: request.route.totalEstimatedMinutes,
      totalEstimatedCost: request.route.totalEstimatedCost,
      stops: request.route.stops,
      routeLegs: request.route.routeLegs,
      constraints: request.route.constraints
    }
  };
  const outputEvidence = {
    revision: response.revision,
    adjustedRoute: {
      title: response.route.title,
      totalEstimatedMinutes: response.route.totalEstimatedMinutes,
      totalEstimatedCost: response.route.totalEstimatedCost,
      stops: response.route.stops,
      routeLegs: response.route.routeLegs,
      constraints: response.route.constraints
    }
  };
  return {
    task,
    steps: [
      { type: "tool_call", tool: "walk_adjustment", input: inputEvidence },
      { type: "tool_result", tool: "walk_adjustment", output: outputEvidence },
      { type: "final_answer", content: `${response.revision.summary}${response.revision.warnings.length ? `\n注意：${response.revision.warnings.join("；")}` : ""}` }
    ],
    metadata: {
      model: "deterministic-walk-adjustment",
      agent_version: "citywalk-pulse-agent-v0.6-intent-router",
      response_time_ms: responseTimeMs,
      agent_id: "citywalk-pulse",
      intent: "walk_adjustment",
      response_kind: "route",
      capability: "walk_adjustment"
    }
  };
}
