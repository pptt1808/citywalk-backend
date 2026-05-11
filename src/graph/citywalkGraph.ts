import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import {
  AgentPlanStep,
  PlanningResult,
  PlanRequest,
  RouteLeg,
  RouteStop,
  StateEvent,
  TraceStep,
  UserConstraints
} from "../types/plan";
import { env } from "../config/env";
import { LlmRouter } from "../llm/llmRouter";
import { MapTool, Poi } from "../tools/mapTool";
import { WeatherContext, WeatherTool } from "../tools/weatherTool";

const CityWalkState = Annotation.Root({
  task: Annotation<string>(),
  rawInput: Annotation<PlanRequest>(),
  constraints: Annotation<UserConstraints>(),
  planSteps: Annotation<AgentPlanStep[]>(),
  currentStepIndex: Annotation<number>(),
  weather: Annotation<WeatherContext | undefined>(),
  startLocation: Annotation<string | undefined>(),
  candidatePois: Annotation<Poi[]>(),
  selectedStops: Annotation<RouteStop[]>(),
  routeLegs: Annotation<RouteLeg[]>(),
  totalEstimatedCost: Annotation<number>(),
  totalEstimatedMinutes: Annotation<number>(),
  weatherRisk: Annotation<"low" | "medium" | "high" | undefined>(),
  needsReplan: Annotation<boolean>(),
  revisionCount: Annotation<number>(),
  finalAnswer: Annotation<string>(),
  events: Annotation<StateEvent[]>({
    reducer: (left, right) => left.concat(right),
    default: () => []
  }),
  traceSteps: Annotation<TraceStep[]>({
    reducer: (left, right) => left.concat(right),
    default: () => []
  }),
  decisionLog: Annotation<string[]>({
    reducer: (left, right) => left.concat(right),
    default: () => []
  }),
  corrections: Annotation<string[]>({
    reducer: (left, right) => left.concat(right),
    default: () => []
  }),
  llmModels: Annotation<string[]>({
    reducer: (left, right) => left.concat(right),
    default: () => []
  })
});

type CityWalkGraphState = typeof CityWalkState.State;
type CityWalkGraphUpdate = typeof CityWalkState.Update;

function haversineKm(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export class CityWalkGraphRunner {
  private readonly llmRouter = new LlmRouter();

  constructor(
    private readonly mapTool: MapTool,
    private readonly weatherTool: WeatherTool
  ) {}

  async run(input: PlanRequest): Promise<PlanningResult> {
    const graph = this.buildGraph();
    const startedAt = Date.now();
    const initialState = this.buildInitialState(input);
    const state = await graph.invoke(initialState, { recursionLimit: 30 });
    return this.stateToPlanningResult(state, startedAt);
  }

  /**
   * Runs the graph while emitting each batch of new {@link StateEvent} entries as nodes complete.
   * Used for SSE / real-time visualization (F-04).
   */
  async streamStateEvents(input: PlanRequest, onDelta: (events: StateEvent[]) => void): Promise<PlanningResult> {
    const graph = this.buildGraph();
    const startedAt = Date.now();
    const initialState = this.buildInitialState(input);
    let prevEventLen = 0;
    const stream = await graph.stream(initialState, { streamMode: "values", recursionLimit: 30 });
    let lastState: CityWalkGraphState | undefined;
    for await (const chunk of stream) {
      lastState = chunk as CityWalkGraphState;
      const all = lastState.events ?? [];
      if (all.length > prevEventLen) {
        onDelta(all.slice(prevEventLen));
        prevEventLen = all.length;
      }
    }
    if (!lastState) {
      throw new Error("CityWalk graph stream produced no state");
    }
    return this.stateToPlanningResult(lastState, startedAt);
  }

  private buildInitialState(input: PlanRequest): CityWalkGraphState {
    const task = input.task ?? this.describeStructuredInput(input);
    return {
      task,
      rawInput: input,
      constraints: this.defaultConstraints(input),
      planSteps: [],
      currentStepIndex: 0,
      weather: undefined,
      startLocation: undefined,
      candidatePois: [],
      selectedStops: [],
      routeLegs: [],
      totalEstimatedCost: 0,
      totalEstimatedMinutes: 0,
      weatherRisk: input.weatherRisk,
      needsReplan: false,
      revisionCount: 0,
      finalAnswer: "",
      events: [],
      traceSteps: [],
      decisionLog: [],
      corrections: [],
      llmModels: []
    };
  }

  private stateToPlanningResult(state: CityWalkGraphState, startedAt: number): PlanningResult {
    const responseTimeMs = Date.now() - startedAt;
    const finalAnswer = state.finalAnswer || this.buildFinalAnswer(state);
    const traceSteps = state.traceSteps.concat([{ type: "final_answer", content: finalAnswer }]);

    return {
      summary: finalAnswer,
      totalEstimatedCost: state.totalEstimatedCost,
      totalEstimatedMinutes: state.totalEstimatedMinutes,
      stops: state.selectedStops,
      routeLegs: state.routeLegs,
      startLocation: state.startLocation,
      decisionLog: state.decisionLog,
      planSteps: state.planSteps,
      events: state.events,
      weatherRisk: state.weatherRisk,
      corrections: state.corrections,
      trace: {
        task: state.task,
        steps: traceSteps,
        metadata: {
          model: state.llmModels.at(-1) ?? "heuristic-planner-langgraph-js",
          agent_version: "citywalk-pulse-agent-v0.2",
          response_time_ms: responseTimeMs,
          agent_id: "citywalk-pulse"
        }
      }
    };
  }

  private buildGraph() {
    return new StateGraph(CityWalkState)
      .addNode("parse", this.parseNode.bind(this))
      .addNode("planner", this.plannerNode.bind(this))
      .addNode("execute", this.executorNode.bind(this))
      .addNode("reflect", this.reflectNode.bind(this))
      .addNode("synthesize", this.synthesizerNode.bind(this))
      .addEdge(START, "parse")
      .addEdge("parse", "planner")
      .addEdge("planner", "execute")
      .addConditionalEdges("execute", this.routeAfterExecute, {
        execute: "execute",
        reflect: "reflect"
      })
      .addConditionalEdges("reflect", this.routeAfterReflect, {
        execute: "execute",
        synthesize: "synthesize"
      })
      .addEdge("synthesize", END)
      .compile();
  }

  private async parseNode(state: CityWalkGraphState): Promise<CityWalkGraphUpdate> {
    const fallbackConstraints = this.parseConstraints(state.rawInput);
    const llmParsed = await this.tryParseConstraintsWithLlm(state.task, state.rawInput);

    // Priority: explicit frontend field > heuristic match (reliable) > LLM extraction > hardcoded default
    // Heuristic matchCity() is a deterministic string match — it beats LLM which may
    // hallucinate or default to "南京" when the prompt says "可使用合理默认值".
    const matchedCity = this.matchCity(state.task);
    const city = state.rawInput.city
      ?? matchedCity
      ?? fallbackConstraints.city
      ?? (llmParsed?.data as Record<string, unknown> | undefined)?.city as string | undefined;

    const matchedStart = this.matchStartPoint(state.task);
    const startPoint = state.rawInput.startPoint
      ?? matchedStart
      ?? llmParsed?.data.startPoint
      ?? fallbackConstraints.startPoint;

    const matchedDuration = this.matchDuration(state.task);
    const durationMinutes = state.rawInput.durationMinutes
      ?? matchedDuration
      ?? llmParsed?.data.durationMinutes
      ?? fallbackConstraints.durationMinutes;

    const matchedBudget = this.matchBudget(state.task);
    // Budget: only set if user explicitly mentioned it. Otherwise no limit.
    const budget = state.rawInput.budget
      ?? matchedBudget
      ?? (llmParsed?.data as Record<string, unknown> | undefined)?.budget as number | undefined
      ?? undefined;

    const matchedEndPoint = this.matchEndPoint(state.task);
    const endPoint = state.rawInput.endPoint
      ?? matchedEndPoint
      ?? (llmParsed?.data as Record<string, unknown> | undefined)?.endPoint as string | undefined;

    const matchedMaxLeg = this.matchMaxLegMinutes(state.task);
    const maxLegMinutes = state.rawInput.maxLegMinutes
      ?? matchedMaxLeg
      ?? (llmParsed?.data as Record<string, unknown> | undefined)?.maxLegMinutes as number | undefined;

    const preferences = state.rawInput.preferences?.length
      ? state.rawInput.preferences
      : this.normalizePreferences((llmParsed?.data as Record<string, unknown> | undefined)?.preferences, fallbackConstraints.preferences).length
        ? this.normalizePreferences((llmParsed?.data as Record<string, unknown> | undefined)?.preferences, fallbackConstraints.preferences)
        : fallbackConstraints.preferences;

    const constraints: UserConstraints = {
      city,
      startPoint,
      durationMinutes,
      budget,
      preferences,
      peopleCount: state.rawInput.peopleCount ?? llmParsed?.data.peopleCount ?? fallbackConstraints.peopleCount,
      transportMode: state.rawInput.transportMode ?? llmParsed?.data.transportMode ?? fallbackConstraints.transportMode,
      weatherPreference: state.rawInput.weatherPreference ?? llmParsed?.data.weatherPreference ?? fallbackConstraints.weatherPreference,
      weatherRisk: state.rawInput.weatherRisk ?? llmParsed?.data.weatherRisk ?? fallbackConstraints.weatherRisk,
      endPoint,
      maxLegMinutes
    };
    const content = llmParsed
      ? `使用 ${llmParsed.model} 解析自然语言约束，并合并表单显式字段。`
      : "未配置可用 LLM，使用启发式解析自然语言与表单约束。";
    const event = this.event("THINK", content, state, "parse");

    const budgetNote = constraints.budget != null ? `预算=${constraints.budget}元，` : '';
    const endNote = constraints.endPoint ? `终点=${constraints.endPoint}，` : '';
    const legNote = constraints.maxLegMinutes ? `单段≤${constraints.maxLegMinutes}分钟，` : '';

    return {
      constraints,
      weatherRisk: constraints.weatherRisk ?? "medium",
      events: [event],
      traceSteps: [{ type: "thought", content: event.content }],
      llmModels: llmParsed ? [`${llmParsed.provider}:${llmParsed.model}`] : [],
      decisionLog: [
        `解析约束：城市=${constraints.city}，起点=${constraints.startPoint}，时长=${constraints.durationMinutes}分钟，${budgetNote}${endNote}${legNote}偏好=${(constraints.preferences ?? []).join("、") || "默认"}`
      ]
    };
  }

  private async plannerNode(state: CityWalkGraphState): Promise<CityWalkGraphUpdate> {
    const llmPlan = await this.tryPlanStepsWithLlm(state.task, state.constraints, state.rawInput.preferredModel);
    const planSteps: AgentPlanStep[] = llmPlan?.data ?? [
      {
        id: "weather",
        description: "查询天气预报、预警、空气质量与生活指数，判断是否需要室内优先。",
        toolHint: "weather",
        dependsOn: [],
        status: "pending"
      },
      {
        id: "poi",
        description: "根据偏好、预算与天气风险搜索候选 POI。",
        toolHint: "poi_search",
        dependsOn: ["weather"],
        status: "pending"
      },
      {
        id: "route",
        description: "规划点位顺序、交通耗时与停留时间。",
        toolHint: "route_plan",
        dependsOn: ["poi"],
        status: "pending"
      },
      {
        id: "check",
        description: "检查预算、天气、时间约束并准备反思修正。",
        toolHint: "constraint_check",
        dependsOn: ["route"],
        status: "pending"
      }
    ];
    const event = this.event(
      "PLAN",
      `${llmPlan ? `使用 ${llmPlan.model}` : "使用默认规划器"}生成 ${planSteps.length} 步动态计划：${planSteps.map((step) => step.description).join(" -> ")}`,
      state
    );

    return {
      planSteps,
      currentStepIndex: 0,
      needsReplan: false,
      events: [event],
      traceSteps: [{ type: "thought", content: event.content }],
      llmModels: llmPlan ? [`${llmPlan.provider}:${llmPlan.model}`] : [],
      decisionLog: ["Planner 生成高层计划，并将每一步交给 ReAct 执行器动态调用工具。"]
    };
  }

  private async executorNode(state: CityWalkGraphState): Promise<CityWalkGraphUpdate> {
    const step = state.planSteps[state.currentStepIndex];
    if (!step) {
      return { currentStepIndex: state.currentStepIndex + 1 };
    }

    const runningSteps = state.planSteps.map((item) =>
      item.id === step.id ? { ...item, status: "running" as const } : item
    );
    const thought = this.event("THINK", `执行步骤 ${step.id}：${step.description}`, state, step.id);

    if (step.toolHint === "weather") {
      return this.executeWeatherStep(state, step, runningSteps, thought);
    }
    if (step.toolHint === "poi_search") {
      return this.executePoiStep(state, step, runningSteps, thought);
    }
    if (step.toolHint === "route_plan") {
      return this.executeRouteStep(state, step, runningSteps, thought);
    }

    return this.executeConstraintStep(state, step, runningSteps, thought);
  }

  private async executeWeatherStep(
    state: CityWalkGraphState,
    step: AgentPlanStep,
    runningSteps: AgentPlanStep[],
    thought: StateEvent
  ): Promise<CityWalkGraphUpdate> {
    const input = { city: state.constraints.city };
    const action = this.event("ACTION", "调用天气工具获取降雨概率、预警、空气质量与生活指数。", state, step.id, {
      tool: "get_weather",
      input
    });
    const weather = await this.weatherTool.getWeatherContext(state.constraints.city);
    const weatherRisk = state.constraints.weatherRisk ?? weather.risk;
    const obs = this.event("OBS", `天气工具返回：${weather.summary}，风险=${weatherRisk}`, state, step.id, {
      tool: "get_weather",
      input,
      output: weather
    });

    return {
      weather,
      weatherRisk,
      planSteps: this.completeStep(runningSteps, step.id),
      currentStepIndex: state.currentStepIndex + 1,
      events: [thought, action, obs],
      traceSteps: [
        { type: "thought", content: thought.content },
        { type: "tool_call", tool: "get_weather", input },
        { type: "tool_result", tool: "get_weather", output: weather }
      ],
      decisionLog: [`天气风险更新为 ${weatherRisk}。`]
    };
  }

  private async executePoiStep(
    state: CityWalkGraphState,
    step: AgentPlanStep,
    runningSteps: AgentPlanStep[],
    thought: StateEvent
  ): Promise<CityWalkGraphUpdate> {
    const startLocation = state.startLocation ?? (await this.mapTool.geocode(state.constraints.startPoint, state.constraints.city));
    const indoorOnly = state.weatherRisk === "high" || state.constraints.weatherPreference === "indoor_first";
    const input = {
      city: state.constraints.city,
      location: startLocation,
      keywords: state.constraints.preferences,
      indoorOnly
    };
    const action = this.event("ACTION", "调用地图 POI 工具搜索候选点。", state, step.id, {
      tool: startLocation ? "search_poi_nearby" : "search_poi",
      input
    });
    let candidatePois = await this.mapTool.searchNearbyPoi(state.constraints.preferences, {
      city: state.constraints.city,
      location: startLocation,
      indoorOnly,
      radius: 5000
    });

    // If user specified an endPoint, add it as a required last stop
    let endPointPoi: Poi | undefined;
    if (state.constraints.endPoint) {
      const epLocation = await this.mapTool.geocode(state.constraints.endPoint, state.constraints.city);
      if (epLocation) {
        endPointPoi = {
          name: state.constraints.endPoint,
          category: "sight" as const,
          averageCost: 0,
          location: epLocation,
          address: state.constraints.endPoint,
          rating: 4.0,
          indoor: false
        };
        candidatePois.push(endPointPoi);
      }
    }
    const obs = this.event("OBS", `地图工具返回 ${candidatePois.length} 个候选点${endPointPoi ? `（含指定终点：${endPointPoi.name}）` : ''}。`, state, step.id, {
      tool: startLocation ? "search_poi_nearby" : "search_poi",
      input,
      output: candidatePois
    });

    return {
      startLocation,
      candidatePois,
      planSteps: this.completeStep(runningSteps, step.id),
      currentStepIndex: state.currentStepIndex + 1,
      events: [thought, action, obs],
      traceSteps: [
        { type: "thought", content: thought.content },
        { type: "tool_call", tool: startLocation ? "search_poi_nearby" : "search_poi", input },
        { type: "tool_result", tool: startLocation ? "search_poi_nearby" : "search_poi", output: candidatePois }
      ],
      decisionLog: [`候选 POI 数量：${candidatePois.length}。`]
    };
  }

  private async executeRouteStep(
    state: CityWalkGraphState,
    step: AgentPlanStep,
    runningSteps: AgentPlanStep[],
    thought: StateEvent
  ): Promise<CityWalkGraphUpdate> {
    let selectedStops = this.selectStops(state);

    // 用 LLM 丰富每个点位的费用明细和亮点描述
    const enriched = await this.llmRouter.enrichPois(
      selectedStops.map((s) => ({
        name: s.name,
        category: s.category,
        address: s.address,
        city: state.constraints.city
      })),
      state.rawInput.preferredModel
    );
    if (enriched?.data && enriched.data.length === selectedStops.length) {
      selectedStops = selectedStops.map((stop, i) => ({
        ...stop,
        estimatedCost: enriched.data[i].estimatedCost,
        estimatedStayMinutes: enriched.data[i].estimatedStayMinutes,
        costBreakdown: enriched.data[i].costBreakdown,
        highlight: enriched.data[i].highlight,
        bookingInfo: enriched.data[i].bookingInfo
      }));
    }

    const destinations = selectedStops.map((stop) => stop.location).filter((location): location is string => Boolean(location));

    const origin = state.startLocation ?? state.constraints.startPoint;

    const action = this.event("ACTION", "调用路径规划工具计算点位间耗时。", state, step.id, {
      tool: "plan_route",
      input: { origin, destinations, mode: state.constraints.transportMode ?? "mixed", city: state.constraints.city }
    });

    let routeLegs = await this.mapTool.planRoute(origin, destinations, state.constraints.transportMode ?? "mixed", state.constraints.city);

    // Fallback: if Amap API returned no routes, use straight-line estimates so the map still shows lines
    if (routeLegs.length === 0 || routeLegs.every(l => l.distanceMeters === 0)) {
      const allCoords = [origin, ...destinations].map(c => c?.split(",").map(Number) as [number, number] | undefined).filter(Boolean) as [number, number][];
      routeLegs = [];
      for (let i = 0; i < allCoords.length - 1; i++) {
        const [lng1, lat1] = allCoords[i];
        const [lng2, lat2] = allCoords[i + 1];
        const dist = haversineKm(lng1, lat1, lng2, lat2) * 1000;
        const walkMin = Math.max(1, Math.round(dist / 80)); // ~5 km/h walking
        routeLegs.push({
          origin: allCoords[i].join(","),
          destination: allCoords[i + 1].join(","),
          distanceMeters: Math.round(dist),
          durationMinutes: walkMin,
          mode: dist > 3000 ? "transit" : "walk"
        });
      }
    }

    // Enforce maxLegMinutes: if any walk leg exceeds limit, replan with transit
    if (state.constraints.maxLegMinutes) {
      const tooLong = routeLegs.some((leg) => leg.durationMinutes > state.constraints.maxLegMinutes!);
      if (tooLong) {
        routeLegs = await this.mapTool.planRoute(origin, destinations, "transit", state.constraints.city);
      }
    }

    const routeMinutes = routeLegs.reduce((sum, leg) => sum + leg.durationMinutes, 0);
    const stayMinutes = selectedStops.reduce((sum, stop) => sum + stop.estimatedStayMinutes, 0);
    const totalEstimatedCost = selectedStops.reduce((sum, stop) => sum + stop.estimatedCost, 0);
    const totalEstimatedMinutes = stayMinutes + routeMinutes;

    const transitLegs = routeLegs.filter((l) => l.mode === "transit").length;
    const walkLegs = routeLegs.filter((l) => l.mode === "walk").length;
    const modeSummary = transitLegs > 0 && walkLegs > 0 ? `${walkLegs}段步行 + ${transitLegs}段公交地铁`
      : transitLegs > 0 ? `全程公交地铁` : `全程步行`;

    const obs = this.event("OBS", `路径规划返回 ${routeLegs.length} 段（${modeSummary}），总预计 ${totalEstimatedMinutes} 分钟（路程${routeMinutes}分钟 + 停留${stayMinutes}分钟）。`, state, step.id, {
      tool: "plan_route",
      input: { origin, destinations, mode: state.constraints.transportMode ?? "mixed", city: state.constraints.city },
      output: routeLegs
    });

    return {
      selectedStops,
      routeLegs,
      totalEstimatedCost,
      totalEstimatedMinutes,
      planSteps: this.completeStep(runningSteps, step.id),
      currentStepIndex: state.currentStepIndex + 1,
      events: [thought, action, obs],
      traceSteps: [
        { type: "thought", content: thought.content },
        { type: "tool_call", tool: "plan_route", input: { origin, destinations, mode: state.constraints.transportMode ?? "mixed", city: state.constraints.city } },
        { type: "tool_result", tool: "plan_route", output: routeLegs }
      ],
      decisionLog: [`路线：${selectedStops.map((stop) => stop.name).join(" → ") || "无可选点位"}（${modeSummary}，路程${routeMinutes}分钟 + 停留${stayMinutes}分钟）`]
    };
  }

  private async executeConstraintStep(
    state: CityWalkGraphState,
    step: AgentPlanStep,
    runningSteps: AgentPlanStep[],
    thought: StateEvent
  ): Promise<CityWalkGraphUpdate> {
    const violations = this.detectViolations(state);
    const checkLabel = state.constraints.budget != null ? "预算、时间与天气约束通过" : "时间与天气约束通过";
    const obs = this.event("OBS", violations.length > 0 ? `发现约束问题：${violations.join("；")}` : `${checkLabel}。`, state, step.id, {
      tool: "constraint_check",
      input: {
        budget: state.constraints.budget,
        durationMinutes: state.constraints.durationMinutes,
        weatherRisk: state.weatherRisk
      },
      output: violations
    });

    return {
      needsReplan: violations.length > 0,
      planSteps: this.completeStep(runningSteps, step.id),
      currentStepIndex: state.currentStepIndex + 1,
      events: [thought, obs],
      traceSteps: [
        { type: "thought", content: thought.content },
        { type: "tool_result", tool: "constraint_check", output: violations }
      ],
      decisionLog: violations.length > 0 ? [`约束检查需要反思：${violations.join("；")}`] : ["约束检查通过。"]
    };
  }

  private async reflectNode(state: CityWalkGraphState): Promise<CityWalkGraphUpdate> {
    const violations = this.detectViolations(state);
    if (!state.needsReplan || violations.length === 0 || state.revisionCount >= 2) {
      const event = this.event("REFLECT", violations.length === 0 ? "无需修正，进入结果合成。" : "已达到最大修正次数，保留当前最优方案并说明风险。", state);
      return {
        needsReplan: false,
        events: [event],
        traceSteps: [{ type: "thought", content: event.content }],
        decisionLog: [event.content]
      };
    }

    const correction = this.chooseCorrection(state, violations);
    const reflectedStops = this.applyCorrection(state, correction);

    // Re-plan routes with corrected stops
    const origin = state.startLocation ?? state.constraints.startPoint;
    const destinations = reflectedStops.map((stop) => stop.location).filter((l): l is string => Boolean(l));
    let newLegs = await this.mapTool.planRoute(origin, destinations, state.constraints.transportMode ?? "mixed", state.constraints.city);
    if (state.constraints.maxLegMinutes && newLegs.some((l) => l.durationMinutes > state.constraints.maxLegMinutes!)) {
      newLegs = await this.mapTool.planRoute(origin, destinations, "transit", state.constraints.city);
    }

    const routeMins = newLegs.reduce((s, l) => s + l.durationMinutes, 0);
    const stayMins = reflectedStops.reduce((s, st) => s + st.estimatedStayMinutes, 0);

    const event = this.event("REFLECT", correction, state);

    return {
      selectedStops: reflectedStops,
      routeLegs: newLegs,
      totalEstimatedCost: reflectedStops.reduce((sum, stop) => sum + stop.estimatedCost, 0),
      totalEstimatedMinutes: stayMins + routeMins,
      needsReplan: false,
      revisionCount: state.revisionCount + 1,
      events: [event],
      traceSteps: [{ type: "thought", content: event.content }],
      corrections: [correction],
      decisionLog: [correction]
    };
  }

  private async synthesizerNode(state: CityWalkGraphState): Promise<CityWalkGraphUpdate> {
    const finalAnswer = this.buildFinalAnswer(state);
    const event = this.event("RESULT", finalAnswer, state);

    return {
      finalAnswer,
      events: [event],
      decisionLog: ["Synthesizer 汇总最终 CityWalk 方案。"]
    };
  }

  private routeAfterExecute(state: CityWalkGraphState): "execute" | "reflect" {
    return state.currentStepIndex < state.planSteps.length ? "execute" : "reflect";
  }

  private routeAfterReflect(state: CityWalkGraphState): "execute" | "synthesize" {
    return state.needsReplan ? "execute" : "synthesize";
  }

  private async tryParseConstraintsWithLlm(task: string, rawInput: PlanRequest) {
    try {
      return await this.llmRouter.parseConstraints(task, rawInput, rawInput.preferredModel);
    } catch (error) {
      return undefined;
    }
  }

  private async tryPlanStepsWithLlm(task: string, constraints: UserConstraints, preferredModel?: "flash" | "pro") {
    try {
      return await this.llmRouter.planSteps(task, constraints, preferredModel);
    } catch (error) {
      return undefined;
    }
  }

  private parseConstraints(input: PlanRequest): UserConstraints {
    const task = input.task ?? "";
    const city = input.city ?? this.matchCity(task) ?? "南京";
    const startPoint = input.startPoint ?? this.matchStartPoint(task) ?? "新街口";
    const durationMinutes = input.durationMinutes ?? this.matchDuration(task) ?? undefined;
    const budget = input.budget ?? this.matchBudget(task) ?? undefined;
    const preferences = input.preferences?.length ? input.preferences : this.matchPreferences(task);
    const weatherPreference = input.weatherPreference ?? (/室内|避雨|下雨|雨天/.test(task) ? "indoor_first" : "outdoor_ok");
    const endPoint = input.endPoint ?? this.matchEndPoint(task);
    const maxLegMinutes = input.maxLegMinutes ?? this.matchMaxLegMinutes(task);

    return {
      city,
      startPoint,
      durationMinutes,
      budget,
      preferences,
      peopleCount: input.peopleCount ?? this.matchPeopleCount(task) ?? 1,
      transportMode: input.transportMode ?? (/地铁|公交/.test(task) ? "transit" : "mixed"),
      weatherPreference,
      weatherRisk: input.weatherRisk,
      endPoint,
      maxLegMinutes
    };
  }

  private normalizePreferences(value: unknown, fallback: string[]): string[] {
    if (Array.isArray(value)) {
      const normalized = value.map((item) => String(item).trim()).filter(Boolean);
      return normalized.length > 0 ? normalized : fallback;
    }
    if (typeof value === "string" && value.trim()) {
      const normalized = value
        .split(/[、,，\s]+/)
        .map((item) => item.trim())
        .filter(Boolean);
      return normalized.length > 0 ? normalized : fallback;
    }
    return fallback;
  }

  private defaultConstraints(input: PlanRequest): UserConstraints {
    return {
      city: input.city ?? "南京",
      startPoint: input.startPoint ?? "新街口",
      durationMinutes: input.durationMinutes ?? undefined,
      budget: undefined,
      preferences: input.preferences ?? [],
      peopleCount: input.peopleCount ?? 1,
      transportMode: input.transportMode ?? "mixed",
      weatherPreference: input.weatherPreference ?? undefined,
      weatherRisk: input.weatherRisk
    };
  }

  private selectStops(state: CityWalkGraphState): RouteStop[] {
    const sorted = [...state.candidatePois].sort((left, right) => {
      const leftScore = (left.rating ?? 4) * 10 - left.averageCost / 5 + (left.indoor && state.weatherRisk === "high" ? 20 : 0);
      const rightScore = (right.rating ?? 4) * 10 - right.averageCost / 5 + (right.indoor && state.weatherRisk === "high" ? 20 : 0);
      return rightScore - leftScore;
    });
    const stops: RouteStop[] = [];
    let cost = 0;
    let minutes = 0;
    const hasTimeLimit = state.constraints.durationMinutes != null;
    const timeCap = state.constraints.durationMinutes ?? 240;
    const routeBuffer = Math.max(30, Math.round(timeCap * 0.25));

    for (const poi of sorted) {
      // Skip user-specified endpoint — added separately at the end
      if (state.constraints.endPoint && poi.name === state.constraints.endPoint) continue;

      const stay = this.estimateStayMinutes(poi.category);
      // Budget check only if user specified a budget
      if (state.constraints.budget != null && cost + poi.averageCost > state.constraints.budget) {
        continue;
      }
      if (hasTimeLimit && minutes + stay + routeBuffer > state.constraints.durationMinutes!) {
        continue;
      }
      stops.push({
        name: poi.name,
        category: poi.category,
        estimatedCost: poi.averageCost,
        estimatedStayMinutes: stay,
        reason: state.weatherRisk === "high" && poi.indoor ? "天气风险较高，优先选择室内点位" : "符合偏好、预算与时间约束",
        location: poi.location,
        address: poi.address,
        rating: poi.rating,
        distanceMeters: poi.distanceMeters
      });
      cost += poi.averageCost;
      minutes += stay;
      if (stops.length >= 4) break;
    }

    // Append endPoint as the last stop if specified
    if (state.constraints.endPoint) {
      const epPoi = state.candidatePois.find(p => p.name === state.constraints.endPoint);
      if (epPoi && !stops.some(s => s.name === state.constraints.endPoint)) {
        const stay = this.estimateStayMinutes(epPoi.category);
        stops.push({
          name: epPoi.name,
          category: epPoi.category,
          estimatedCost: epPoi.averageCost,
          estimatedStayMinutes: stay,
          reason: "用户指定的终点",
          location: epPoi.location,
          address: epPoi.address,
          rating: epPoi.rating,
          distanceMeters: epPoi.distanceMeters
        });
        cost += epPoi.averageCost;
        minutes += stay;
      }
    }

    return stops;
  }

  private detectViolations(state: CityWalkGraphState): string[] {
    const violations: string[] = [];
    if (state.weatherRisk === "high" && state.selectedStops.some((stop) => ["park", "sight"].includes(stop.category))) {
      violations.push("天气风险较高但路线包含户外点位");
    }
    if (state.constraints.budget != null && state.totalEstimatedCost > state.constraints.budget) {
      violations.push(`预算超支 ${state.totalEstimatedCost - state.constraints.budget} 元`);
    }
    if (state.constraints.durationMinutes != null && state.totalEstimatedMinutes > state.constraints.durationMinutes) {
      violations.push(`路线超时 ${state.totalEstimatedMinutes - state.constraints.durationMinutes} 分钟`);
    }
    if (state.selectedStops.length === 0) {
      violations.push("没有生成可用点位");
    }
    return violations;
  }

  private chooseCorrection(state: CityWalkGraphState, violations: string[]): string {
    if (violations.some((item) => item.includes("天气"))) {
      return "触发天气反思：移除户外点位，优先用博物馆、书店、商场等室内 POI 替换。";
    }
    if (violations.some((item) => item.includes("预算"))) {
      return "触发预算反思：按消费降序移除高价点位，并保留评分较高的免费/低价点位。";
    }
    if (violations.some((item) => item.includes("超时"))) {
      return "触发时间反思：按价值密度压缩路线，移除停留时间长且评分收益较低的点位。";
    }
    return "触发可用性反思：放宽关键词并选择默认室内点位。";
  }

  private applyCorrection(state: CityWalkGraphState, correction: string): RouteStop[] {
    let stops = [...state.selectedStops];
    const isEndpoint = (s: RouteStop) => state.constraints.endPoint && s.name === state.constraints.endPoint;

    if (correction.includes("天气")) {
      // Don't remove the user-specified endpoint
      stops = stops.filter((stop) => isEndpoint(stop) || !["park", "sight"].includes(stop.category));
      const indoorCandidates = state.candidatePois.filter((poi) => poi.indoor && !stops.some((stop) => stop.name === poi.name));
      for (const poi of indoorCandidates) {
        if (stops.length >= 3) break;
        stops.push({
          name: poi.name,
          category: poi.category,
          estimatedCost: poi.averageCost,
          estimatedStayMinutes: this.estimateStayMinutes(poi.category),
          reason: "反思修正后加入的室内备选点",
          location: poi.location,
          address: poi.address,
          rating: poi.rating
        });
      }
    }
    if (correction.includes("预算") && state.constraints.budget != null) {
      const endpointStop = stops.find(isEndpoint);
      const normalStops = stops.filter(s => !isEndpoint(s)).sort((a, b) => a.estimatedCost - b.estimatedCost);
      let costSum = normalStops.reduce((s, st) => s + st.estimatedCost, 0) + (endpointStop?.estimatedCost ?? 0);
      while (costSum > state.constraints.budget && normalStops.length > 0) {
        const removed = normalStops.pop()!;
        costSum -= removed.estimatedCost;
      }
      stops = [...normalStops];
      if (endpointStop) stops.push(endpointStop);
    }
    if (correction.includes("时间")) {
      // Separate endpoint from normal stops
      const endpointStop = stops.find(isEndpoint);
      const normalStops = stops.filter(s => !isEndpoint(s));
      normalStops.sort((a, b) => ((b.rating ?? 4) / Math.max(1, b.estimatedStayMinutes)) - ((a.rating ?? 4) / Math.max(1, a.estimatedStayMinutes)));
      let timeSum = normalStops.reduce((s, st) => s + st.estimatedStayMinutes, 0) + (endpointStop?.estimatedStayMinutes ?? 0);
      const cap = state.constraints.durationMinutes ?? 240;
      while (timeSum > cap * 0.75 && normalStops.length > 0) {
        const removed = normalStops.pop()!;
        timeSum -= removed.estimatedStayMinutes;
      }
      stops = [...normalStops];
      if (endpointStop) stops.push(endpointStop);
    }
    return stops;
  }

  private buildFinalAnswer(state: CityWalkGraphState): string {
    if (state.selectedStops.length === 0) {
      const hasApiKey = !!env.AMAP_KEY;
      const candidateCount = state.candidatePois.length;
      const prefList = (state.constraints.preferences ?? []).join("、") || "默认";
      const diag = !hasApiKey
        ? "（高德 API Key 未配置，无法搜索真实 POI 数据）"
        : candidateCount === 0
          ? `（高德 API 已调用但未返回结果，请检查 Key 权限或网络）`
          : `（搜索到 ${candidateCount} 个候选点，但均不满足当前约束）`;
      return `从${state.constraints.startPoint}出发暂未找到合适的路线。搜索偏好：${prefList}。${diag}`;
    }

    const stops = state.selectedStops;
    const legs = state.routeLegs ?? [];

    const modeLabel = (mode: string) => mode === "transit" ? "公交地铁" : "步行";

    const routeParts = stops.map((stop, index) => {
      const leg = legs[index];
      const legInfo = leg ? `${modeLabel(leg.mode)}${leg.durationMinutes}分钟` : '';
      const isEnd = state.constraints.endPoint && stop.name === state.constraints.endPoint;
      if (index === 0) {
        return `${index + 1}. 从${state.constraints.startPoint}出发，${legInfo}到达 ${stop.name}（停留${stop.estimatedStayMinutes}分钟，约${stop.estimatedCost}元）${isEnd ? '【终点】' : ''}`;
      }
      return `${index + 1}. ${legInfo}到达 ${stop.name}（停留${stop.estimatedStayMinutes}分钟，约${stop.estimatedCost}元）${isEnd ? '【终点】' : ''}`;
    });

    const route = routeParts.join('。');
    const walkTime = legs.filter(l => l.mode === 'walk').reduce((s, l) => s + l.durationMinutes, 0);
    const transitTime = legs.filter(l => l.mode === 'transit').reduce((s, l) => s + l.durationMinutes, 0);
    const timeBreakdown = [walkTime > 0 && `步行${walkTime}分钟`, transitTime > 0 && `公交地铁${transitTime}分钟`].filter(Boolean).join(' + ');
    const stayTime = stops.reduce((s, st) => s + st.estimatedStayMinutes, 0);

    const weatherNote =
      state.weatherRisk === "high"
        ? "当前方案已按高天气风险优先选择室内点位。"
        : state.weatherRisk === "medium"
          ? "当前方案保留室内备选，适合应对短时降雨。"
          : "天气风险较低，适合常规 CityWalk。";

    const costInfo = state.constraints.budget != null
      ? `预计总花费 ${state.totalEstimatedCost} 元（预算${state.constraints.budget}元），`
      : `预计总花费约 ${state.totalEstimatedCost} 元，`;

    return `从${state.constraints.startPoint}出发，推荐 ${stops.length} 个点位：${route}。${costInfo}总时长约 ${state.totalEstimatedMinutes} 分钟（路程${timeBreakdown} + 停留${stayTime}分钟）。${weatherNote}`;
  }

  private completeStep(steps: AgentPlanStep[], stepId: string): AgentPlanStep[] {
    return steps.map((item) => (item.id === stepId ? { ...item, status: "completed" } : item));
  }

  private event(
    eventType: StateEvent["event_type"],
    content: string,
    state: CityWalkGraphState,
    stepId?: string,
    toolCall?: StateEvent["tool_call"]
  ): StateEvent {
    return {
      event_type: eventType,
      step_id: stepId,
      total_steps: state.planSteps.length || undefined,
      content,
      tool_call: toolCall,
      timestamp: new Date().toISOString(),
      context_snapshot: {
        budget: state.constraints.budget,
        used_budget: state.totalEstimatedCost,
        duration_minutes: state.constraints.durationMinutes,
        used_minutes: state.totalEstimatedMinutes,
        selected_pois: state.selectedStops.map((stop) => stop.name),
        weather_risk: state.weatherRisk
      }
    };
  }

  private estimateStayMinutes(category: RouteStop["category"]): number {
    const minutes: Record<RouteStop["category"], number> = {
      bookstore: 45,
      cafe: 40,
      sight: 35,
      museum: 60,
      mall: 45,
      park: 40,
      restaurant: 55
    };
    return minutes[category];
  }

  private readonly cityAliases: Record<string, string> = {
    "帝都": "北京", "首都": "北京", "京城": "北京",
    "魔都": "上海", "申城": "上海",
    "金陵": "南京",
    "羊城": "广州", "花城": "广州",
    "鹏城": "深圳",
    "蓉城": "成都", "锦城": "成都",
    "江城": "武汉",
    "山城": "重庆",
    "泉城": "济南", "岛城": "青岛",
    "鹭岛": "厦门",
    "滨城": "大连", "冰城": "哈尔滨",
    "星城": "长沙",
    "古都": "西安", "长安": "西安",
    "杭城": "杭州",
    "姑苏": "苏州",
    "庐州": "合肥",
    "榕城": "福州",
  };

  // Single-char aliases matched ONLY as standalone word (not substring)
  private readonly singleCharAliases: Record<string, string> = {
    "沪": "上海", "穗": "广州", "渝": "重庆", "蓉": "成都",
  };

  private knownCities = [
    "南京", "北京", "上海", "杭州", "苏州", "广州", "深圳", "成都", "西安",
    "武汉", "重庆", "天津", "长沙", "郑州", "青岛", "厦门", "昆明", "大连",
    "宁波", "无锡", "合肥", "福州", "济南", "沈阳", "哈尔滨", "长春", "太原",
    "南昌", "南宁", "贵阳", "兰州", "银川", "海口", "拉萨", "乌鲁木齐"
  ];

  private matchCity(task: string): string | undefined {
    // Multi-char aliases (safe for substring matching)
    for (const [alias, city] of Object.entries(this.cityAliases)) {
      if (task.includes(alias)) return city;
    }
    // Single-char aliases — only match as standalone word to avoid false hits
    // e.g. "沪" should match "上海/沪" but NOT in "京沪高速" (handled by multi-char)
    for (const [alias, city] of Object.entries(this.singleCharAliases)) {
      const re = new RegExp(`(^|[^\\w])${alias}($|[^\\w])`);
      if (re.test(task)) return city;
    }
    return this.knownCities.find((city) => task.includes(city));
  }

  private matchStartPoint(task: string): string | undefined {
    return task.match(/从(.{2,12}?)(?:出发|开始|起步)/)?.[1]?.trim();
  }

  private matchDuration(task: string): number | undefined {
    const hourMatch = task.match(/(\d+(?:\.\d+)?)\s*(?:小时|h)/i);
    if (hourMatch) return Math.round(Number(hourMatch[1]) * 60);
    const minuteMatch = task.match(/(\d+)\s*(?:分钟|min)/i);
    if (minuteMatch) return Number(minuteMatch[1]);
    return undefined;
  }

  private matchBudget(task: string): number | undefined {
    return Number(task.match(/(?:预算|人均|花费|控制在)?\s*(\d+)\s*(?:元|块)/)?.[1]) || undefined;
  }

  private matchPeopleCount(task: string): number | undefined {
    return Number(task.match(/(\d+)\s*(?:个人|人)/)?.[1]) || undefined;
  }

  private matchEndPoint(task: string): string | undefined {
    // "最后一个地点是XX", "终点XX", "最后到/到达XX", "终点站XX", "以XX为终点", "终点设为XX"
    const patterns = [
      /(?:最后一个地点|终点站|结束于)(?:是|在|为|设为)?\s*(.{2,15}?)(?:[。，,\s]|$)/,
      /最后(?:到|到达)\s*(.{2,15}?)(?:[。，,\s]|$)/,
      /以(.{2,15}?)为终点/,
      /终点(?:是|为|设在?)?\s*(.{2,15}?)(?:[。，,\s]|$)/,
    ];
    for (const re of patterns) {
      const m = task.match(re);
      if (m) return m[1].trim();
    }
    return undefined;
  }

  private matchMaxLegMinutes(task: string): number | undefined {
    // "之间.*不超过30分钟", "交通.*30分钟以内", "步行.*30分钟以内", "不超过30分钟"
    const m = task.match(/(?:之间|交通|步行|每个|各段|每段).{0,8}?(\d+)\s*分钟/);
    if (m) return Number(m[1]);
    const m2 = task.match(/(?:不超过|以内|之内)\s*(\d+)\s*分钟/);
    if (m2) return Number(m2[1]);
    return undefined;
  }

  private matchPreferences(task: string): string[] {
    const allPrefs = ["书店", "咖啡", "博物馆", "美术馆", "展览", "公园", "街区", "商场", "美食", "餐厅", "景点", "奶茶", "甜品", "影院"];
    const matched = allPrefs.filter((keyword) => task.includes(keyword));
    return matched.length > 0 ? matched : ["书店", "咖啡", "博物馆", "公园", "景点", "美食", "奶茶"];
  }

  private describeStructuredInput(input: PlanRequest): string {
    const budgetNote = input.budget != null ? `，预算${input.budget}元` : '';
    const timeNote = input.durationMinutes != null ? `${input.durationMinutes}分钟` : '不限时';
    return `${input.city ?? "南京"} CityWalk：从${input.startPoint ?? "新街口"}出发，${timeNote}${budgetNote}，偏好${(input.preferences ?? ["书店", "咖啡"]).join("、")}`;
  }
}
