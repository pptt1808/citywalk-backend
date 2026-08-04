import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import {
  AccessibilityConstraints,
  AgentIntent,
  AgentPlanStep,
  AgentResponseKind,
  ContentSection,
  ConstraintTradeoff,
  ConstraintLedgerEntry,
  ConstraintPriority,
  ConstraintSource,
  IntentClassification,
  IntentResponsePayload,
  InformationSource,
  PartyConstraints,
  PlanningResult,
  PlanRequest,
  RouteExperienceConstraints,
  RouteOverview,
  RouteLeg,
  RouteStop,
  StateEvent,
  TraceStep,
  StyleIntent,
  UserConstraints
} from "../types/plan";
import { env } from "../config/env";
import { LlmRouter } from "../llm/llmRouter";
import { MemoryContext } from "../types/memory";
import { memoryService } from "../services/memoryService";
import { memoryStore } from "../services/memoryStore";
import { HistoryEntry, historyStore } from "../services/historyStore";
import { MapTool, Poi } from "../tools/mapTool";
import { WeatherContext, WeatherTool } from "../tools/weatherTool";
import { WebSearchTool, webSearchTool as defaultWebSearchTool } from "../tools/webSearchTool";
import { throwIfAborted } from "../utils/httpClient";
import {
  compileHeuristicStyle,
  emptyStyleIntent,
  isStyleActive,
  mergeStyleIntents,
  normalizeStyleIntent,
  StyleMatcher,
  styleMatcher as defaultStyleMatcher
} from "../services/styleService";

const CityWalkState = Annotation.Root({
  task: Annotation<string>(),
  rawInput: Annotation<PlanRequest>(),
  intent: Annotation<IntentClassification>(),
  responseKind: Annotation<AgentResponseKind>(),
  intentResponse: Annotation<IntentResponsePayload | undefined>(),
  referenceRoute: Annotation<HistoryEntry | undefined>(),
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
  }),
  memoryContext: Annotation<MemoryContext | undefined>(),
  abortSignal: Annotation<AbortSignal | undefined>()
});

type CityWalkGraphState = typeof CityWalkState.State;

const POI_CATEGORY_WORDS: Record<RouteStop["category"], readonly string[]> = {
  bookstore: ["书店", "书局"],
  cafe: ["咖啡", "咖啡店", "咖啡馆"],
  sight: ["景点", "街区"],
  museum: ["博物馆", "美术馆", "展馆"],
  mall: ["商场", "购物中心"],
  park: ["公园", "绿地", "花园"],
  restaurant: ["餐厅", "饭店", "吃饭", "美食店"]
};

/**
 * Extract only the place/category being replaced or removed.  Route-edit
 * requests often contain an earlier clause such as "保留书店"; allowing a
 * match to cross punctuation would incorrectly remove that retained stop.
 */
export function extractRouteRemovalTarget(task: string): string {
  const beforeAction = task.match(
    /(?:把|将)\s*([^，。；,;]{1,30}?)(?:换成|替换成|改成|换掉|删掉|删除|去掉|移除)/u
  )?.[1];
  if (beforeAction) return beforeAction.trim();

  const bareReplacement = task.match(
    /(?:^|[，。；,;])\s*([^，。；,;]{1,20}?)(?:换成|替换成|改成)/u
  )?.[1];
  if (bareReplacement) return bareReplacement.trim();

  return task.match(/(?:删掉|删除|去掉|移除)\s*([^，。；,;]{1,20})/u)?.[1]?.trim() ?? "";
}
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
    private readonly weatherTool: WeatherTool,
    private readonly styleMatcher: StyleMatcher = defaultStyleMatcher,
    private readonly webSearchTool: WebSearchTool = defaultWebSearchTool
  ) {}

  async run(input: PlanRequest, signal?: AbortSignal): Promise<PlanningResult> {
    // Use the same values stream as SSE. LangGraph's invoke path can retain
    // an internal stream when a node performs long external I/O, while the
    // values stream has deterministic completion and cancellation semantics.
    return this.streamStateEvents(input, () => undefined, signal);
  }

  /**
   * Runs the graph while emitting each batch of new {@link StateEvent} entries as nodes complete.
   * Used for SSE / real-time visualization (F-04).
   */
  async streamStateEvents(input: PlanRequest, onDelta: (events: StateEvent[]) => void, signal?: AbortSignal): Promise<PlanningResult> {
    const graph = this.buildGraph();
    const startedAt = Date.now();
    const initialState = this.buildInitialState(input, signal);
    let prevEventLen = 0;
    const stream = await graph.stream(initialState, signal
      ? { streamMode: "values", recursionLimit: 30, signal }
      : { streamMode: "values", recursionLimit: 30 });
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

  private buildInitialState(input: PlanRequest, signal?: AbortSignal): CityWalkGraphState {
    const task = input.task ?? this.describeStructuredInput(input);
    return {
      task,
      rawInput: input,
      intent: { intent: "route_create", confidence: 0, reason: "尚未进行意图识别" },
      responseKind: "route",
      intentResponse: undefined,
      referenceRoute: undefined,
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
      weatherRisk: input.weatherRisk ?? this.matchWeatherRisk(task),
      needsReplan: false,
      revisionCount: 0,
      finalAnswer: "",
      events: [],
      traceSteps: [],
      decisionLog: [],
      corrections: [],
      llmModels: [],
      memoryContext: undefined,
      abortSignal: signal
    };
  }

  private stateToPlanningResult(state: CityWalkGraphState, startedAt: number): PlanningResult {
    const responseTimeMs = Date.now() - startedAt;
    const finalAnswer = state.finalAnswer || this.buildFinalAnswer(state);
    const tradeoffs = this.buildConstraintTradeoffs(state);
    const routeOverview = state.responseKind === "route" ? this.buildRouteOverview(state, tradeoffs) : undefined;
    const title = routeOverview?.title ?? state.intentResponse?.title ?? "CityWalk 回答";
    const traceSteps = state.traceSteps.concat([{ type: "final_answer", content: finalAnswer }]);

    return {
      intent: state.intent,
      responseKind: state.responseKind,
      title,
      summary: finalAnswer,
      answer: state.intentResponse?.answer,
      sections: state.intentResponse?.sections,
      comparison: state.intentResponse?.comparison,
      socialCopy: state.intentResponse?.socialCopy,
      sources: state.intentResponse?.sources,
      routeOverview,
      totalEstimatedCost: state.totalEstimatedCost,
      totalEstimatedMinutes: state.totalEstimatedMinutes,
      stops: state.selectedStops,
      constraints: state.constraints,
      routeLegs: state.routeLegs,
      startLocation: state.startLocation,
      decisionLog: state.decisionLog,
      planSteps: state.planSteps,
      events: state.events,
      weatherRisk: state.weatherRisk,
      corrections: state.corrections,
      tradeoffs,
      memory: state.memoryContext ? {
        recalled: state.memoryContext.recalled.map((memory) => ({
          id: memory.id,
          kind: memory.kind,
          text: memory.text,
          score: memory.score,
          retrieval: memory.retrieval,
          lexicalScore: memory.lexicalScore,
          vectorScore: memory.vectorScore
        }))
      } : undefined,
      trace: {
        task: state.task,
        steps: traceSteps,
        metadata: {
          model: state.llmModels.at(-1) ?? "heuristic-planner-langgraph-js",
          agent_version: "citywalk-pulse-agent-v0.6-intent-router",
          response_time_ms: responseTimeMs,
          agent_id: "citywalk-pulse"
        }
      }
    };
  }

  private buildGraph() {
    return new StateGraph(CityWalkState)
      .addNode("recall_memory", this.recallMemoryNode.bind(this))
      .addNode("classify_intent", this.classifyIntentNode.bind(this))
      .addNode("respond_non_route", this.respondNonRouteNode.bind(this))
      .addNode("parse", this.parseNode.bind(this))
      .addNode("planner", this.plannerNode.bind(this))
      .addNode("execute", this.executorNode.bind(this))
      .addNode("reflect", this.reflectNode.bind(this))
      .addNode("synthesize", this.synthesizerNode.bind(this))
      .addEdge(START, "recall_memory")
      .addEdge("recall_memory", "classify_intent")
      .addConditionalEdges("classify_intent", this.routeAfterIntent, {
        route: "parse",
        respond: "respond_non_route"
      })
      .addEdge("respond_non_route", END)
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

  private async recallMemoryNode(state: CityWalkGraphState): Promise<CityWalkGraphUpdate> {
    throwIfAborted(state.abortSignal);
    const memoryContext = await memoryService.recall(state.rawInput);
    throwIfAborted(state.abortSignal);
    if (!memoryContext) return { memoryContext: undefined };
    const count = memoryContext.recalled.length;
    const event = this.event(
      "THINK",
      count > 0 ? `为当前任务召回 ${count} 条用户记忆，并按本轮明确要求优先合并。` : "当前用户没有与任务相关的长期记忆。",
      state,
      "memory_recall"
    );
    return {
      memoryContext,
      events: [event],
      traceSteps: [{ type: "thought", content: event.content }],
      decisionLog: [event.content]
    };
  }

  private async classifyIntentNode(state: CityWalkGraphState): Promise<CityWalkGraphUpdate> {
    const heuristic = this.classifyIntentHeuristic(state.task);
    let classification = heuristic;
    let model: string | undefined;
    if (heuristic.confidence < 0.9) {
      try {
        const llm = await this.llmRouter.classifyIntent(
          state.task,
          state.rawInput.preferredModel,
          memoryService.buildPromptContext(state.memoryContext),
          state.abortSignal
        );
        if (llm?.data) {
          classification = llm.data;
          model = `${llm.provider}:${llm.model}`;
        }
      } catch (error) {
        // LLM requests also use AbortError for their own timeout. Only a real
        // client cancellation should stop the graph; provider timeouts degrade
        // to the deterministic branch below.
        if (state.abortSignal?.aborted) throw error;
        console.warn(`[CityWalkGraph] intent classification failed; using deterministic router: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const referenceRoute = historyStore.latestRoute(state.rawInput.userId, state.rawInput.threadId);
    const responseKind = this.responseKindForIntent(classification.intent);
    const content = `识别用户意图为 ${classification.intent}（置信度 ${classification.confidence.toFixed(2)}）：${classification.reason}`;
    const event = this.event("THINK", content, state, "classify_intent");
    event.context_snapshot = {
      ...event.context_snapshot,
      intent: classification.intent,
      response_kind: responseKind
    };
    return {
      intent: classification,
      responseKind,
      referenceRoute,
      events: [event],
      traceSteps: [{ type: "thought", content }],
      decisionLog: [content],
      llmModels: model ? [model] : []
    };
  }

  private routeAfterIntent(state: CityWalkGraphState): "route" | "respond" {
    if (state.intent.intent === "route_create") return "route";
    if (state.intent.intent === "route_modify") {
      const recentRouteContext = Boolean(state.referenceRoute)
        || Boolean(state.memoryContext?.recentMessages.some((message) => message.role === "assistant"));
      return recentRouteContext ? "route" : "respond";
    }
    return "respond";
  }

  private classifyIntentHeuristic(task: string): IntentClassification {
    const normalized = task.trim();
    const classify = (intent: AgentIntent, confidence: number, reason: string): IntentClassification => ({ intent, confidence, reason });

    if (/朋友圈|小红书|微博|社交平台|配文|文案|caption|打卡文案|分享文案/i.test(normalized)) {
      return classify("social_copy", 0.97, "用户要求生成可发布的社交文案");
    }
    if (/(记住|以后|下次).{0,12}(喜欢|不喜欢|不要|避开|偏好)|我(?:很)?(?:喜欢|讨厌|不喜欢).{1,30}(?:地方|路线|景点|咖啡|书店|博物馆|公园)/.test(normalized)) {
      return classify("preference_feedback", 0.94, "用户在表达需要持续生效的偏好反馈");
    }
    if (/你记得我什么|记住了什么|我的(?:长期)?偏好|查看(?:我的)?记忆|关于我的记忆|记忆系统.*(?:内容|状态)/.test(normalized)) {
      return classify("memory_query", 0.97, "用户正在查询长期记忆或个人偏好");
    }
    if (/历史(?:路线|行程|记录)|之前生成(?:过)?的路线|刚才(?:生成)?的路线|上一条路线|最近(?:一次|一条)?路线/.test(normalized)
      && !/改|换|删|加|调整|优化/.test(normalized)) {
      return classify("history_query", 0.96, "用户正在查询已经生成过的路线记录");
    }
    if (/(比较|对比|区别|哪条更好|哪个好|怎么选).{0,30}(路线|行程|方案)|(?:路线|行程|方案).{0,30}(比较|对比|区别|哪条更好|哪个好|怎么选)/.test(normalized)) {
      return classify("route_compare", 0.97, "用户要求比较多个路线或行程方案");
    }
    if (/(上一条|刚才|原来|之前|这条|现有).{0,12}(路线|行程).{0,20}(改|换|删|加|调整|缩短|延长|优化)|(?:把|将)?(?:原有|原来|当前|现有|这条)?(?:路线|行程).{0,16}(?:改|调整|优化|修改|替换|删除|增加|换掉|缩短|延长)|(?:改|调整|优化|修改|替换|删除|增加|换掉).{0,16}(路线|行程|上一站|地点|终点|咖啡|书店|公园|博物馆|景点|商场)/.test(normalized)) {
      return classify("route_modify", 0.97, "用户要求修改现有路线");
    }
    if (/(?:改成|调整为|增加|加上).{0,35}(?:轮椅|无障碍|无台阶|电梯|卫生间|单段步行|休息点)|(?:其他|其余)(?:要求|条件).{0,6}不变/.test(normalized)) {
      return classify("route_modify", 0.96, "用户在保留原路线其余条件的同时修改无障碍或步行约束");
    }
    if (/(评价|评估|检查|复盘|靠谱吗|合理吗|可行吗).{0,20}(路线|行程|方案)|(?:路线|行程|方案).{0,20}(评价|评估|检查|复盘|靠谱吗|合理吗|可行吗)/.test(normalized)) {
      return classify("route_review", 0.95, "用户要求评估已有路线而不是重新制作");
    }
    if (/从\s*[^，。！？?]{1,30}\s*(?:到|去|前往)\s*[^，。！？?]{1,40}(?:怎么走|如何走|坐什么|交通|地铁|公交|骑行|步行)|(?:怎么|如何).{0,8}从\s*[^，。！？?]{1,25}\s*(?:到|去|前往)\s*[^，。！？?]{1,35}/.test(normalized)) {
      return classify("navigation_query", 0.96, "用户询问两个地点之间的点到点交通");
    }
    if (/(?:从.{1,20}(?:出发|开始)|附近).{0,60}(?:\d+(?:\.\d+)?\s*(?:小时|分钟)|预算|想去|想逛|安排|包含)|(?:夜游|漫步|一日游|半日游|探店之旅|city\s*walk).{0,40}(?:预算|小时|想要|避开|喜欢|风格)|(?:\d+(?:\.\d+)?\s*(?:小时|分钟)).{0,40}(?:预算|想去|想逛|安排|包含)/i.test(normalized)) {
      return classify("route_create", 0.94, "用户给出了起点、时长或偏好等路线制作约束");
    }
    if (/(?:出发|开始).{0,60}(?:路线|行程|city\s*walk)|(?:\d+(?:\.\d+)?\s*(?:小时|分钟)).{0,30}(?:路线|行程|city\s*walk)|(?:路线|行程|city\s*walk).{0,30}\d+(?:\.\d+)?\s*(?:小时|分钟)/i.test(normalized)) {
      return classify("route_create", 0.95, "用户给出了明确时长或起点并直接要求路线");
    }
    if (/(附近|周边).{0,20}(有什么|推荐|找|哪家|哪里)|(?:推荐|找|搜).{0,12}(几家|一些|附近|周边).{0,20}(店|馆|景点|公园|餐厅|咖啡|书店|地点)/.test(normalized)
      && !/路线|行程|安排|规划/.test(normalized)) {
      return classify("poi_discovery", 0.95, "用户只想发现地点，没有要求串成完整路线");
    }
    if (/(规划|制定|生成|安排|设计|做一条|来一条|推荐一条|选一条).{0,18}(路线|行程|路径|city\s*walk)|(?:路线|行程|漫游路径|city\s*walk).{0,18}(规划|制定|生成|安排|设计|推荐|选择)/i.test(normalized)) {
      return classify("route_create", 0.97, "用户明确要求制作新的游览路线");
    }
    if (/(?:我要|给我|帮我|想要|我想).{0,18}(?:路线|行程|漫游路径|city\s*walk)/i.test(normalized) && !/什么是|怎么理解|介绍/.test(normalized)) {
      return classify("route_create", 0.93, "用户直接索要一条游览路线");
    }
    if (/开放时间|营业时间|门票|票价|预约|闭馆|地址|在哪|怎么样|值得去吗|天气|下雨|空气质量|预警|基础信息|介绍一下/.test(normalized)) {
      return classify("info_query", 0.94, "用户询问地点、天气或城市基础信息");
    }
    if (/^(你好|您好|嗨|hello|hi|你是谁|你能做什么|谢谢|感谢)[！!。,.，\s]*$/i.test(normalized)) {
      return classify("general_chat", 0.98, "用户进行问候或能力咨询");
    }
    return classify("info_query", 0.58, "语义可能是城市信息咨询，交由模型进一步判断");
  }

  private responseKindForIntent(intent: AgentIntent): AgentResponseKind {
    if (intent === "route_create" || intent === "route_modify") return "route";
    if (intent === "route_compare") return "comparison";
    if (intent === "memory_query" || intent === "history_query") return "memory";
    if (intent === "social_copy") return "social_copy";
    if (intent === "general_chat") return "chat";
    return "information";
  }

  private buildMemoryResponse(state: CityWalkGraphState): IntentResponsePayload {
    const userId = state.rawInput.userId;
    if (!userId) {
      return {
        title: "当前未开启持久记忆",
        answer: "本次请求没有 userId，因此 Agent 只使用当前输入，不能读取或保存跨会话偏好。",
        sections: []
      };
    }
    const memories = memoryStore.list(userId, { limit: 100 }).entries;
    const labels = { semantic: "偏好与事实", episodic: "地点经历", procedural: "规划习惯" } as const;
    const sections: ContentSection[] = (["semantic", "episodic", "procedural"] as const)
      .map((kind) => ({ title: labels[kind], items: memories.filter((item) => item.kind === kind).map((item) => item.text) }))
      .filter((section) => section.items.length > 0);
    return {
      title: "你的 CityWalk 记忆",
      answer: memories.length ? `目前保存了 ${memories.length} 条长期记忆，分为偏好事实、地点经历和规划习惯三类。` : "目前还没有保存长期记忆。",
      sections
    };
  }

  private buildHistoryResponse(referenceRoute?: HistoryEntry): IntentResponsePayload {
    if (!referenceRoute) {
      return { title: "暂未找到历史路线", answer: "当前用户或会话下还没有可用的路线记录。", sections: [] };
    }
    const overview = referenceRoute.result.routeOverview;
    return {
      title: overview?.title ?? referenceRoute.result.title ?? "最近一条路线",
      answer: `最近路线生成于 ${new Date(referenceRoute.createdAt).toLocaleString("zh-CN")}，共 ${referenceRoute.result.stops.length} 站。`,
      sections: [
        { title: "路线", items: referenceRoute.result.stops.map((stop, index) => `${index + 1}. ${stop.name}`) },
        { title: "概要", items: [`预计 ${referenceRoute.result.totalEstimatedMinutes} 分钟`, `预计花费 ¥${referenceRoute.result.totalEstimatedCost}`] }
      ]
    };
  }

  private compactReferenceRoute(entry: HistoryEntry): unknown {
    return {
      id: entry.id,
      createdAt: entry.createdAt,
      title: entry.result.title,
      overview: entry.result.routeOverview,
      stops: entry.result.stops.map((stop) => ({
        name: stop.name, category: stop.category, stayMinutes: stop.estimatedStayMinutes,
        cost: stop.estimatedCost, reason: stop.reason, bookingInfo: stop.bookingInfo
      })),
      routeLegs: entry.result.routeLegs,
      constraints: entry.result.constraints
    };
  }

  private matchNavigationPoints(task: string): { origin: string; destination: string } | undefined {
    const match = task.match(/从\s*(.{1,40}?)\s*(?:到|去|前往)\s*(.{1,40}?)(?:怎么走|如何走|坐什么|的交通|地铁|公交|骑行|步行|[？?。]|$)/);
    if (!match) return undefined;
    const origin = match[1].replace(/^(?:我|我们)\s*/, "").trim();
    const destination = match[2].replace(/(?:应该|比较方便|方便)?\s*$/, "").trim();
    return origin && destination ? { origin, destination } : undefined;
  }

  private matchInfoPlaceName(task: string): string | undefined {
    const normalized = task.replace(/^(?:请问|想问一下|帮我查一下|查询一下)\s*/, "").trim();
    const beforeQuestion = normalized.match(/^(.{2,50}?)(?:需要预约|是否需要预约|要预约|怎么预约|如何预约|开放时间|营业时间|几点开门|几点关门|门票|票价|地址|电话|在哪里|参观注意)/)?.[1];
    const namedPlace = normalized.match(/([\u4e00-\u9fa5A-Za-z0-9·（）()]{2,40}(?:博物院|博物馆|美术馆|纪念馆|公园|景区|书店|咖啡馆|商场|寺|庙|城墙|街区))/)?.[1];
    return (beforeQuestion ?? namedPlace)?.replace(/[，,。？?\s]+$/, "").trim() || undefined;
  }

  private shouldSearchOfficialInfo(task: string): boolean {
    return /预约|门票|票价|开放|营业|闭馆|开门|关门|官网|官方网站|官方公告|临时公告|电话|联系方式|参观须知/.test(task);
  }

  private extractInformationSources(toolFacts: unknown): InformationSource[] {
    if (!toolFacts || typeof toolFacts !== "object") return [];
    const raw = (toolFacts as { webSources?: unknown }).webSources;
    if (!Array.isArray(raw)) return [];
    return raw.filter((source): source is InformationSource => {
      if (!source || typeof source !== "object") return false;
      const item = source as Partial<InformationSource>;
      return typeof item.title === "string"
        && typeof item.url === "string"
        && /^https?:\/\//i.test(item.url)
        && typeof item.domain === "string"
        && (item.sourceType === "official_api" || item.sourceType === "official_link" || item.sourceType === "unverified")
        && item.provider === "tavily";
    }).slice(0, 8);
  }

  private shouldRemoveReferenceStop(stop: Pick<RouteStop, "name" | "category">, task: string): boolean {
    const removalTarget = extractRouteRemovalTarget(task);
    const directRemoval = new RegExp(`${this.escapeRegExp(stop.name)}.{0,8}(?:换掉|替换|删掉|删除|去掉|移除|不要)`).test(task);
    if (directRemoval || removalTarget.includes(stop.name)) return true;
    const removedCategories = (Object.entries(POI_CATEGORY_WORDS) as Array<[RouteStop["category"], readonly string[]]>)
      .filter(([, words]) => words.some((word) => removalTarget.includes(word)))
      .map(([category]) => category);
    // A provider can classify a hybrid venue under the wrong functional
    // category (for example a cafe inside a bookstore as "bookstore").  Its
    // name is stronger evidence when the user explicitly replaces that type.
    if (removedCategories.some((category) => POI_CATEGORY_WORDS[category].some((word) => stop.name.includes(word)))) {
      return true;
    }
    return POI_CATEGORY_WORDS[stop.category].some((word) => removalTarget.includes(word)
      || new RegExp(`(?:不要|删掉|删除|去掉|移除).{0,6}${word}`).test(task));
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private fallbackIntentResponse(intent: AgentIntent, state: CityWalkGraphState, toolFacts: unknown): IntentResponsePayload {
    const facts = (toolFacts ?? {}) as Record<string, unknown>;
    if (intent === "poi_discovery") {
      const pois = Array.isArray(facts.pois) ? facts.pois as Array<Record<string, unknown>> : [];
      return {
        title: `${String(facts.startPoint ?? facts.city ?? "目标区域")}附近地点推荐`,
        answer: pois.length ? `找到 ${pois.length} 个可参考地点；这是地点发现结果，尚未自动串成路线。` : "暂未找到可靠的地点结果，可以补充更精确的位置或地点类型。",
        sections: pois.length ? [{ title: "候选地点", items: pois.map((poi) => [poi.name, poi.category, poi.address, poi.rating ? `评分 ${poi.rating}` : ""].filter(Boolean).join(" · ")) }] : []
      };
    }
    if (intent === "navigation_query") {
      const legs = Array.isArray(facts.legs) ? facts.legs as RouteLeg[] : [];
      return {
        title: `${String(facts.origin ?? "起点")} → ${String(facts.destination ?? "终点")}`,
        answer: legs.length ? `共 ${legs.reduce((sum, leg) => sum + leg.durationMinutes, 0)} 分钟，约 ${legs.reduce((sum, leg) => sum + leg.distanceMeters, 0)} 米。` : "没有获得可用交通结果，请补充明确的起点和终点。",
        sections: legs.length ? [{ title: "交通分段", items: legs.map((leg) => `${leg.origin} → ${leg.destination}：${leg.mode === "transit" ? "公交地铁" : leg.mode === "bicycling" ? "骑行" : "步行"} ${leg.durationMinutes} 分钟`) }] : []
      };
    }
    if (intent === "info_query" && facts.weather) {
      const weather = facts.weather as WeatherContext;
      return {
        title: `${state.rawInput.city ?? this.matchCity(state.task) ?? "当地"}天气`,
        answer: weather.summary,
        sections: [{ title: "出行参考", items: [`降雨概率 ${weather.rainProbability}%`, `风险等级：${weather.risk}`, weather.airQuality ? `空气质量：AQI ${weather.airQuality.aqi}（${weather.airQuality.category}）` : "暂无空气质量数据", weather.warning ? `${weather.warning.title}：${weather.warning.text}` : "当前无天气预警"] }]
      };
    }
    if (intent === "info_query" && facts.poiDetails) {
      const details = facts.poiDetails as Record<string, unknown>;
      const sources = this.extractInformationSources(toolFacts);
      const items = [
        details.address ? `地址：${details.address}` : undefined,
        details.openingHours ? `开放时间：${details.openingHours}` : undefined,
        details.telephone ? `电话：${details.telephone}` : undefined,
        details.rating ? `高德评分：${details.rating}` : undefined,
        Number(details.averageCost) > 0 ? `参考消费：约 ¥${details.averageCost}` : undefined
      ].filter((item): item is string => Boolean(item));
      const asksBooking = /预约|门票|票价/.test(state.task);
      return {
        title: String(details.name ?? "地点信息"),
        answer: asksBooking
          ? "已查询到地点基础信息，但高德地图不提供可核验的官方预约规则；请以场馆官网、官方公众号或小程序的最新公告为准。"
          : items.length ? "已查询到可用的地点基础信息。" : "找到了该地点，但暂未获得更完整的实时详情。",
        sections: [
          ...(items.length ? [{ title: "地点信息", items }] : []),
          { title: "数据说明", items: [`来源：高德地图 Web 服务`, `查询时间：${String(details.sourceUpdatedAt ?? new Date().toISOString())}`, sources.length ? "官网/预约信息来自网页搜索，仍需以场馆最新公告为准" : "预约、临时闭馆和特展票价需要以场馆官方渠道为准"] }
        ],
        sources: sources.length ? sources : undefined
      };
    }
    if (intent === "info_query" && facts.webSources) {
      const sources = this.extractInformationSources(toolFacts);
      return {
        title: "地点官方信息参考",
        answer: sources.length
          ? "已找到相关官网或公开信息。搜索结果只能作为线索，预约名额、临时闭馆和票价请打开来源页面再次确认。"
          : "暂未找到可用的公开来源，请直接访问场馆官方渠道确认。",
        sections: sources.length ? [{ title: "检索摘要", items: sources.map((source) => `${source.title}（${source.sourceType === "official_link" ? "官方域名" : "未核验"}）：${source.snippet ?? "暂无摘要"}`) }] : [],
        sources: sources.length ? sources : undefined
      };
    }
    if (intent === "social_copy") {
      const names = state.referenceRoute?.result.stops.map((stop) => stop.name).slice(0, 4) ?? [];
      const routeText = names.length ? names.join("、") : "今天走过的街巷";
      return {
        title: "CityWalk 分享文案",
        answer: names.length ? "已基于最近路线生成 3 个不同语气的版本。" : "没有找到最近路线，以下文案未写入具体地点。",
        sections: [],
        socialCopy: { basedOnRoute: names.length > 0, variants: [
          { tone: "简洁", text: `${routeText}，把城市重新走了一遍。`, hashtags: ["CityWalk", "城市漫游"] },
          { tone: "轻松", text: `今日份不赶路：在${routeText}慢慢走，刚好遇见城市可爱的一面。`, hashtags: ["周末去哪儿", "CityWalk"] },
          { tone: "记录感", text: `路线不必很远，${routeText}已经装下今天的风景。`, hashtags: ["城市散步", "生活碎片"] }
        ] }
      };
    }
    if (intent === "route_compare") {
      return { title: "路线比较", answer: "可以比较，但目前缺少两条路线的完整信息。请提供路线 A、路线 B 的站点，或先在当前会话生成路线。", sections: [], comparison: { dimensions: [], options: [], recommendation: "", missingInformation: ["至少两条候选路线", "各路线的站点或时间费用信息"] } };
    }
    if (intent === "route_review") {
      return state.referenceRoute
        ? { title: "路线评估", answer: "已找到最近路线；建议重点核对实时开放状态、预约要求和当天交通情况。", sections: [{ title: "路线站点", items: state.referenceRoute.result.stops.map((stop) => stop.name) }] }
        : { title: "缺少待评估路线", answer: "请提供要评估的路线，或先在当前会话生成一条路线。", sections: [] };
    }
    if (intent === "general_chat") {
      return { title: "CityWalk Agent", answer: "我可以查地点与天气、制作/修改/比较路线、评估路线、查询记忆，并基于路线生成分享文案。", sections: [] };
    }
    if (intent === "info_query" && this.matchInfoPlaceName(state.task)) {
      return {
        title: `${this.matchInfoPlaceName(state.task)}信息查询`,
        answer: "已识别到具体地点，但当前没有可用的实时地点数据源。请以场馆官方渠道确认开放时间、预约和票价信息。",
        sections: [{ title: "建议核验", items: ["场馆官网或官方公众号", "官方预约小程序", "当天临时闭馆公告"] }]
      };
    }
    return { title: "信息查询", answer: "这项信息需要更明确的地点或实时数据来源。请补充城市、地点名称或想确认的具体事项。", sections: [] };
  }

  private async respondNonRouteNode(state: CityWalkGraphState): Promise<CityWalkGraphUpdate> {
    const intent = state.intent.intent;
    const events: StateEvent[] = [];
    const traceSteps: TraceStep[] = [];
    let toolFacts: unknown;

    if (intent === "memory_query") {
      const response = this.buildMemoryResponse(state);
      const event = this.event("RESULT", response.answer, state, "memory_query");
      return { intentResponse: response, finalAnswer: response.answer, events: [event], decisionLog: ["返回用户长期记忆摘要。"] };
    }
    if (intent === "history_query") {
      const response = this.buildHistoryResponse(state.referenceRoute);
      const event = this.event("RESULT", response.answer, state, "history_query");
      return { intentResponse: response, finalAnswer: response.answer, events: [event], decisionLog: ["返回最近路线记录。"] };
    }
    if (intent === "preference_feedback") {
      const persisted = Boolean(state.rawInput.userId);
      const response: IntentResponsePayload = {
        title: persisted ? "偏好反馈已接收" : "偏好反馈已接收，但未开启持久记忆",
        answer: persisted
          ? "我会把这条明确反馈交给记忆系统处理；后续规划会优先参考，本轮明确要求仍然最高。"
          : "当前请求没有 userId，因此只能在本次回答中理解，无法持久保存。",
        sections: [{ title: "本轮反馈", items: [state.task] }]
      };
      const event = this.event("RESULT", response.answer, state, "preference_feedback");
      return { intentResponse: response, finalAnswer: response.answer, events: [event], decisionLog: [response.answer] };
    }
    if (intent === "route_modify") {
      const response: IntentResponsePayload = {
        title: "缺少可修改的路线",
        answer: "当前会话中没有找到上一条完整路线。请先生成路线，或在本轮补充城市、起点和要保留/替换的地点。",
        sections: [{ title: "建议补充", items: ["城市与起点", "要保留或删除的地点", "新的时间、预算或同行要求"] }]
      };
      const event = this.event("RESULT", response.answer, state, "route_modify");
      return { intentResponse: response, finalAnswer: response.answer, responseKind: "information", events: [event] };
    }

    const city = this.normalizeCityName(
      state.rawInput.city ?? this.matchCity(state.task) ?? state.referenceRoute?.result.constraints.city
    ) ?? "当地";
    if (intent === "info_query" && /天气|下雨|降雨|空气|预警/.test(state.task)) {
      const action = this.event("ACTION", `查询${city}天气事实。`, state, "intent_weather", { tool: "get_weather", input: { city } });
      const weather = await this.weatherTool.getWeatherContext(city, state.abortSignal);
      const obs = this.event("OBS", weather.summary, state, "intent_weather", { tool: "get_weather", input: { city }, output: weather });
      events.push(action, obs);
      traceSteps.push({ type: "tool_call", tool: "get_weather", input: { city } }, { type: "tool_result", tool: "get_weather", output: weather });
      toolFacts = { weather };
    }
    if (intent === "info_query" && !/天气|下雨|降雨|空气|预警/.test(state.task)) {
      const placeName = this.matchInfoPlaceName(state.task);
      if (placeName) {
        const input = { city, placeName };
        const action = this.event("ACTION", `查询${placeName}的地点详情。`, state, "intent_poi_detail", { tool: "get_poi_details", input });
        const shouldSearchOfficial = this.shouldSearchOfficialInfo(state.task);
        const [details, webSources] = await Promise.all([
          this.mapTool.getPoiDetails(placeName, city, state.abortSignal).catch((error) => {
            if (state.abortSignal?.aborted) throw error;
            console.warn(`[CityWalkGraph] POI detail lookup failed: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
          }),
          shouldSearchOfficial
            ? this.webSearchTool.searchVenueOfficialInfo(placeName, city, state.task, state.abortSignal).catch((error) => {
              if (state.abortSignal?.aborted) throw error;
              console.warn(`[CityWalkGraph] official web search failed: ${error instanceof Error ? error.message : String(error)}`);
              return [] as InformationSource[];
            })
            : Promise.resolve([] as InformationSource[])
        ]);
        const obs = this.event("OBS", details ? `获得${details.name}的基础详情。` : `未找到${placeName}的可靠地点详情。`, state, "intent_poi_detail", { tool: "get_poi_details", input, output: details });
        events.push(action, obs);
        traceSteps.push({ type: "tool_call", tool: "get_poi_details", input }, { type: "tool_result", tool: "get_poi_details", output: details });
        if (webSources.length > 0) {
          const webInput = { city, placeName, question: state.task };
          const webAction = this.event("ACTION", `搜索${placeName}的官网、预约和临时公告信息。`, state, "official_web_search", {
            tool: "web_search",
            input: webInput
          });
          const webObs = this.event("OBS", `搜索到 ${webSources.length} 条来源，其中 ${webSources.filter((source) => source.sourceType === "official_link").length} 条来自已识别官方域名。`, state, "official_web_search", {
            tool: "web_search",
            input: webInput,
            output: webSources
          });
          events.push(webAction, webObs);
          traceSteps.push(
            { type: "tool_call", tool: "web_search", input: webInput },
            { type: "tool_result", tool: "web_search", output: webSources }
          );
        }
        toolFacts = details
          ? { city, poiDetails: details, webSources }
          : { city, placeName, webSources };
      }
    }
    if (intent === "poi_discovery") {
      const startPoint = state.rawInput.startPoint ?? this.matchStartPoint(state.task);
      const location = startPoint ? await this.mapTool.geocode(startPoint, city, state.abortSignal) : undefined;
      const styleHints = compileHeuristicStyle(state.task).searchHints;
      const keywords = [...new Set([...this.matchExplicitPreferences(state.task), ...styleHints])];
      if (!keywords.length) keywords.push(state.task.replace(/[？?。]/g, "").slice(0, 40));
      const input = { city, startPoint, location, keywords };
      const action = this.event("ACTION", "按地点发现意图搜索 POI，不生成完整路线。", state, "poi_discovery", {
        tool: location ? "search_poi_nearby" : "search_poi", input
      });
      const pois = await this.mapTool.searchNearbyPoi(keywords, { city, location, radius: 5000, signal: state.abortSignal });
      const facts = pois.slice(0, 12).map((poi) => ({
        name: poi.name, category: poi.category, address: poi.address, rating: poi.rating,
        distanceMeters: poi.distanceMeters, averageCost: poi.averageCost
      }));
      const obs = this.event("OBS", `找到 ${facts.length} 个地点候选。`, state, "poi_discovery", {
        tool: location ? "search_poi_nearby" : "search_poi", input, output: facts
      });
      events.push(action, obs);
      traceSteps.push(
        { type: "tool_call", tool: location ? "search_poi_nearby" : "search_poi", input },
        { type: "tool_result", tool: location ? "search_poi_nearby" : "search_poi", output: facts }
      );
      toolFacts = { city, startPoint, pois: facts };
    }
    if (intent === "navigation_query") {
      const points = this.matchNavigationPoints(state.task);
      const originName = state.rawInput.startPoint ?? points?.origin;
      const destinationName = state.rawInput.endPoint ?? points?.destination;
      const mode = state.rawInput.transportMode ?? this.matchTransportMode(state.task) ?? "mixed";
      let legs: RouteLeg[] = [];
      if (originName && destinationName) {
        const [origin, destination] = await Promise.all([
          this.mapTool.geocode(originName, city, state.abortSignal), this.mapTool.geocode(destinationName, city, state.abortSignal)
        ]);
        if (origin && destination) {
          legs = (await this.mapTool.planRoute(origin, [destination], mode, city, state.abortSignal)).map((leg) => ({
            ...leg,
            originName,
            destinationName
          }));
        }
      }
      const input = { city, origin: originName, destination: destinationName, mode };
      const action = this.event("ACTION", "查询点到点交通，不生成游览路线。", state, "navigation_query", { tool: "plan_route", input });
      const obs = this.event("OBS", legs.length ? `获得 ${legs.length} 段交通结果。` : "缺少可用地点坐标或路径结果。", state, "navigation_query", {
        tool: "plan_route", input, output: legs
      });
      events.push(action, obs);
      traceSteps.push({ type: "tool_call", tool: "plan_route", input }, { type: "tool_result", tool: "plan_route", output: legs });
      toolFacts = { ...input, legs };
    }
    if (intent === "route_review") {
      toolFacts = state.referenceRoute ? this.compactReferenceRoute(state.referenceRoute) : undefined;
    }

    const referenceRoute = state.referenceRoute ? this.compactReferenceRoute(state.referenceRoute) : undefined;
    let response: IntentResponsePayload | undefined;
    let model: string | undefined;
    try {
      const llm = await this.llmRouter.respondToIntent(
        intent as Exclude<AgentIntent, "route_create" | "route_modify" | "memory_query">,
        state.task,
        {
          conversation: memoryService.buildPromptContext(state.memoryContext),
          referenceRoute,
          toolFacts
        },
        state.rawInput.preferredModel,
        state.abortSignal
      );
      response = llm?.data;
      if (llm) model = `${llm.provider}:${llm.model}`;
    } catch (error) {
      if (state.abortSignal?.aborted) throw error;
      console.warn(`[CityWalkGraph] non-route response failed; using deterministic response: ${error instanceof Error ? error.message : String(error)}`);
    }
    response ??= this.fallbackIntentResponse(intent, state, toolFacts);
    const serverSources = this.extractInformationSources(toolFacts);
    if (serverSources.length > 0) response = { ...response, sources: serverSources };
    const resultEvent = this.event("RESULT", response.answer || response.title, state, intent);
    events.push(resultEvent);
    traceSteps.push({ type: "thought", content: `完成 ${intent} 专用分支。` });
    return {
      intentResponse: response,
      finalAnswer: response.answer || response.title,
      events,
      traceSteps,
      decisionLog: [`${intent} 分支完成，未进入路线制作循环。`],
      llmModels: model ? [model] : []
    };
  }

  private async parseNode(state: CityWalkGraphState): Promise<CityWalkGraphUpdate> {
    const fallbackConstraints = state.intent.intent === "route_modify" && state.referenceRoute
      ? state.referenceRoute.result.constraints
      : this.parseConstraints(state.rawInput);
    const previousUserTask = state.memoryContext?.recentMessages
      .filter((message) => message.role === "user")
      .at(-1)?.content ?? state.referenceRoute?.request.task;
    const currentTransportMode = this.matchTransportMode(state.task);
    const previousTransportMode = previousUserTask ? this.matchTransportMode(previousUserTask) : undefined;
    const currentWeatherPreference = this.matchWeatherPreference(state.task);
    const previousWeatherPreference = previousUserTask ? this.matchWeatherPreference(previousUserTask) : undefined;
    const currentWeatherRisk = this.matchWeatherRisk(state.task);
    const previousWeatherRisk = previousUserTask ? this.matchWeatherRisk(previousUserTask) : undefined;
    const previousPeopleCount = previousUserTask ? this.matchPeopleCount(previousUserTask) : undefined;
    const currentParty = this.matchPartyConstraints(state.task);
    const previousParty = previousUserTask ? this.matchPartyConstraints(previousUserTask) : {};
    const currentExperience = this.matchExperienceConstraints(state.task);
    const previousExperience = previousUserTask ? this.matchExperienceConstraints(previousUserTask) : {};
    const currentAccessibility = this.matchAccessibilityConstraints(state.task);
    const previousAccessibility = previousUserTask ? this.matchAccessibilityConstraints(previousUserTask) : {};
    const requestStyle = mergeStyleIntents(
      state.rawInput.style,
      state.rawInput.styleDescription ? compileHeuristicStyle(state.rawInput.styleDescription, true) : undefined
    );
    const currentStyle = compileHeuristicStyle(state.task);
    const previousStyle = previousUserTask ? compileHeuristicStyle(previousUserTask) : emptyStyleIntent();
    const llmParseAttempt = await this.tryParseConstraintsWithLlm(
      state.task,
      state.rawInput,
      memoryService.buildPromptContext(state.memoryContext),
      state.abortSignal
    );
    const llmParsed = llmParseAttempt.result;
    // Modification turns are patches over an existing route. Deterministic
    // current-turn matches plus prior constraints are authoritative; allowing
    // the LLM to fill absent operational fields can invent extra people,
    // restroom requirements, transport changes, or preferences.
    const allowLlmOperationalMerge = state.intent.intent !== "route_modify";

    // Priority: explicit frontend field > deterministic current-turn match > LLM
    // extraction > recent context > neutral missing-value marker. A new explicit
    // city must also invalidate an inherited start/end point from another city.
    const matchedCityCandidate = this.matchCity(state.task);
    const requestCity = this.normalizeCityName(state.rawInput.city);
    const previousCity = this.normalizeCityName(previousUserTask ? this.matchCity(previousUserTask) : undefined)
      ?? this.normalizeCityName(state.referenceRoute?.result.constraints.city);
    const explicitCityRetargetCue = /(?:城市|目的地).{0,8}(?:改|换|调整|迁移|变更)(?:成|到|为)?/u.test(state.task);
    const matchedCityIsKnown = Boolean(matchedCityCandidate && [
      ...this.knownCities,
      ...Object.values(this.cityAliases)
    ].some((city) => this.sameCity(city, matchedCityCandidate)));
    const matchedCity = state.intent.intent === "route_modify"
      && Boolean(previousCity)
      && !matchedCityIsKnown
      && !explicitCityRetargetCue
      ? undefined
      : matchedCityCandidate;
    const llmCityCandidate = this.normalizeCityName((llmParsed?.data as Record<string, unknown> | undefined)?.city);
    // A modification turn commonly mentions weather, style, duration or POIs
    // without repeating the city. Do not let a malformed LLM extraction turn
    // those phrases into a new city and discard the reference route.
    const preservePreviousCity = state.intent.intent === "route_modify"
      && Boolean(previousCity)
      && !requestCity
      && !matchedCity
      && !explicitCityRetargetCue;
    const llmCity = preservePreviousCity ? undefined : llmCityCandidate;
    const fallbackCity = this.normalizeCityName(fallbackConstraints.city);
    const currentCity = requestCity
      ?? matchedCity
      ?? llmCity;
    const city = currentCity
      ?? previousCity
      ?? (fallbackCity && fallbackCity !== UNSPECIFIED_CITY ? fallbackCity : undefined)
      ?? UNSPECIFIED_CITY;
    const cityChanged = Boolean(currentCity && previousCity && !this.sameCity(currentCity, previousCity));

    const matchedStart = this.matchStartPoint(state.task);
    const llmStart = this.hasExplicitStartPointCue(state.task) ? llmParsed?.data.startPoint?.trim() : undefined;
    const previousStart = !cityChanged && previousUserTask ? this.matchStartPoint(previousUserTask) : undefined;
    const referenceStart = !cityChanged && state.referenceRoute && this.sameCity(state.referenceRoute.result.constraints.city, city)
      ? state.referenceRoute.result.constraints.startPoint
      : undefined;
    const fallbackStart = !cityChanged && fallbackCity && this.sameCity(fallbackCity, city)
      ? fallbackConstraints.startPoint
      : undefined;
    const derivedStart = this.defaultStartPointForCity(city);
    const startPoint = state.rawInput.startPoint?.trim()
      ?? matchedStart
      ?? llmStart
      ?? previousStart
      ?? referenceStart
      ?? (fallbackStart && fallbackStart !== UNSPECIFIED_START_POINT ? fallbackStart : undefined)
      ?? derivedStart;

    const matchedDuration = this.matchDuration(state.task);
    const matchedMaxLeg = this.matchMaxLegMinutes(state.task);
    // A modification such as "单段步行不超过 15 分钟" describes a leg
    // limit, not a new 15-minute itinerary. The deterministic matcher already
    // excludes it; also ignore an LLM duration extracted from the same phrase
    // so the previous route duration can be inherited safely.
    const llmDuration = !allowLlmOperationalMerge
      ? undefined
      : llmParsed?.data.durationMinutes;
    const durationUnlimited = this.hasUnlimitedDuration(state.task);
    const durationMinutes = durationUnlimited
      ? undefined
      : state.rawInput.durationMinutes
        ?? matchedDuration
        ?? llmDuration
        ?? (previousUserTask ? this.matchDuration(previousUserTask) : undefined)
        ?? fallbackConstraints.durationMinutes;

    const matchedBudget = this.matchBudget(state.task);
    const budgetUnlimited = this.hasUnlimitedBudget(state.task);
    // An explicit "预算不限" clears a previous-turn limit instead of inheriting it.
    const budget = budgetUnlimited
      ? undefined
      : state.rawInput.budget
        ?? matchedBudget
        ?? (allowLlmOperationalMerge
          ? (llmParsed?.data as Record<string, unknown> | undefined)?.budget as number | undefined
          : undefined)
        ?? (previousUserTask ? this.matchBudget(previousUserTask) : undefined)
        ?? undefined;

    const matchedEndPoint = this.matchEndPoint(state.task);
    const hasExplicitEndPointCue = /(?:终点|结束于|最后(?:到|到达)|以.{1,20}为终点)/u.test(state.task);
    const endPoint = state.rawInput.endPoint
      ?? matchedEndPoint
      ?? (allowLlmOperationalMerge && hasExplicitEndPointCue
        ? (llmParsed?.data as Record<string, unknown> | undefined)?.endPoint as string | undefined
        : undefined)
      ?? (!cityChanged && previousUserTask ? this.matchEndPoint(previousUserTask) : undefined);

    const maxLegMinutes = state.rawInput.maxLegMinutes
      ?? matchedMaxLeg
      ?? (previousUserTask ? this.matchMaxLegMinutes(previousUserTask) : undefined);

    const currentPreferences = this.matchExplicitPreferences(state.task);
    const previousPreferences = previousUserTask ? this.matchExplicitPreferences(previousUserTask) : [];
    const llmPreferences = this.normalizePreferences(
      allowLlmOperationalMerge ? (llmParsed?.data as Record<string, unknown> | undefined)?.preferences : undefined,
      []
    );
    const resolvedPreferences = state.rawInput.preferences?.length
      ? state.rawInput.preferences
      : currentPreferences.length > 0
        ? currentPreferences
        : llmPreferences.length > 0
          ? llmPreferences
          : previousPreferences.length > 0 ? previousPreferences : fallbackConstraints.preferences;
    const removedPreferenceCategories = state.intent.intent === "route_modify"
      ? this.removedPoiCategories(state.task)
      : new Set<RouteStop["category"]>();
    const preferences = resolvedPreferences.filter((preference) =>
      ![...removedPreferenceCategories].some((category) => this.textMatchesPoiCategory(preference, category))
    );
    const preferencesExplicit = Boolean(
      state.rawInput.preferences?.length || currentPreferences.length > 0 || previousPreferences.length > 0
    );

    const resolvedParty = this.resolvePartyConstraints({
      input: state.rawInput,
      current: currentParty,
      llm: allowLlmOperationalMerge ? llmParsed?.data.party : undefined,
      llmPeopleCount: allowLlmOperationalMerge ? llmParsed?.data.peopleCount : undefined,
      previous: previousParty,
      previousPeopleCount,
      fallback: fallbackConstraints.party
    });
    const resolvedAccessibility = this.resolveAccessibilityConstraints({
      input: state.rawInput,
      current: currentAccessibility,
      // Accessibility flags are hard constraints. An LLM may normalize an
      // explicit phrase, but it must not invent elevator/restroom requirements
      // from a generic mention of a stroller, rest stop, or indoor venue.
      llm: allowLlmOperationalMerge
        ? this.groundLlmAccessibility(state.task, llmParsed?.data.accessibility)
        : undefined,
      previous: previousAccessibility,
      fallback: fallbackConstraints.accessibility
    });
    const effectiveParty: PartyConstraints = {
      ...resolvedParty.value,
      mobilityNeeds: [...new Set([
        ...resolvedParty.value.mobilityNeeds,
        resolvedAccessibility.value.wheelchairAccessRequired ? "轮椅通行" : "",
        resolvedAccessibility.value.stepFreeRequired ? "无台阶通行" : ""
      ].filter(Boolean))]
    };
    const resolvedExperience = this.resolveExperienceConstraints({
      input: state.rawInput,
      current: currentExperience,
      llm: allowLlmOperationalMerge ? llmParsed?.data.experience : undefined,
      previous: previousExperience,
      fallback: fallbackConstraints.experience,
      party: effectiveParty,
      accessibility: resolvedAccessibility.value
    });
    const resolvedStyle = this.resolveStyleIntent({
      request: requestStyle,
      current: currentStyle,
      llm: allowLlmOperationalMerge ? llmParsed?.data.style : undefined,
      previous: previousStyle,
      fallback: fallbackConstraints.style
    });
    const effectiveStyle = state.intent.intent === "route_modify"
      ? this.withRemovedRouteCategories(resolvedStyle.value, state.task)
      : resolvedStyle.value;
    const baseLedger = [
      this.constraintLedgerEntry("city", city, this.firstConstraintSource([
        [requestCity, "request"], [matchedCity, "current_turn"], [llmCity, "llm"],
        [previousCity, "recent_context"], [fallbackCity !== UNSPECIFIED_CITY ? fallbackCity : undefined, "default"],
        [city === UNSPECIFIED_CITY ? city : undefined, "default"]
      ]), "hard"),
      this.constraintLedgerEntry("startPoint", startPoint, this.firstConstraintSource([
        [state.rawInput.startPoint, "request"], [matchedStart, "current_turn"], [llmStart, "llm"],
        [previousStart ?? referenceStart, "recent_context"],
        [fallbackStart && fallbackStart !== UNSPECIFIED_START_POINT ? fallbackStart : undefined, "default"],
        [derivedStart, "derived"]
      ]), "hard"),
      this.constraintLedgerEntry("durationMinutes", durationUnlimited ? "unlimited" : durationMinutes, this.firstConstraintSource([
        [durationUnlimited ? "unlimited" : undefined, "current_turn"],
        [state.rawInput.durationMinutes, "request"], [matchedDuration, "current_turn"], [llmDuration, "llm"],
        [previousUserTask ? this.matchDuration(previousUserTask) : undefined, "recent_context"]
      ]), "hard"),
      this.constraintLedgerEntry("budget", budgetUnlimited ? "unlimited" : budget, this.firstConstraintSource([
        [budgetUnlimited ? "unlimited" : undefined, "current_turn"],
        [state.rawInput.budget, "request"], [matchedBudget, "current_turn"], [allowLlmOperationalMerge ? llmParsed?.data.budget : undefined, "llm"],
        [previousUserTask ? this.matchBudget(previousUserTask) : undefined, "recent_context"]
      ]), "hard"),
      this.constraintLedgerEntry("preferences", preferences, this.firstConstraintSource([
        [state.rawInput.preferences?.length ? state.rawInput.preferences : undefined, "request"],
        [currentPreferences.length ? currentPreferences : undefined, "current_turn"],
        [llmPreferences.length ? llmPreferences : undefined, "llm"],
        [previousPreferences.length ? previousPreferences : undefined, "recent_context"],
        [fallbackConstraints.preferences, "default"]
      ]), "soft"),
      this.constraintLedgerEntry("transportMode", state.rawInput.transportMode ?? currentTransportMode ?? previousTransportMode ?? fallbackConstraints.transportMode, this.firstConstraintSource([
        [state.rawInput.transportMode, "request"], [currentTransportMode, "current_turn"],
        [previousTransportMode, "recent_context"], [fallbackConstraints.transportMode, "default"]
      ]), "soft"),
      this.constraintLedgerEntry("maxLegMinutes", maxLegMinutes, this.firstConstraintSource([
        [state.rawInput.maxLegMinutes, "request"], [matchedMaxLeg, "current_turn"],
        [previousUserTask ? this.matchMaxLegMinutes(previousUserTask) : undefined, "recent_context"]
      ]), "hard")
      ,
      this.constraintLedgerEntry("style.rawText", effectiveStyle.rawText, resolvedStyle.source, "soft"),
      this.constraintLedgerEntry("style.summary", effectiveStyle.summary, resolvedStyle.source, "soft"),
      this.constraintLedgerEntry("style.tags", effectiveStyle.tags, resolvedStyle.source, "soft"),
      this.constraintLedgerEntry("style.desiredScenes", effectiveStyle.desiredScenes, resolvedStyle.source, "soft"),
      this.constraintLedgerEntry("style.avoidances", effectiveStyle.avoidances, resolvedStyle.source, "hard"),
      this.constraintLedgerEntry("style.searchHints", effectiveStyle.searchHints, resolvedStyle.source, "soft")
    ].filter((entry): entry is ConstraintLedgerEntry => Boolean(entry));

    const currentTurnConstraints: UserConstraints = {
      city,
      startPoint,
      durationMinutes,
      budget,
      preferences,
      peopleCount: effectiveParty.total,
      party: effectiveParty,
      experience: resolvedExperience.value,
      accessibility: resolvedAccessibility.value,
      style: effectiveStyle,
      constraintLedger: [...baseLedger, ...resolvedParty.ledger, ...resolvedExperience.ledger, ...resolvedAccessibility.ledger],
      transportMode: state.rawInput.transportMode ?? currentTransportMode ?? previousTransportMode ?? fallbackConstraints.transportMode,
      // Route-wide weather policy must come from an explicit cue or live
      // weather, not from a sentence that merely requires one indoor stop.
      weatherPreference: state.rawInput.weatherPreference ?? currentWeatherPreference ?? previousWeatherPreference ?? fallbackConstraints.weatherPreference,
      weatherRisk: state.rawInput.weatherRisk ?? currentWeatherRisk ?? previousWeatherRisk ?? fallbackConstraints.weatherRisk,
      endPoint,
      maxLegMinutes,
      preferencesExplicit,
      transportModeExplicit: Boolean(state.rawInput.transportMode || currentTransportMode || previousTransportMode),
      weatherPreferenceExplicit: Boolean(
        state.rawInput.weatherPreference || currentWeatherPreference || previousWeatherPreference
      ),
      maxLegMinutesExplicit: Boolean(state.rawInput.maxLegMinutes || matchedMaxLeg || (previousUserTask && this.matchMaxLegMinutes(previousUserTask))),
      partyExplicit: resolvedParty.explicit,
      experienceExplicit: resolvedExperience.explicit,
      styleExplicit: resolvedStyle.explicit
    };
    const constraints = memoryService.applyDefaults(currentTurnConstraints, state.rawInput, state.memoryContext);
    const content = llmParsed
      ? `使用 ${llmParsed.model} 解析自然语言约束，并合并表单显式字段。`
      : llmParseAttempt.reason === "unconfigured"
        ? "未配置可用 LLM，使用启发式解析自然语言与表单约束。"
        : llmParseAttempt.reason === "invalid_response"
          ? "LLM 已返回约束解析结果，但部分字段格式不符合协议，已安全降级为启发式解析。"
          : "LLM 约束解析请求失败，已安全降级为启发式解析。";
    const event = this.event("THINK", content, state, "parse");

    const budgetNote = constraints.budget != null ? `预算=${constraints.budget}元，` : '';
    const endNote = constraints.endPoint ? `终点=${constraints.endPoint}，` : '';
    const legNote = constraints.maxLegMinutes ? `单段≤${constraints.maxLegMinutes}分钟，` : '';
    const partyNote = this.describeParty(constraints.party);
    const experienceNote = this.describeExperience(constraints.experience);
    const accessibilityNote = this.describeAccessibility(constraints.accessibility);
    const styleNote = this.describeStyle(constraints.style);

    return {
      constraints,
      weatherRisk: constraints.weatherRisk ?? "medium",
      events: [event],
      traceSteps: [{ type: "thought", content: event.content }],
      llmModels: llmParsed ? [`${llmParsed.provider}:${llmParsed.model}`] : [],
      decisionLog: [
        `解析约束：城市=${constraints.city}，起点=${constraints.startPoint}，时长=${constraints.durationMinutes}分钟，${budgetNote}${endNote}${legNote}同行=${partyNote}，体验=${experienceNote || "常规"}，无障碍=${accessibilityNote || "无特殊要求"}，风格=${styleNote || "默认"}，偏好=${(constraints.preferences ?? []).join("、") || "默认"}`
      ]
    };
  }

  private async plannerNode(state: CityWalkGraphState): Promise<CityWalkGraphUpdate> {
    const llmPlan = await this.tryPlanStepsWithLlm(
      state.task,
      state.constraints,
      state.rawInput.preferredModel,
      memoryService.buildPromptContext(state.memoryContext),
      state.abortSignal
    );
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
    if (state.constraints.city === UNSPECIFIED_CITY) {
      const weather: WeatherContext = {
        rainProbability: 0,
        risk: "low",
        summary: "尚未指定城市，暂不查询天气",
        indices: []
      };
      const obs = this.event("OBS", weather.summary, state, step.id, {
        tool: "get_weather",
        input: { city: undefined },
        output: weather
      });
      return {
        weather,
        weatherRisk: state.constraints.weatherRisk ?? "low",
        planSteps: this.completeStep(runningSteps, step.id),
        currentStepIndex: state.currentStepIndex + 1,
        events: [thought, obs],
        traceSteps: [{ type: "thought", content: thought.content }, { type: "tool_result", tool: "get_weather", output: weather }],
        decisionLog: ["城市缺失，跳过天气查询，等待用户补充城市。"]
      };
    }
    const input = { city: state.constraints.city };
    const action = this.event("ACTION", "调用天气工具获取降雨概率、预警、空气质量与生活指数。", state, step.id, {
      tool: "get_weather",
      input
    });
    const weather = await this.weatherTool.getWeatherContext(state.constraints.city, state.abortSignal);
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
    const citySpecified = state.constraints.city !== UNSPECIFIED_CITY;
    const startLocation = citySpecified
      ? state.startLocation ?? (await this.mapTool.geocode(state.constraints.startPoint, state.constraints.city, state.abortSignal))
      : undefined;
    const indoorOnly = state.weatherRisk === "high" || state.constraints.weatherPreference === "indoor_first";
    const searchKeywords = this.buildPoiSearchKeywords(state.constraints);
    const input = {
      city: state.constraints.city,
      location: startLocation,
      keywords: searchKeywords,
      indoorOnly,
      party: state.constraints.party,
      experience: state.constraints.experience,
      accessibility: state.constraints.accessibility,
      style: state.constraints.style
    };
    const action = this.event("ACTION", "调用地图 POI 工具搜索候选点。", state, step.id, {
      tool: startLocation ? "search_poi_nearby" : "search_poi",
      input
    });
    let candidatePois = citySpecified
      ? await this.mapTool.searchNearbyPoi(searchKeywords, {
          city: state.constraints.city,
          location: startLocation,
          indoorOnly,
          radius: 5000,
          signal: state.abortSignal
        })
      : [];
    const mismatchedPoiCount = candidatePois.filter((poi) => !this.isPoiCityCompatible(poi, state.constraints.city)).length;
    candidatePois = candidatePois.filter((poi) => this.isPoiCityCompatible(poi, state.constraints.city));

    // Route modification is an edit operation: keep unaffected stops from the
    // reference route in the candidate set instead of silently rebuilding from scratch.
    if (state.intent.intent === "route_modify" && state.referenceRoute
      && this.sameCity(state.referenceRoute.result.constraints.city, state.constraints.city)) {
      candidatePois = candidatePois.filter((poi) => !this.shouldRemoveReferenceStop(poi, state.task));
      const referencePois: Poi[] = state.referenceRoute.result.stops
        .filter((stop) => !this.shouldRemoveReferenceStop(stop, state.task))
        .map((stop) => ({
          name: stop.name,
          category: stop.category,
          averageCost: stop.estimatedCostPerPerson
            ?? Math.round(stop.estimatedCost / Math.max(1, state.referenceRoute!.result.constraints.party.total)),
          location: stop.location,
          address: stop.address,
          city: stop.city ?? state.referenceRoute!.result.constraints.city,
          rating: Math.max(4.9, stop.rating ?? 0),
          distanceMeters: 0,
          tags: ["原路线保留点", ...(stop.suitabilityTags ?? []), ...(stop.styleMatches ?? [])]
        }));
      candidatePois = [...referencePois, ...candidatePois.filter((poi) => !referencePois.some((reference) => reference.name === poi.name))];
    }

    // If user specified an endPoint, add it as a required last stop
    let endPointPoi: Poi | undefined;
    if (state.constraints.endPoint) {
      const epLocation = await this.mapTool.geocode(state.constraints.endPoint, state.constraints.city, state.abortSignal);
      if (epLocation) {
        endPointPoi = {
          name: state.constraints.endPoint,
          category: "sight" as const,
          averageCost: 0,
          location: epLocation,
          address: state.constraints.endPoint,
          city: state.constraints.city,
          rating: 4.0,
          indoor: false
        };
        candidatePois.push(endPointPoi);
      }
    }

    if (isStyleActive(state.constraints.style)) {
      const styleMatches = await this.styleMatcher.matchPois(state.constraints.style, candidatePois);
      candidatePois = candidatePois.map((poi) => {
        const match = styleMatches.get(poi.name);
        return match ? {
          ...poi,
          styleScore: match.score,
          styleMatches: match.matches,
          styleConflicts: match.conflicts,
          styleRetrieval: match.retrieval
        } : poi;
      });

      // Let the LLM inspect only a small shortlist. It can explain a novel
      // aesthetic, while embeddings/lexical matching still keep the planner
      // functional when the LLM is unavailable.
      const styleShortlist = [...candidatePois]
        .sort((left, right) => (right.styleScore ?? 0) - (left.styleScore ?? 0))
        .slice(0, 12);
      try {
        const ranked = await this.llmRouter.rankPoisForStyle(
          state.constraints.style,
          styleShortlist.map((poi) => ({
            name: poi.name,
            category: poi.category,
            address: poi.address,
            tags: poi.tags
          })),
          state.rawInput.preferredModel,
          state.abortSignal
        );
        if (ranked?.data?.length) {
          const byName = new Map(ranked.data.map((item) => [item.poiName, item]));
          candidatePois = candidatePois.map((poi) => {
            const item = byName.get(poi.name);
            if (!item) return poi;
            const base = poi.styleScore ?? 0;
            // The LLM may echo search hints (for example "老门东") as if
            // every returned business matched them. Keep only explanations
            // grounded in the POI name/category/tags/address, and never let an
            // ungrounded explanation inflate the semantic score.
            const groundedMatches = this.groundStyleExplanations(poi, item.matches ?? [], state.constraints.city);
            const groundedConflicts = this.groundStyleExplanations(poi, item.conflicts ?? [], state.constraints.city)
              .filter((conflict) => !/^(?:无|没有|未发现)$/u.test(conflict));
            const conflicts = [...new Set([...(poi.styleConflicts ?? []), ...groundedConflicts])];
            const rerankedScore = groundedMatches.length
              ? item.score * 0.65 + base * 0.35
              : base;
            return {
              ...poi,
              styleScore: Number(Math.max(0, rerankedScore - groundedConflicts.length * 0.2).toFixed(4)),
              styleMatches: [...new Set([...(poi.styleMatches ?? []), ...groundedMatches])].slice(0, 6),
              styleConflicts: conflicts,
              styleRetrieval: poi.styleRetrieval === "none" ? "lexical" : poi.styleRetrieval
            };
          });
        }
      } catch (error) {
        if (state.abortSignal?.aborted) throw error;
        console.warn(`[CityWalkGraph] style rerank failed; retaining embedding/lexical score: ${error instanceof Error ? error.message : String(error)}`);
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
      decisionLog: [
        citySpecified
          ? `候选 POI 数量：${candidatePois.length}${mismatchedPoiCount ? `；已剔除 ${mismatchedPoiCount} 个跨城市结果` : ""}。`
          : "未指定城市，跳过 POI 搜索，不使用任何默认城市。"
      ]
    };
  }

  private async executeRouteStep(
    state: CityWalkGraphState,
    step: AgentPlanStep,
    runningSteps: AgentPlanStep[],
    thought: StateEvent
  ): Promise<CityWalkGraphUpdate> {
    let selectedStops = this.selectStops(state);
    if (state.intent.intent === "route_modify" && state.referenceRoute) {
      const oldOrder = new Map(state.referenceRoute.result.stops.map((stop, index) => [stop.name, index]));
      selectedStops = selectedStops.sort((left, right) => {
        const leftIndex = oldOrder.get(left.name);
        const rightIndex = oldOrder.get(right.name);
        if (leftIndex != null && rightIndex != null) return leftIndex - rightIndex;
        if (leftIndex != null) return -1;
        if (rightIndex != null) return 1;
        return 0;
      });
    }

    // 用 LLM 丰富每个点位的费用明细和亮点描述
    let enriched;
    try {
      enriched = await this.llmRouter.enrichPois(
        selectedStops.map((s) => ({
          name: s.name,
          category: s.category,
          address: s.address,
          city: state.constraints.city
        })),
        state.rawInput.preferredModel,
        state.abortSignal
      );
    } catch (error) {
      if (state.abortSignal?.aborted) throw error;
      console.warn(
        `[CityWalkGraph] POI enrichment failed; using deterministic estimates: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (enriched?.data && enriched.data.length === selectedStops.length) {
      selectedStops = selectedStops.map((stop, i) => {
        const item = enriched.data[i];
        const mappedCost = Math.max(0, stop.estimatedCostPerPerson ?? 0);
        const llmCost = Number.isFinite(item.estimatedCost) ? Math.max(0, item.estimatedCost) : 0;
        // Non-zero provider pricing is stronger evidence than an LLM estimate.
        // Bookstores, parks and malls have no mandatory admission cost when
        // the provider reports zero; optional purchases must not delete them
        // from a route during budget reflection.
        const freeEntryCategory = ["bookstore", "park", "mall"].includes(stop.category);
        const perPerson = mappedCost > 0 ? mappedCost : freeEntryCategory ? 0 : llmCost;
        const enrichedStay = Number.isFinite(item.estimatedStayMinutes)
          ? Math.max(10, Math.round(item.estimatedStayMinutes))
          : stop.estimatedStayMinutes;
        const stay = state.constraints.durationMinutes != null
          ? Math.min(stop.estimatedStayMinutes, enrichedStay)
          : enrichedStay;
        return {
          ...stop,
          estimatedCost: this.estimateGroupCost(perPerson, stop.category, state.constraints.party),
          estimatedCostPerPerson: perPerson,
          estimatedStayMinutes: stay,
          costBreakdown: item.costBreakdown,
          highlight: item.highlight,
          bookingInfo: item.bookingInfo
        };
      });
    }

    const locatedStops = selectedStops.filter((stop): stop is RouteStop & { location: string } => Boolean(stop.location));
    const destinations = locatedStops.map((stop) => stop.location);

    const origin = state.startLocation ?? state.constraints.startPoint;

    const action = this.event("ACTION", "调用路径规划工具计算点位间耗时。", state, step.id, {
      tool: "plan_route",
      input: {
        origin,
        destinations,
        mode: state.constraints.transportMode ?? "mixed",
        city: state.constraints.city,
        party: state.constraints.party,
        experience: state.constraints.experience,
        accessibility: state.constraints.accessibility,
        style: state.constraints.style
      }
    });

    let routeLegs = await this.mapTool.planRoute(origin, destinations, state.constraints.transportMode ?? "mixed", state.constraints.city, state.abortSignal);

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
          mode: dist > 3000 ? "transit" : "walk",
          estimated: true
        });
      }
    }

    // Enforce maxLegMinutes: if any walk leg exceeds limit, replan with transit
    const maxLegMinutes = this.effectiveMaxLegMinutes(state.constraints);
    if (maxLegMinutes) {
      const tooLong = routeLegs.some((leg) => leg.mode === "walk" && leg.durationMinutes > maxLegMinutes);
      if (tooLong) {
        const transitLegs = await this.mapTool.planRoute(origin, destinations, "transit", state.constraints.city, state.abortSignal);
        if (transitLegs.length) routeLegs = transitLegs;
      }
    }
    routeLegs = this.withRouteLegLabels(routeLegs, state.constraints.startPoint, locatedStops);

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
        {
          type: "tool_call",
          tool: "plan_route",
          input: {
            origin,
            destinations,
            mode: state.constraints.transportMode ?? "mixed",
            city: state.constraints.city,
            party: state.constraints.party,
            experience: state.constraints.experience,
            accessibility: state.constraints.accessibility,
            style: state.constraints.style
          }
        },
        { type: "tool_result", tool: "plan_route", output: routeLegs }
      ],
      decisionLog: [`路线：${selectedStops.map((stop) => stop.name).join(" → ") || "无可选点位"}（${modeSummary}，路程${routeMinutes}分钟 + 停留${stayMinutes}分钟；按${this.describeParty(state.constraints.party)}核算费用）`]
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
        weatherRisk: state.weatherRisk,
        accessibility: state.constraints.accessibility,
        maxLegMinutes: this.effectiveMaxLegMinutes(state.constraints)
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
    const initialViolations = this.detectViolations(state);
    if (!state.needsReplan || initialViolations.length === 0 || state.revisionCount >= 2) {
      const event = this.event("REFLECT", initialViolations.length === 0 ? "无需修正，进入结果合成。" : "已达到最大修正次数，保留当前最优方案并说明风险。", state);
      return {
        needsReplan: false,
        events: [event],
        traceSteps: [{ type: "thought", content: event.content }],
        decisionLog: [event.content]
      };
    }

    let workingState = state;
    let revisionCount = state.revisionCount;
    const corrections: string[] = [];

    // One correction can expose another violation: for example, adding an
    // accessible rest stop may then make the route exceed its time budget.
    // Resolve up to the existing two-revision safety cap in the same node so
    // we never re-enter an exhausted executor step or synthesize stale totals.
    while (revisionCount < 2) {
      const violations = this.detectViolations(workingState);
      if (violations.length === 0) break;

      const correction = this.chooseCorrection(workingState, violations);
      const reflectedStops = this.applyCorrection(workingState, correction);
      const origin = workingState.startLocation ?? workingState.constraints.startPoint;
      const destinations = reflectedStops.map((stop) => stop.location).filter((location): location is string => Boolean(location));
      const locatedStops = reflectedStops.filter((stop): stop is RouteStop & { location: string } => Boolean(stop.location));
      let newLegs = await this.mapTool.planRoute(
        origin,
        destinations,
        workingState.constraints.transportMode ?? "mixed",
        workingState.constraints.city,
        workingState.abortSignal
      );
      const maxLegMinutes = this.effectiveMaxLegMinutes(workingState.constraints);
      if (maxLegMinutes && newLegs.some((leg) => leg.mode === "walk" && leg.durationMinutes > maxLegMinutes)) {
        const transitLegs = await this.mapTool.planRoute(origin, destinations, "transit", workingState.constraints.city, workingState.abortSignal);
        if (transitLegs.length) newLegs = transitLegs;
      }
      newLegs = this.withRouteLegLabels(newLegs, workingState.constraints.startPoint, locatedStops);

      const routeMinutes = newLegs.reduce((sum, leg) => sum + leg.durationMinutes, 0);
      const stayMinutes = reflectedStops.reduce((sum, stop) => sum + stop.estimatedStayMinutes, 0);
      workingState = {
        ...workingState,
        selectedStops: reflectedStops,
        routeLegs: newLegs,
        totalEstimatedCost: reflectedStops.reduce((sum, stop) => sum + stop.estimatedCost, 0),
        totalEstimatedMinutes: stayMinutes + routeMinutes
      };
      corrections.push(correction);
      revisionCount += 1;
    }

    const remainingViolations = this.detectViolations(workingState);
    const content = remainingViolations.length === 0
      ? corrections.join("；")
      : `${corrections.join("；")}；仍需人工留意：${remainingViolations.join("；")}`;
    const event = this.event("REFLECT", content, workingState);

    return {
      selectedStops: workingState.selectedStops,
      routeLegs: workingState.routeLegs,
      totalEstimatedCost: workingState.totalEstimatedCost,
      totalEstimatedMinutes: workingState.totalEstimatedMinutes,
      needsReplan: false,
      revisionCount,
      events: [event],
      traceSteps: [{ type: "thought", content: event.content }],
      corrections,
      decisionLog: corrections
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

  private async tryParseConstraintsWithLlm(
    task: string,
    rawInput: PlanRequest,
    memoryContext?: string,
    signal?: AbortSignal
  ): Promise<{
    result?: Awaited<ReturnType<LlmRouter["parseConstraints"]>>;
    reason?: "unconfigured" | "invalid_response" | "request_failed";
  }> {
    try {
      const result = await this.llmRouter.parseConstraints(task, rawInput, rawInput.preferredModel, memoryContext, signal);
      return result ? { result } : { reason: "unconfigured" };
    } catch (error) {
      if (signal?.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const invalidResponse = (error instanceof Error && ["ZodError", "SyntaxError"].includes(error.name))
        || /invalid_(?:enum|type)|too_(?:small|big)|Required|Expected|response is not JSON|Unexpected token|"code"\s*:\s*"invalid/iu.test(message);
      console.warn(
        `[CityWalkGraph] constraint parsing failed; using heuristic parser: ${message}`
      );
      return { reason: invalidResponse ? "invalid_response" : "request_failed" };
    }
  }

  private async tryPlanStepsWithLlm(
    task: string,
    constraints: UserConstraints,
    preferredModel?: "flash" | "pro",
    memoryContext?: string,
    signal?: AbortSignal
  ) {
    try {
      return await this.llmRouter.planSteps(task, constraints, preferredModel, memoryContext, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn(
        `[CityWalkGraph] LLM planning failed; using deterministic plan: ${error instanceof Error ? error.message : String(error)}`
      );
      return undefined;
    }
  }

  private resolvePartyConstraints(options: {
    input: PlanRequest;
    current: Partial<PartyConstraints>;
    llm?: unknown;
    llmPeopleCount?: number;
    previous: Partial<PartyConstraints>;
    previousPeopleCount?: number;
    fallback: PartyConstraints;
  }): { value: PartyConstraints; ledger: ConstraintLedgerEntry[]; explicit: boolean } {
    const request = this.normalizePartyCandidate(options.input.party);
    if (options.input.peopleCount != null && request.total == null) request.total = options.input.peopleCount;
    const current = this.normalizePartyCandidate(options.current);
    const llm = this.normalizePartyCandidate(options.llm);
    if (options.llmPeopleCount != null && llm.total == null) llm.total = options.llmPeopleCount;
    const previous = this.normalizePartyCandidate(options.previous);
    if (options.previousPeopleCount != null && previous.total == null) previous.total = options.previousPeopleCount;
    const fallback = this.normalizePartyCandidate(options.fallback);
    const sources: Record<string, ConstraintSource> = {};

    const pick = <K extends keyof PartyConstraints>(field: K): PartyConstraints[K] | undefined => {
      const candidates: Array<[PartyConstraints[K] | undefined, ConstraintSource]> = [
        [request[field], "request"],
        [current[field], "current_turn"],
        [llm[field], "llm"],
        [previous[field], "recent_context"],
        [fallback[field], "default"]
      ];
      const selected = candidates.find(([value]) => value !== undefined);
      if (selected) sources[field] = selected[1];
      return selected?.[0];
    };

    let total = Number(pick("total") ?? 1);
    let adults = pick("adults");
    let children = pick("children");
    const childAges = pick("childAges");
    let seniors = pick("seniors");
    const stroller = pick("stroller");
    const mobilityNeeds = [...new Set(pick("mobilityNeeds") ?? [])];

    if (childAges?.length && (children == null || children < childAges.length)) {
      children = childAges.length;
      sources.children = "derived";
    }
    children = Math.max(0, Math.floor(children ?? 0));
    seniors = Math.max(0, Math.floor(seniors ?? 0));
    const knownPartySize = Math.max(0, Math.floor(adults ?? 0)) + children + seniors;
    if (sources.total === "default" && (children > 0 || seniors > 0 || adults != null)) {
      total = Math.max(knownPartySize, children + seniors + (adults == null ? 1 : 0), 1);
      sources.total = "derived";
    }
    total = Math.max(1, Math.floor(total), knownPartySize);
    if (adults == null) {
      adults = Math.max(0, total - children - seniors);
      sources.adults = "derived";
    } else {
      adults = Math.max(0, Math.floor(adults));
    }

    const value: PartyConstraints = {
      total,
      adults,
      children: children || undefined,
      childAges: childAges?.length ? childAges : undefined,
      seniors: seniors || undefined,
      stroller,
      mobilityNeeds
    };
    const priority = (field: keyof PartyConstraints): ConstraintPriority =>
      field === "mobilityNeeds" || field === "stroller" || field === "childAges" ? "hard" : "hard";
    const ledger = (Object.keys(value) as Array<keyof PartyConstraints>)
      .map((field) => this.constraintLedgerEntry(`party.${field}`, value[field], sources[field] ?? "derived", priority(field)))
      .filter((entry): entry is ConstraintLedgerEntry => Boolean(entry));
    const explicit = Object.values(sources).some((source) => !["default", "derived"].includes(source));
    return { value, ledger, explicit };
  }

  private resolveExperienceConstraints(options: {
    input: PlanRequest;
    current: RouteExperienceConstraints;
    llm?: unknown;
    previous: RouteExperienceConstraints;
    fallback: RouteExperienceConstraints;
    party: PartyConstraints;
    accessibility?: AccessibilityConstraints;
  }): { value: RouteExperienceConstraints; ledger: ConstraintLedgerEntry[]; explicit: boolean } {
    const request = this.normalizeExperienceCandidate(options.input.experience);
    const current = this.normalizeExperienceCandidate(options.current);
    const llm = this.normalizeExperienceCandidate(options.llm);
    const previous = this.normalizeExperienceCandidate(options.previous);
    const fallback = this.normalizeExperienceCandidate(options.fallback);
    const sources: Record<string, ConstraintSource> = {};
    const value: RouteExperienceConstraints = {};
    const fields: Array<keyof RouteExperienceConstraints> = [
      "familyFriendly", "pace", "restStopRequired", "restroomPreferred", "avoidCrowds"
    ];

    for (const field of fields) {
      const candidates: Array<[RouteExperienceConstraints[typeof field] | undefined, ConstraintSource]> = [
        [request[field], "request"],
        [current[field], "current_turn"],
        [llm[field], "llm"],
        [previous[field], "recent_context"],
        [fallback[field], "default"]
      ];
      const selected = candidates.find(([candidate]) => candidate !== undefined);
      if (selected) {
        (value as Record<string, unknown>)[field] = selected[0];
        sources[field] = selected[1];
      }
    }

    if (value.familyFriendly == null && (options.party.children ?? 0) > 0) {
      value.familyFriendly = true;
      sources.familyFriendly = "derived";
    }
    if ((value.pace == null || sources.pace === "default") && ((options.party.seniors ?? 0) > 0 || options.party.mobilityNeeds.length > 0 || options.party.stroller
      || options.accessibility?.wheelchairAccessRequired || options.accessibility?.stepFreeRequired)) {
      value.pace = "relaxed";
      sources.pace = "derived";
    }
    if ((value.restStopRequired == null || sources.restStopRequired === "default")
      && ((options.party.seniors ?? 0) > 0 || options.party.mobilityNeeds.length > 0
      || options.accessibility?.frequentRestRequired)) {
      value.restStopRequired = true;
      sources.restStopRequired = "derived";
    }
    if ((value.restroomPreferred == null || sources.restroomPreferred === "default")
      && (options.party.stroller || (options.party.children ?? 0) > 0
      || options.accessibility?.accessibleRestroomRequired)) {
      value.restroomPreferred = true;
      sources.restroomPreferred = "derived";
    }

    const ledger = fields
      .map((field) => this.constraintLedgerEntry(
        `experience.${field}`,
        value[field],
        sources[field] ?? "derived",
        field === "restStopRequired" || field === "restroomPreferred" ? "hard" : "soft"
      ))
      .filter((entry): entry is ConstraintLedgerEntry => Boolean(entry));
    const explicit = Object.values(sources).some((source) => !["default", "derived"].includes(source));
    return { value, ledger, explicit };
  }

  private resolveAccessibilityConstraints(options: {
    input: PlanRequest;
    current: AccessibilityConstraints;
    llm?: unknown;
    previous: AccessibilityConstraints;
    fallback: AccessibilityConstraints;
  }): { value: AccessibilityConstraints; ledger: ConstraintLedgerEntry[]; explicit: boolean } {
    const request = this.normalizeAccessibilityCandidate(options.input.accessibility);
    const current = this.normalizeAccessibilityCandidate(options.current);
    const llm = this.normalizeAccessibilityCandidate(options.llm);
    const previous = this.normalizeAccessibilityCandidate(options.previous);
    const fallback = this.normalizeAccessibilityCandidate(options.fallback);
    const fields: Array<keyof AccessibilityConstraints> = [
      "wheelchairAccessRequired",
      "stepFreeRequired",
      "elevatorRequired",
      "accessibleRestroomRequired",
      "frequentRestRequired"
    ];
    const sources: Record<string, ConstraintSource> = {};
    const value: AccessibilityConstraints = {};
    for (const field of fields) {
      const candidates: Array<[boolean | undefined, ConstraintSource]> = [
        [request[field], "request"],
        [current[field], "current_turn"],
        [llm[field], "llm"],
        [previous[field], "recent_context"],
        [fallback[field], "default"]
      ];
      const selected = candidates.find(([candidate]) => candidate !== undefined);
      if (selected) {
        value[field] = selected[0];
        sources[field] = selected[1];
      }
    }
    if (value.wheelchairAccessRequired && value.stepFreeRequired !== true) {
      value.stepFreeRequired = true;
      sources.stepFreeRequired = "derived";
    }
    const ledger = fields
      .map((field) => this.constraintLedgerEntry(`accessibility.${field}`, value[field], sources[field] ?? "derived", "hard"))
      .filter((entry): entry is ConstraintLedgerEntry => Boolean(entry));
    const explicit = Object.values(sources).some((source) => !["default", "derived"].includes(source));
    return { value, ledger, explicit };
  }

  private resolveStyleIntent(options: {
    request: StyleIntent;
    current: StyleIntent;
    llm?: unknown;
    previous: StyleIntent;
    fallback: StyleIntent;
  }): { value: StyleIntent; source: ConstraintSource; explicit: boolean } {
    // The LLM may incorrectly restate operational constraints (wheelchair,
    // family, POI categories) as an aesthetic style. Only accept its style
    // expansion when another source establishes that the user requested a
    // style. Open-ended wording is still preserved by compileHeuristicStyle.
    const hasIndependentStyleSignal = [options.request, options.current, options.previous, options.fallback]
      .some(isStyleActive);
    const llm = hasIndependentStyleSignal ? normalizeStyleIntent(options.llm) : emptyStyleIntent();
    const candidates: Array<[StyleIntent, ConstraintSource]> = [
      [options.request, "request"],
      [options.current, "current_turn"],
      [llm, "llm"],
      [options.previous, "recent_context"],
      [options.fallback, "default"]
    ];
    const active = candidates.filter(([value]) => isStyleActive(value));
    if (active.length === 0) {
      return { value: emptyStyleIntent(), source: "default", explicit: false };
    }
    const source = active[0][1];
    let value = mergeStyleIntents(...active.map(([profile]) => profile));
    // For a natural-language task, deterministic compilation supplies the
    // exact user wording while the LLM is allowed to improve the semantic
    // summary/scenes. A structured client profile remains highest priority.
    if (!isStyleActive(options.request) && isStyleActive(llm) && isStyleActive(options.current)) {
      value = mergeStyleIntents(llm, options.current, options.previous, options.fallback);
      value.rawText = options.current.rawText || value.rawText;
    }
    return {
      value,
      source,
      explicit: active.some(([, candidateSource]) => ["request", "current_turn", "llm", "recent_context"].includes(candidateSource))
    };
  }

  private normalizePartyCandidate(value: unknown): Partial<PartyConstraints> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const raw = value as Record<string, unknown>;
    const count = (field: string): number | undefined => {
      const parsed = Number(raw[field]);
      return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
    };
    const childAges = Array.isArray(raw.childAges)
      ? raw.childAges.map(Number).filter((age) => Number.isInteger(age) && age >= 0 && age <= 17).slice(0, 20)
      : undefined;
    const mobilityNeeds = Array.isArray(raw.mobilityNeeds)
      ? raw.mobilityNeeds.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 20)
      : undefined;
    return {
      total: count("total"),
      adults: count("adults"),
      children: count("children"),
      childAges,
      seniors: count("seniors"),
      stroller: typeof raw.stroller === "boolean" ? raw.stroller : undefined,
      mobilityNeeds
    };
  }

  private normalizeExperienceCandidate(value: unknown): RouteExperienceConstraints {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const raw = value as Record<string, unknown>;
    const pace = raw.pace === "relaxed" || raw.pace === "normal" || raw.pace === "intensive" ? raw.pace : undefined;
    const bool = (field: string) => typeof raw[field] === "boolean" ? raw[field] as boolean : undefined;
    return {
      familyFriendly: bool("familyFriendly"),
      pace,
      restStopRequired: bool("restStopRequired"),
      restroomPreferred: bool("restroomPreferred"),
      avoidCrowds: bool("avoidCrowds")
    };
  }

  private normalizeAccessibilityCandidate(value: unknown): AccessibilityConstraints {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const raw = value as Record<string, unknown>;
    const bool = (field: keyof AccessibilityConstraints) => typeof raw[field] === "boolean" ? raw[field] as boolean : undefined;
    return {
      wheelchairAccessRequired: bool("wheelchairAccessRequired"),
      stepFreeRequired: bool("stepFreeRequired"),
      elevatorRequired: bool("elevatorRequired"),
      accessibleRestroomRequired: bool("accessibleRestroomRequired"),
      frequentRestRequired: bool("frequentRestRequired")
    };
  }

  private firstConstraintSource(candidates: Array<[unknown, ConstraintSource]>): ConstraintSource {
    return candidates.find(([value]) => value !== undefined && value !== null)?.[1] ?? "default";
  }

  private constraintLedgerEntry(
    path: string,
    value: unknown,
    source: ConstraintSource,
    priority: ConstraintPriority
  ): ConstraintLedgerEntry | undefined {
    if (value === undefined || value === null) return undefined;
    return { path, value, source, priority };
  }

  private describeParty(party: PartyConstraints): string {
    const parts = [
      party.adults ? `${party.adults}位成人` : undefined,
      party.children ? `${party.children}名儿童${party.childAges?.length ? `（${party.childAges.join("、")}岁）` : ""}` : undefined,
      party.seniors ? `${party.seniors}位老人` : undefined,
      party.stroller ? "携带婴儿车" : undefined,
      party.mobilityNeeds.length ? `行动需求：${party.mobilityNeeds.join("、")}` : undefined
    ].filter(Boolean);
    return `${party.total}人${parts.length ? `（${parts.join("，")}）` : ""}`;
  }

  private describeExperience(experience: RouteExperienceConstraints): string {
    return [
      experience.familyFriendly ? "亲子友好" : undefined,
      experience.pace === "relaxed" ? "轻松节奏" : experience.pace === "intensive" ? "紧凑节奏" : undefined,
      experience.restStopRequired ? "需要休息点" : undefined,
      experience.restroomPreferred ? "偏好卫生间便利" : undefined,
      experience.avoidCrowds ? "避开拥挤" : undefined
    ].filter(Boolean).join("、");
  }

  private describeAccessibility(accessibility: AccessibilityConstraints): string {
    return [
      accessibility.wheelchairAccessRequired ? "轮椅可通行" : undefined,
      accessibility.stepFreeRequired ? "全程无台阶" : undefined,
      accessibility.elevatorRequired ? "需要电梯" : undefined,
      accessibility.accessibleRestroomRequired ? "需要无障碍卫生间" : undefined,
      accessibility.frequentRestRequired ? "需要频繁休息点" : undefined
    ].filter(Boolean).join("、");
  }

  private describeStyle(style: StyleIntent): string {
    if (!isStyleActive(style)) return "";
    const tags = style.tags.slice(0, 4).map((tag) => tag.name);
    const scenes = style.desiredScenes.slice(0, 2).map((scene) => scene.description);
    const avoids = style.avoidances.slice(0, 2).map((item) => `不含${item}`);
    return [style.summary || style.rawText, tags.length ? `特征：${tags.join("、")}` : "", scenes.length ? `场景：${scenes.join("、")}` : "", avoids.join("、")]
      .filter(Boolean).join("；");
  }

  private parseConstraints(input: PlanRequest): UserConstraints {
    const task = input.task ?? "";
    const city = this.normalizeCityName(input.city) ?? this.matchCity(task) ?? UNSPECIFIED_CITY;
    const startPoint = input.startPoint?.trim() ?? this.matchStartPoint(task) ?? this.defaultStartPointForCity(city);
    const durationMinutes = this.hasUnlimitedDuration(task) ? undefined : input.durationMinutes ?? this.matchDuration(task) ?? undefined;
    const budget = this.hasUnlimitedBudget(task) ? undefined : input.budget ?? this.matchBudget(task) ?? undefined;
    const preferences = input.preferences?.length ? input.preferences : this.matchPreferences(task);
    const weatherPreference = input.weatherPreference ?? this.matchWeatherPreference(task);
    const endPoint = input.endPoint ?? this.matchEndPoint(task);
    const maxLegMinutes = input.maxLegMinutes ?? this.matchMaxLegMinutes(task);
    const party = this.resolvePartyConstraints({
      input,
      current: this.matchPartyConstraints(task),
      previous: {},
      fallback: this.defaultPartyConstraints()
    });
    const accessibility = this.resolveAccessibilityConstraints({
      input,
      current: this.matchAccessibilityConstraints(task),
      previous: {},
      fallback: this.defaultAccessibilityConstraints()
    });
    const experience = this.resolveExperienceConstraints({
      input,
      current: this.matchExperienceConstraints(task),
      previous: {},
      fallback: this.defaultExperienceConstraints(),
      party: party.value,
      accessibility: accessibility.value
    });
    const style = mergeStyleIntents(
      input.style,
      input.styleDescription ? compileHeuristicStyle(input.styleDescription, true) : undefined,
      compileHeuristicStyle(task)
    );

    return {
      city,
      startPoint,
      durationMinutes,
      budget,
      preferences,
      peopleCount: party.value.total,
      party: party.value,
      experience: experience.value,
      accessibility: accessibility.value,
      style,
      constraintLedger: [...party.ledger, ...experience.ledger, ...accessibility.ledger],
      transportMode: input.transportMode ?? (/地铁|公交/.test(task) ? "transit" : "mixed"),
      weatherPreference,
      weatherRisk: input.weatherRisk,
      endPoint,
      maxLegMinutes,
      partyExplicit: party.explicit,
      experienceExplicit: experience.explicit,
      styleExplicit: isStyleActive(style)
    };
  }

  private defaultPartyConstraints(): PartyConstraints {
    return { total: 1, mobilityNeeds: [] };
  }

  private defaultExperienceConstraints(): RouteExperienceConstraints {
    return { pace: "normal" };
  }

  private defaultAccessibilityConstraints(): AccessibilityConstraints {
    return {};
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
    const city = this.normalizeCityName(input.city) ?? this.matchCity(input.task ?? "") ?? UNSPECIFIED_CITY;
    const party = this.resolvePartyConstraints({
      input,
      current: this.matchPartyConstraints(input.task ?? ""),
      previous: {},
      fallback: this.defaultPartyConstraints()
    });
    const accessibility = this.resolveAccessibilityConstraints({
      input,
      current: this.matchAccessibilityConstraints(input.task ?? ""),
      previous: {},
      fallback: this.defaultAccessibilityConstraints()
    });
    const experience = this.resolveExperienceConstraints({
      input,
      current: this.matchExperienceConstraints(input.task ?? ""),
      previous: {},
      fallback: this.defaultExperienceConstraints(),
      party: party.value,
      accessibility: accessibility.value
    });
    const style = mergeStyleIntents(
      input.style,
      input.styleDescription ? compileHeuristicStyle(input.styleDescription, true) : undefined,
      compileHeuristicStyle(input.task ?? "")
    );
    return {
      city,
      startPoint: input.startPoint?.trim() ?? this.matchStartPoint(input.task ?? "") ?? this.defaultStartPointForCity(city),
      durationMinutes: this.hasUnlimitedDuration(input.task ?? "") ? undefined : input.durationMinutes ?? undefined,
      budget: this.hasUnlimitedBudget(input.task ?? "") ? undefined : input.budget,
      preferences: input.preferences ?? [],
      peopleCount: party.value.total,
      party: party.value,
      experience: experience.value,
      accessibility: accessibility.value,
      style,
      constraintLedger: [...party.ledger, ...experience.ledger, ...accessibility.ledger],
      transportMode: input.transportMode ?? "mixed",
      weatherPreference: input.weatherPreference ?? undefined,
      weatherRisk: input.weatherRisk ?? this.matchWeatherRisk(input.task ?? ""),
      partyExplicit: party.explicit,
      experienceExplicit: experience.explicit,
      styleExplicit: isStyleActive(style)
    };
  }

  private selectStops(state: CityWalkGraphState): RouteStop[] {
    const preferredCategories = this.preferredPoiCategories(state);
    const removedCategories = state.intent.intent === "route_modify"
      ? this.removedPoiCategories(state.task)
      : new Set<RouteStop["category"]>();
    const sorted = [...state.candidatePois]
      .filter((poi) => this.isPoiCityCompatible(poi, state.constraints.city)
        && !this.isNonVisitPoi(poi)
        && !this.isUnsuitableForParty(poi, state.constraints)
        && !this.isUnsuitableForAccessibility(poi, state.constraints)
        && !this.isUnsuitableForStyle(poi, state.constraints)
        && !removedCategories.has(poi.category))
      .sort((left, right) => {
        const preferredDifference = Number(preferredCategories.has(right.category))
          - Number(preferredCategories.has(left.category));
        return preferredDifference * 1000
          + this.poiSuitabilityScore(right, state) - this.poiSuitabilityScore(left, state);
      });
    const stops: RouteStop[] = [];
    let cost = 0;
    let minutes = 0;
    const hasTimeLimit = state.constraints.durationMinutes != null;
    const timeCap = state.constraints.durationMinutes ?? 240;
    // Reserve realistic local travel time, then enforce the exact total after
    // route planning. A 30-minute floor made two-hour accessible walks
    // collapse to one stop even when several nearby candidates were usable.
    const routeBuffer = Math.max(15, Math.round(timeCap * 0.15));
    const baseMaxStops = state.constraints.experience.pace === "relaxed" || state.constraints.party.stroller ? 3 : 4;
    const preferredSupportNeeded = state.constraints.experience.restStopRequired
      && ![...preferredCategories].some((category) => this.isRestStopCategory(category));
    const styleNarrativeStop = isStyleActive(state.constraints.style) && preferredCategories.size > 0 ? 1 : 0;
    const maxStops = preferredCategories.size > 0
      ? Math.min(baseMaxStops, Math.max(2, preferredCategories.size + (preferredSupportNeeded ? 1 : 0) + styleNarrativeStop))
      : baseMaxStops;

    for (const poi of sorted) {
      if (state.constraints.endPoint && poi.name === state.constraints.endPoint) continue;
      if (this.isMemoryAvoidedPoi(poi, state.memoryContext)) continue;
      // A route is not useful when keyword retrieval fills every slot with
      // near-identical businesses (for example three coffee shops). Keep one
      // stop per functional category; generic sights may use two slots.
      const categoryLimit = poi.category === "sight" ? 2 : 1;
      if (stops.filter((stop) => stop.category === poi.category).length >= categoryLimit) continue;

      let stay = this.adjustedStayMinutes(poi.category, state.constraints);
      if (hasTimeLimit && preferredCategories.has(poi.category)) {
        const missingPreferredCount = [...preferredCategories]
          .filter((category) => !stops.some((stop) => stop.category === category)).length;
        const fairShare = Math.floor(
          (state.constraints.durationMinutes! - routeBuffer - minutes) / Math.max(1, missingPreferredCount)
        );
        // Short routes should shorten dwell time before dropping an explicitly
        // requested category altogether. Fifteen minutes remains a useful stop.
        stay = Math.min(stay, Math.max(15, fairShare));
      }
      const costPerPerson = Math.max(0, poi.averageCost);
      const groupCost = this.estimateGroupCost(costPerPerson, poi.category, state.constraints.party);
      if (state.constraints.budget != null && cost + groupCost > state.constraints.budget) continue;
      if (hasTimeLimit && minutes + stay + routeBuffer > state.constraints.durationMinutes!) continue;

      const suitabilityTags = this.poiSuitabilityTags(poi, state.constraints);
      stops.push({
        name: poi.name,
        category: poi.category,
        estimatedCost: groupCost,
        estimatedCostPerPerson: costPerPerson,
        estimatedStayMinutes: stay,
        suitabilityTags,
        styleMatches: poi.styleMatches,
        styleScore: poi.styleScore,
        styleConflicts: poi.styleConflicts,
        reason: this.buildStopReason(poi, state.constraints, suitabilityTags),
        location: poi.location,
        address: poi.address,
        city: poi.city,
        rating: poi.rating,
        distanceMeters: poi.distanceMeters
      });
      cost += groupCost;
      minutes += stay;
      if (stops.length >= maxStops) break;
    }

    if (state.constraints.experience.restStopRequired && !stops.some((stop) => this.isRestStopCategory(stop.category))) {
      const restCandidate = sorted.find((poi) => this.isRestStopCategory(poi.category) && !stops.some((stop) => stop.name === poi.name));
      const replaceIndex = stops.findIndex((stop) => !state.constraints.endPoint || stop.name !== state.constraints.endPoint);
      if (restCandidate && replaceIndex >= 0) {
        const replacement = this.makeRouteStop(restCandidate, state.constraints, "补充休息点");
        const old = stops[replaceIndex];
        const nextCost = cost - old.estimatedCost + replacement.estimatedCost;
        const nextMinutes = minutes - old.estimatedStayMinutes + replacement.estimatedStayMinutes;
        if ((state.constraints.budget == null || nextCost <= state.constraints.budget)
          && (!hasTimeLimit || nextMinutes + routeBuffer <= state.constraints.durationMinutes!)) {
          stops[replaceIndex] = replacement;
        }
      }
    }

    if (state.constraints.endPoint) {
      const epPoi = state.candidatePois.find((poi) => poi.name === state.constraints.endPoint);
      if (epPoi && !stops.some((stop) => stop.name === state.constraints.endPoint)) {
        stops.push(this.makeRouteStop(epPoi, state.constraints, "用户指定的终点"));
      }
    }
    return stops;
  }

  private makeRouteStop(poi: Poi, constraints: UserConstraints, reasonOverride?: string): RouteStop {
    const suitabilityTags = this.poiSuitabilityTags(poi, constraints);
    const costPerPerson = Math.max(0, poi.averageCost);
    return {
      name: poi.name,
      category: poi.category,
      estimatedCost: this.estimateGroupCost(costPerPerson, poi.category, constraints.party),
      estimatedCostPerPerson: costPerPerson,
      estimatedStayMinutes: this.adjustedStayMinutes(poi.category, constraints),
      suitabilityTags,
      styleMatches: poi.styleMatches,
      styleScore: poi.styleScore,
      styleConflicts: poi.styleConflicts,
      reason: reasonOverride ?? this.buildStopReason(poi, constraints, suitabilityTags),
      location: poi.location,
      address: poi.address,
      city: poi.city,
      rating: poi.rating,
      distanceMeters: poi.distanceMeters
    };
  }

  private poiSuitabilityScore(poi: Poi, state: CityWalkGraphState): number {
    const constraints = state.constraints;
    const tags = this.poiSuitabilityTags(poi, constraints);
    const distancePenalty = (constraints.experience.pace === "relaxed" || constraints.party.stroller || constraints.party.mobilityNeeds.length > 0)
      ? Math.min(25, (poi.distanceMeters ?? 0) / 250)
      : 0;
    const crowdPenalty = constraints.experience.avoidCrowds && /广场|步行街|夜市|热门/.test(`${poi.name}${poi.tags?.join("")}`) ? 20 : 0;
    const styleScore = isStyleActive(constraints.style) ? (poi.styleScore ?? 0) * 70 : 0;
    const styleConflictPenalty = isStyleActive(constraints.style) ? (poi.styleConflicts?.length ?? 0) * 35 : 0;
    return (poi.rating ?? 4) * 10 - poi.averageCost / 5
      + (poi.indoor && state.weatherRisk === "high" ? 20 : 0)
      + this.memoryPoiScore(poi, state.memoryContext)
      + tags.length * 8
      + styleScore
      - distancePenalty
      - crowdPenalty
      - styleConflictPenalty;
  }

  private isUnsuitableForParty(poi: Poi, constraints: UserConstraints): boolean {
    if (!constraints.experience.familyFriendly && !(constraints.party.children ?? 0)) return false;
    return /酒吧|夜店|KTV|成人|网吧|棋牌|赌场|夜总会/.test(`${poi.name}${poi.tags?.join("")}`);
  }

  private isUnsuitableForAccessibility(poi: Poi, constraints: UserConstraints): boolean {
    const accessibility = constraints.accessibility ?? {};
    if (!accessibility.wheelchairAccessRequired && !accessibility.stepFreeRequired) return false;
    const text = `${poi.name} ${(poi.tags ?? []).join(" ")}`;
    return /仅楼梯|无电梯|台阶较多|登山|攀岩|攀爬|陡坡|山路/.test(text);
  }

  /**
   * Keyword search can return businesses that merely contain a theme word
   * (for example a children's coding school for “亲子”, or a hotel for
   * “休息”). They are valid map POIs but not CityWalk destinations.
   */
  private isNonVisitPoi(poi: Poi): boolean {
    const text = `${poi.name} ${(poi.tags ?? []).join(" ")}`;
    if (/住宿服务|宾馆酒店|培训机构|教育培训|中小学校|公司企业|商务写字楼|房地产|停车场|汽车服务|公共厕所|公共卫生间|无障碍洗手间|无障碍卫生间/.test(text)) return true;
    if (poi.category === "mall" && /珠宝首饰|专卖店|便利店|零售店|礼品店|名创优品|培训机构|教育/.test(text)) return true;
    return false;
  }

  private isUnsuitableForStyle(poi: Poi, constraints: UserConstraints): boolean {
    return isStyleActive(constraints.style)
      && (poi.styleConflicts?.length ?? 0) > 0
      && (poi.styleScore ?? 0) < 0.3;
  }

  private groundStyleExplanations(poi: Poi, explanations: string[], city: string): string[] {
    const normalize = (value: string) => value
      .toLocaleLowerCase("zh-CN")
      .replace(new RegExp(city.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "gu"), "")
      .replace(/[\s\p{P}\p{S}]/gu, "");
    const tokens = [
      poi.name,
      poi.address ?? "",
      ...(poi.tags ?? []),
      ...(POI_CATEGORY_WORDS[poi.category] ?? [])
    ].map(normalize).filter((token) => token.length >= 2);
    const bigrams = (value: string) => {
      const chars = Array.from(value);
      return new Set(chars.slice(0, -1).map((char, index) => char + chars[index + 1]));
    };
    return explanations.map((item) => item.trim()).filter((item) => {
      if (!item) return false;
      const normalized = normalize(item);
      if (!normalized) return false;
      return tokens.some((token) => {
        if (normalized.includes(token)) return true;
        if (token.length < 4) return false;
        const tokenGrams = bigrams(token);
        const explanationGrams = bigrams(normalized);
        let hits = 0;
        for (const gram of tokenGrams) if (explanationGrams.has(gram)) hits += 1;
        return hits >= 2;
      });
    });
  }

  private poiSuitabilityTags(poi: Poi, constraints: UserConstraints): string[] {
    const tags: string[] = [];
    if (constraints.experience.familyFriendly && ["museum", "mall", "park", "cafe", "bookstore"].includes(poi.category)) tags.push("亲子友好类型");
    if (constraints.experience.restStopRequired && this.isRestStopCategory(poi.category)) tags.push("可作为休息点");
    if (constraints.experience.restroomPreferred && ["mall", "museum", "restaurant", "cafe"].includes(poi.category)) tags.push("卫生间便利类型");
    if ((constraints.accessibility.wheelchairAccessRequired || constraints.accessibility.stepFreeRequired)
      && ["mall", "museum", "bookstore", "cafe", "restaurant", "park"].includes(poi.category)) {
      tags.push("优先无障碍友好类型（设施需确认）");
    }
    if (constraints.accessibility.elevatorRequired && ["mall", "museum"].includes(poi.category)) tags.push("优先电梯便利类型（设施需确认）");
    if (constraints.accessibility.accessibleRestroomRequired && ["mall", "museum"].includes(poi.category)) tags.push("优先无障碍卫生间类型（设施需确认）");
    if (constraints.accessibility.frequentRestRequired && this.isRestStopCategory(poi.category)) tags.push("可安排频繁休息");
    if ((constraints.experience.pace === "relaxed" || constraints.party.stroller || constraints.party.mobilityNeeds.length > 0)
      && (poi.distanceMeters == null || poi.distanceMeters <= 1200)) tags.push("减少步行负担");
    if (constraints.experience.avoidCrowds && !/广场|步行街|夜市|热门/.test(`${poi.name}${poi.tags?.join("")}`)) tags.push("相对避开拥挤");
    if (isStyleActive(constraints.style) && (poi.styleMatches?.length ?? 0) > 0) {
      tags.push(`风格匹配：${poi.styleMatches!.slice(0, 2).join("、")}`);
    }
    return tags;
  }

  private buildStopReason(poi: Poi, constraints: UserConstraints, tags: string[]): string {
    if (tags.length > 0) return `${tags.join("、")}，并符合当前偏好与预算`;
    if (constraints.weatherPreference === "indoor_first" && poi.indoor) return "天气风险下优先选择室内点位";
    if (isStyleActive(constraints.style) && poi.styleMatches?.length) {
      return `符合“${constraints.style.summary || constraints.style.rawText}”，命中${poi.styleMatches.slice(0, 2).join("、")}`;
    }
    return "符合当前偏好、预算与时间约束";
  }

  private isRestStopCategory(category: RouteStop["category"]): boolean {
    return ["cafe", "mall", "restaurant", "park", "bookstore"].includes(category);
  }

  private estimateGroupCost(perPerson: number, category: RouteStop["category"], party: PartyConstraints): number {
    const adults = party.adults ?? Math.max(0, party.total - (party.children ?? 0) - (party.seniors ?? 0));
    const children = party.children ?? 0;
    const seniors = party.seniors ?? 0;
    const childFactor = ["restaurant", "cafe"].includes(category) ? 0.7 : 0.5;
    const seniorFactor = ["museum", "sight", "park"].includes(category) ? 0.8 : 1;
    const effectivePeople = Math.max(1, adults + children * childFactor + seniors * seniorFactor);
    return Math.round(perPerson * effectivePeople);
  }

  private adjustedStayMinutes(category: RouteStop["category"], constraints: UserConstraints): number {
    let minutes = this.estimateStayMinutes(category);
    if (constraints.experience.pace === "relaxed") minutes += 5;
    if ((constraints.party.children ?? 0) > 0 && ["museum", "park", "sight"].includes(category)) minutes += 5;
    return minutes;
  }

  private effectiveMaxLegMinutes(constraints: UserConstraints): number | undefined {
    if (constraints.maxLegMinutes) return constraints.maxLegMinutes;
    if (constraints.party.stroller || constraints.party.mobilityNeeds.length > 0
      || constraints.accessibility.wheelchairAccessRequired || constraints.accessibility.stepFreeRequired) return 15;
    if (constraints.experience.pace === "relaxed" || (constraints.party.children ?? 0) > 0) return 20;
    return undefined;
  }

  private buildPoiSearchKeywords(constraints: UserConstraints): string[] {
    // Style hints are open strings generated from the user wording; they are
    // search aids, not a closed theme/category enum.
    const keywords = [...constraints.preferences, ...constraints.style.searchHints];
    if (constraints.experience.familyFriendly || (constraints.party.children ?? 0) > 0) {
      keywords.push("亲子", "儿童友好", "博物馆", "商场");
    }
    if (constraints.experience.restStopRequired) keywords.push("咖啡", "商场", "公园");
    if (constraints.experience.restroomPreferred || constraints.party.stroller) keywords.push("商场", "博物馆");
    if (constraints.party.mobilityNeeds.length > 0) keywords.push("无障碍", "商场");
    if (constraints.accessibility.wheelchairAccessRequired || constraints.accessibility.stepFreeRequired) keywords.push("无障碍入口", "电梯", "商场", "博物馆");
    if (constraints.accessibility.elevatorRequired) keywords.push("电梯可达");
    if (constraints.accessibility.accessibleRestroomRequired) keywords.push("无障碍卫生间", "商场", "博物馆");
    if (constraints.accessibility.frequentRestRequired) keywords.push("休息区", "公园", "咖啡");
    return [...new Set(keywords.map((keyword) => keyword.trim()).filter(Boolean))].slice(0, 14);
  }

  private preferredPoiCategories(state: CityWalkGraphState): Set<RouteStop["category"]> {
    const text = [
      ...state.constraints.preferences,
      state.constraints.style.summary,
      ...state.constraints.style.desiredScenes.map((scene) => scene.description)
    ].filter(Boolean).join(" ");
    const categories = new Set<RouteStop["category"]>();
    if (/书店|书局|阅读/.test(text)) categories.add("bookstore");
    if (/咖啡|茶馆|奶茶|甜品/.test(text)) categories.add("cafe");
    if (/博物馆|美术馆|展览|展馆/.test(text)) categories.add("museum");
    if (/公园|绿地|花园|湖/.test(text)) categories.add("park");
    if (/餐厅|饭店|吃饭|美食/.test(text)) categories.add("restaurant");
    if (/商场|购物中心/.test(text)) categories.add("mall");
    if (/景点|街区|街巷|老街|古迹|历史风貌|历史建筑|夜景/.test(text)) categories.add("sight");
    for (const removed of this.removedPoiCategories(state.task)) categories.delete(removed);
    return categories;
  }

  private removedPoiCategories(task: string): Set<RouteStop["category"]> {
    const target = extractRouteRemovalTarget(task);
    return new Set((Object.entries(POI_CATEGORY_WORDS) as Array<[RouteStop["category"], readonly string[]]>)
      .filter(([, words]) => words.some((word) => target.includes(word)
        || new RegExp(`(?:不要|删掉|删除|去掉|移除).{0,6}${word}`).test(task)))
      .map(([category]) => category));
  }

  private textMatchesPoiCategory(text: string, category: RouteStop["category"]): boolean {
    return POI_CATEGORY_WORDS[category].some((word) => text.includes(word));
  }

  private withRemovedRouteCategories(style: StyleIntent, task: string): StyleIntent {
    const removed = this.removedPoiCategories(task);
    if (removed.size === 0) return style;
    const mentionsRemoved = (text: string) => [...removed].some((category) => this.textMatchesPoiCategory(text, category));
    const tags = style.tags.filter((tag) => !mentionsRemoved(`${tag.name} ${tag.evidence ?? ""}`));
    const desiredScenes = style.desiredScenes.filter((scene) => !mentionsRemoved(
      `${scene.description} ${(scene.searchHints ?? []).join(" ")}`
    ));
    const searchHints = style.searchHints.filter((hint) => !mentionsRemoved(hint));
    const narrativeArc = style.narrativeArc.filter((stage) => !mentionsRemoved(stage));
    const summary = mentionsRemoved(style.summary)
      ? `${tags.map((tag) => tag.name).slice(0, 4).join("、") || "调整后偏好"}的 CityWalk 体验`
      : style.summary;
    return { ...style, summary, tags, desiredScenes, searchHints, narrativeArc };
  }

  private memoryPoiScore(poi: Poi, context?: MemoryContext): number {
    if (!context) return 0;
    const name = poi.name.trim().toLocaleLowerCase("zh-CN");
    let score = 0;
    for (const memory of context.recalled) {
      if (memory.kind !== "episodic") continue;
      const placeName = String(memory.data.placeName ?? "").trim().toLocaleLowerCase("zh-CN");
      if (!placeName || (name !== placeName && !name.includes(placeName) && !placeName.includes(name))) continue;
      score += memory.polarity === "positive" ? 25 : memory.polarity === "negative" ? -100 : 0;
    }
    return score;
  }

  private isMemoryAvoidedPoi(poi: Poi, context?: MemoryContext): boolean {
    return this.memoryPoiScore(poi, context) <= -50;
  }

  private detectViolations(state: CityWalkGraphState): string[] {
    const violations: string[] = [];
    if (state.selectedStops.some((stop) => stop.city && !this.sameCity(stop.city, state.constraints.city))) {
      violations.push(`路线包含不属于${state.constraints.city}的跨城市点位`);
    }
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
    const maxLegMinutes = this.effectiveMaxLegMinutes(state.constraints);
    if (maxLegMinutes && state.routeLegs.some((leg) => leg.mode === "walk" && leg.durationMinutes > maxLegMinutes)) {
      violations.push(`同行人单段步行超过${maxLegMinutes}分钟`);
    }
    if ((state.constraints.experience.familyFriendly || (state.constraints.party.children ?? 0) > 0)
      && state.selectedStops.some((stop) => /酒吧|夜店|KTV|成人|网吧|棋牌|赌场/.test(stop.name))) {
      violations.push("路线包含不适合儿童的点位");
    }
    if (state.constraints.experience.restStopRequired
      && !state.selectedStops.some((stop) => this.isRestStopCategory(stop.category))) {
      violations.push("路线缺少明确的休息点");
    }
    if (state.constraints.experience.restroomPreferred
      && !state.selectedStops.some((stop) => ["mall", "museum", "restaurant", "cafe"].includes(stop.category))) {
      violations.push("路线缺少卫生间便利的候选点");
    }
    if (state.constraints.accessibility.accessibleRestroomRequired
      && !state.selectedStops.some((stop) => ["mall", "museum"].includes(stop.category))) {
      violations.push("路线缺少无障碍卫生间设施较可靠的候选点");
    }
    const styleAlternativeAvailable = state.candidatePois.some((poi) => (poi.styleScore ?? 0) >= 0.45);
    const preferredCategories = this.preferredPoiCategories(state);
    if (isStyleActive(state.constraints.style)
      && state.selectedStops.some((stop) => !preferredCategories.has(stop.category)
        && ((stop.styleConflicts?.length ?? 0) > 0
          || (styleAlternativeAvailable && (stop.styleScore ?? 0) < 0.25)))) {
      violations.push("路线包含与用户风格画像不一致的点位");
    }
    return violations;
  }

  private chooseCorrection(state: CityWalkGraphState, violations: string[]): string {
    if (violations.some((item) => item.includes("跨城市"))) {
      return `触发城市一致性修正：移除不属于${state.constraints.city}的点位，禁止使用旧城市路线或默认城市候选。`;
    }
    if (violations.some((item) => item.includes("儿童") || item.includes("休息点") || item.includes("卫生间"))) {
      return "触发同行适配反思：移除不适合当前同行人的点位，并补充符合同行需求、可休息且卫生间便利的地点。";
    }
    if (violations.some((item) => item.includes("单段步行"))) {
      return "触发同行步行反思：优先改用公交地铁，降低婴儿车、儿童或行动不便同行者的步行负担。";
    }
    if (violations.some((item) => item.includes("天气"))) {
      return "触发天气反思：移除户外点位，优先用博物馆、书店、商场等室内 POI 替换。";
    }
    if (violations.some((item) => item.includes("预算"))) {
      return "触发预算反思：按消费降序移除高价点位，并保留评分较高的免费/低价点位。";
    }
    if (violations.some((item) => item.includes("超时"))) {
      return "触发时间反思：优先压缩各站停留时间，仍无法满足上限时再按价值密度移除点位。";
    }
    if (violations.some((item) => item.includes("风格画像"))) {
      return "触发风格一致性反思：移除与用户开放式风格或排除项冲突的点位，并优先补充语义匹配度更高的候选。";
    }
    return "触发可用性反思：放宽关键词并选择默认室内点位。";
  }

  private applyCorrection(state: CityWalkGraphState, correction: string): RouteStop[] {
    let stops = [...state.selectedStops];
    const isEndpoint = (s: RouteStop) => state.constraints.endPoint && s.name === state.constraints.endPoint;

    if (correction.includes("城市一致性")) {
      stops = stops.filter((stop) => !stop.city || this.sameCity(stop.city, state.constraints.city));
    }

    if (correction.includes("天气")) {
      // Don't remove the user-specified endpoint
      stops = stops.filter((stop) => isEndpoint(stop) || !["park", "sight"].includes(stop.category));
      const indoorCandidates = state.candidatePois.filter((poi) => poi.indoor && !stops.some((stop) => stop.name === poi.name));
      for (const poi of indoorCandidates) {
        if (stops.length >= 3) break;
        stops.push(this.makeRouteStop(poi, state.constraints, "反思修正后加入的室内备选点"));
      }
    }
    if (correction.includes("同行适配")) {
      stops = stops.filter((stop) => !/酒吧|夜店|KTV|成人|网吧|棋牌|赌场/.test(stop.name));
      const suitableCandidates = state.candidatePois.filter((poi) =>
        !this.isNonVisitPoi(poi)
        && !this.isUnsuitableForParty(poi, state.constraints)
        && !this.isUnsuitableForAccessibility(poi, state.constraints)
        && !stops.some((stop) => stop.name === poi.name)
      ).sort((left, right) => {
        const accessibilityPriority = (poi: Poi) =>
          state.constraints.accessibility.accessibleRestroomRequired && ["mall", "museum"].includes(poi.category) ? 1 : 0;
        return accessibilityPriority(right) - accessibilityPriority(left)
          || this.poiSuitabilityScore(right, state) - this.poiSuitabilityScore(left, state);
      });
      for (const poi of suitableCandidates) {
        if (stops.length >= (state.constraints.experience.pace === "relaxed" ? 3 : 4)) break;
        if (state.constraints.experience.restStopRequired && !stops.some((stop) => this.isRestStopCategory(stop.category))
          && !this.isRestStopCategory(poi.category)) continue;
        stops.push(this.makeRouteStop(poi, state.constraints, this.isRestStopCategory(poi.category) ? "同行适配补充的休息点" : undefined));
      }
      if (state.constraints.experience.restStopRequired && !stops.some((stop) => this.isRestStopCategory(stop.category))) {
        const rest = suitableCandidates.find((poi) => this.isRestStopCategory(poi.category));
        if (rest) stops.push(this.makeRouteStop(rest, state.constraints, "同行适配补充的休息点"));
      }
    }
    if (correction.includes("风格一致性")) {
      stops = stops.filter((stop) => isEndpoint(stop) || ((stop.styleScore ?? 0) >= 0.25 && !(stop.styleMatches?.length === 0 && stop.styleScore == null)));
      const styleCandidates = state.candidatePois
        .filter((poi) => !this.isNonVisitPoi(poi) && !this.isUnsuitableForParty(poi, state.constraints) && !this.isUnsuitableForStyle(poi, state.constraints))
        .sort((left, right) => this.poiSuitabilityScore(right, state) - this.poiSuitabilityScore(left, state));
      for (const poi of styleCandidates) {
        if (stops.length >= (state.constraints.experience.pace === "relaxed" ? 3 : 4)) break;
        if (!stops.some((stop) => stop.name === poi.name)) stops.push(this.makeRouteStop(poi, state.constraints, "风格一致性反思补充的点位"));
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
      const cap = state.constraints.durationMinutes ?? 240;
      const routeMinutes = state.routeLegs.reduce((sum, leg) => sum + leg.durationMinutes, 0);
      const stayCap = Math.max(0, cap - routeMinutes);
      stops = stops.map((stop) => ({ ...stop }));
      let staySum = stops.reduce((sum, stop) => sum + stop.estimatedStayMinutes, 0);

      // A small real-route overrun should shorten dwell time rather than
      // deleting a category the user explicitly requested. Keep at least a
      // useful 15-minute visit at every retained stop.
      const shrinkOrder = [...stops].sort((left, right) => right.estimatedStayMinutes - left.estimatedStayMinutes);
      for (const stop of shrinkOrder) {
        if (staySum <= stayCap) break;
        const reduction = Math.min(staySum - stayCap, Math.max(0, stop.estimatedStayMinutes - 15));
        stop.estimatedStayMinutes -= reduction;
        staySum -= reduction;
      }

      if (staySum > stayCap) {
        const preferredCategories = this.preferredPoiCategories(state);
        const removable = stops
          .filter((stop) => !isEndpoint(stop))
          .sort((left, right) => {
            const preferredDifference = Number(preferredCategories.has(left.category))
              - Number(preferredCategories.has(right.category));
            if (preferredDifference !== 0) return preferredDifference;
            return ((left.rating ?? 4) / Math.max(1, left.estimatedStayMinutes))
              - ((right.rating ?? 4) / Math.max(1, right.estimatedStayMinutes));
          });
        while (staySum > stayCap && removable.length > 0) {
          const removed = removable.shift()!;
          stops = stops.filter((stop) => stop.name !== removed.name);
          staySum -= removed.estimatedStayMinutes;
        }
      }
    }
    return stops;
  }

  /**
   * Surface the planner's compromises instead of hiding them behind a route.
   * Hard constraints remain authoritative; these disclosures explain when a
   * soft preference was traded away, when a correction changed the route, or
   * when provider data cannot prove a safety/accessibility property.
   */
  private buildConstraintTradeoffs(state: CityWalkGraphState): ConstraintTradeoff[] {
    if (state.responseKind !== "route") return [];
    const tradeoffs: ConstraintTradeoff[] = [];
    const seen = new Set<string>();
    const add = (tradeoff: ConstraintTradeoff) => {
      if (seen.has(tradeoff.id)) return;
      seen.add(tradeoff.id);
      tradeoffs.push(tradeoff);
    };
    const corrections = state.corrections ?? [];
    const maxLegMinutes = this.effectiveMaxLegMinutes(state.constraints);
    const hasTransit = state.routeLegs.some((leg) => leg.mode === "transit");
    const accessibility = state.constraints.accessibility;
    const accessibilityActive = Object.values(accessibility).some(Boolean);

    if (corrections.some((item) => item.includes("预算反思"))) {
      add({
        id: "budget-vs-route-preferences",
        kind: "conflict",
        severity: "warning",
        affectedConstraints: ["budget", "preferences"],
        issue: `原始路线估算超过预算上限（预算¥${state.constraints.budget ?? "未设置"}）。`,
        decision: "优先保留高匹配度的低价或免费点位，压缩/移除了部分消费较高的候选。",
        alternatives: ["提高预算以保留更多付费点位", "降低主题匹配要求以进一步节省预算"],
        userChoiceRequired: true
      });
    }
    if (corrections.some((item) => item.includes("时间反思"))) {
      add({
        id: "duration-vs-stop-coverage",
        kind: "conflict",
        severity: "warning",
        affectedConstraints: ["durationMinutes", "preferences", "routeCoverage"],
        issue: `原始路线超过${state.constraints.durationMinutes ?? "时间"}分钟上限。`,
        decision: "优先保留用户明确偏好的类别，压缩停留时间；必要时减少低优先级站点。",
        alternatives: ["延长可用时长", "减少必去类别或接受更少站点"],
        userChoiceRequired: true
      });
    }
    if (corrections.some((item) => item.includes("天气反思"))) {
      add({
        id: "weather-vs-outdoor-preference",
        kind: "conflict",
        severity: "warning",
        affectedConstraints: ["weatherRisk", "outdoorPreferences"],
        issue: "天气风险与户外点位偏好发生冲突。",
        decision: "优先天气安全，使用室内点位替代或减少户外停留。",
        alternatives: ["改为晴天/低风险时段出行", "明确要求保留户外点位并接受淋雨或防护成本"],
        userChoiceRequired: true
      });
    }
    const transitChosenForWalkingLimit = Boolean(
      maxLegMinutes && hasTransit
        && state.constraints.transportMode !== "transit"
        && !state.constraints.transportModeExplicit
    );
    if (corrections.some((item) => item.includes("同行步行反思")) || transitChosenForWalkingLimit) {
      add({
        id: "walking-limit-vs-transit",
        kind: "conflict",
        severity: "info",
        affectedConstraints: ["maxLegMinutes", "transportMode"],
        issue: maxLegMinutes ? `单段步行上限为${maxLegMinutes}分钟，与点位覆盖或纯步行偏好存在取舍。` : "同行人的行动负担与路线覆盖存在取舍。",
        decision: "采用公交/地铁或更短步行分段，以优先满足行动负担约束；公交地铁段不计入步行上限。",
        alternatives: ["改为全程步行并放宽单段步行上限", "减少站点以降低换乘次数"],
        userChoiceRequired: true
      });
    }
    if (corrections.some((item) => item.includes("风格一致性反思"))) {
      add({
        id: "style-vs-hard-constraints",
        kind: "conflict",
        severity: "info",
        affectedConstraints: ["style", "hardConstraints"],
        issue: "风格匹配与时间、预算、天气或同行/无障碍硬约束无法同时达到最优。",
        decision: "保留硬约束，选择风格匹配度次高但可执行的点位。",
        alternatives: ["放宽预算/时长以追求更高风格匹配", "降低风格要求以获得更短或更省的路线"],
        userChoiceRequired: true
      });
    }

    if (state.constraints.budget != null && state.totalEstimatedCost > state.constraints.budget) {
      add({
        id: "budget-unresolved",
        kind: "conflict",
        severity: "critical",
        affectedConstraints: ["budget"],
        issue: `当前路线仍超出预算¥${state.constraints.budget}，还差¥${state.totalEstimatedCost - state.constraints.budget}。`,
        decision: "暂不虚构低价信息，保留当前可执行路线并明确提示预算风险。",
        alternatives: ["提高预算", "删除付费点位或改选免费点位"],
        userChoiceRequired: true
      });
    }
    if (state.constraints.durationMinutes != null && state.totalEstimatedMinutes > state.constraints.durationMinutes) {
      add({
        id: "duration-unresolved",
        kind: "conflict",
        severity: "critical",
        affectedConstraints: ["durationMinutes"],
        issue: `当前路线仍超出时长上限${state.constraints.durationMinutes}分钟，共约${state.totalEstimatedMinutes}分钟。`,
        decision: "保留已选的硬性目的地，并把超时部分交给用户确认。",
        alternatives: ["延长时长", "删除一个站点或缩短停留"],
        userChoiceRequired: true
      });
    }
    if (state.selectedStops.length === 0) {
      const locationMissing = state.constraints.city === UNSPECIFIED_CITY;
      add({
        id: "no-feasible-route",
        kind: "conflict",
        severity: "critical",
        affectedConstraints: locationMissing ? ["city", "startPoint"] : ["routeAvailability", "hardConstraints"],
        issue: locationMissing
          ? "城市或起点尚未明确，无法搜索真实地点并生成路线。"
          : "候选点无法同时满足当前硬约束，因而没有安全的可执行路线。",
        decision: locationMissing
          ? "不擅自使用默认城市，等待用户补充地点。"
          : "不伪造地点或设施信息，返回待用户调整的条件。",
        alternatives: locationMissing
          ? ["补充城市和起点", "指定一个已知地标作为搜索中心"]
          : ["放宽无障碍/步行/时长中的一项", "补充一个可验证的起点或目标类别"],
        userChoiceRequired: true
      });
    }
    if (accessibility.accessibleRestroomRequired
      && !state.selectedStops.some((stop) => ["mall", "museum"].includes(stop.category))) {
      add({
        id: "accessible-restroom-unresolved",
        kind: "conflict",
        severity: "critical",
        affectedConstraints: ["accessibility.accessibleRestroomRequired", "routeCoverage"],
        issue: "没有找到可作为无障碍卫生间可靠候选的商场或博物馆点位。",
        decision: "不把普通卫生间或搜索关键词命中当作无障碍设施证明。",
        alternatives: ["提供已知有无障碍卫生间的具体场馆", "允许先满足路线主体、再单独安排卫生间"],
        userChoiceRequired: true
      });
    }
    if (accessibilityActive) {
      add({
        id: "accessibility-data-verification",
        kind: "uncertainty",
        severity: "warning",
        affectedConstraints: Object.entries(accessibility).filter(([, enabled]) => enabled).map(([key]) => `accessibility.${key}`),
        issue: "地图 POI 标签不能证明现场无台阶入口、电梯或无障碍卫生间当前可用。",
        decision: "按无障碍硬约束筛选候选，并把现场核验责任明确交给用户。",
        alternatives: ["出发前向场馆电话确认设施状态", "改选能提供官方无障碍说明的场馆"],
        userChoiceRequired: true
      });
    }
    const historicSurfaceStops = state.selectedStops.filter((stop) =>
      /历史文化街区|老街|街巷|古城|古镇|石板|颐和路|老门东/u.test(
        `${stop.name} ${stop.address ?? ""} ${(stop.styleMatches ?? []).join(" ")}`
      )
    );
    if ((accessibility.wheelchairAccessRequired || accessibility.stepFreeRequired) && historicSurfaceStops.length > 0) {
      add({
        id: "historic-surface-vs-step-free",
        kind: "conflict",
        severity: "warning",
        affectedConstraints: ["style", "accessibility.stepFreeRequired"],
        issue: `${historicSurfaceStops.map((stop) => stop.name).join("、")}属于历史街区候选，现场可能存在石板路、路缘或坡度，与无台阶通行要求存在不确定冲突。`,
        decision: "保留代表性历史点位，但不宣称其已验证无障碍；路线优先使用公共交通接近入口。",
        alternatives: ["出发前联系街区管理方确认连续无障碍路径", "改选有官方无障碍说明的室内历史展馆"],
        userChoiceRequired: true
      });
    }
    if (state.routeLegs.some((leg) => leg.estimated)) {
      add({
        id: "route-distance-estimate",
        kind: "uncertainty",
        severity: "warning",
        affectedConstraints: ["routeDistance", "durationMinutes"],
        issue: "部分路段缺少路径 API 结果，距离和时间为估算值。",
        decision: "先用保守估算生成方案，不把估算当成实时导航保证。",
        alternatives: ["出发前用地图导航复核", "缩短路线并预留额外缓冲时间"],
        userChoiceRequired: false
      });
    }
    return tradeoffs;
  }

  private buildFinalAnswer(state: CityWalkGraphState): string {
    if (state.selectedStops.length === 0) {
      if (state.constraints.city === UNSPECIFIED_CITY) {
        return "还不能生成路线：请先告诉我想在哪座城市漫步；系统不会自动改用其他默认城市。";
      }
      const hasApiKey = !!env.AMAP_KEY;
      const candidateCount = state.candidatePois.length;
      const prefList = (state.constraints.preferences ?? []).join("、") || "默认";
      const partyNote = this.describeParty(state.constraints.party);
      const experienceNote = this.describeExperience(state.constraints.experience);
      const styleNote = this.describeStyle(state.constraints.style);
      const diag = !hasApiKey
        ? "（高德 API Key 未配置，无法搜索真实 POI 数据）"
        : candidateCount === 0
          ? `（高德 API 已调用但未返回结果，请检查 Key 权限或网络）`
          : `（搜索到 ${candidateCount} 个候选点，但均不满足当前约束）`;
      return `暂未生成可用路线 · ${state.constraints.startPoint}出发 · ${diag}`;
    }
    return `${state.constraints.startPoint}出发 · ${state.selectedStops.length}站 · 约${state.totalEstimatedMinutes}分钟 · 预计¥${state.totalEstimatedCost}`;
  }

  private buildRouteOverview(state: CityWalkGraphState, tradeoffs = this.buildConstraintTradeoffs(state)): RouteOverview {
    const travelMinutes = state.routeLegs.reduce((sum, leg) => sum + leg.durationMinutes, 0);
    const stayMinutes = state.selectedStops.reduce((sum, stop) => sum + stop.estimatedStayMinutes, 0);
    const weather = state.weather ?? {
      summary: `${state.constraints.city}天气数据不可用`,
      rainProbability: 0,
      risk: state.weatherRisk ?? "low",
      indices: []
    };
    const routeRisk = state.weatherRisk ?? weather.risk;
    const accessibilityNote = this.describeAccessibility(state.constraints.accessibility);
    const effectiveMaxLegMinutes = this.effectiveMaxLegMinutes(state.constraints);
    const importantNotes = [
      `同行：${this.describeParty(state.constraints.party)}`,
      this.describeExperience(state.constraints.experience) ? `体验：${this.describeExperience(state.constraints.experience)}` : undefined,
      accessibilityNote ? `无障碍硬约束：${accessibilityNote}` : undefined,
      accessibilityNote ? "地图 POI 不保证设施实时准确，出发前请向场馆确认无台阶入口、电梯和无障碍卫生间可用性。" : undefined,
      this.describeStyle(state.constraints.style) ? `风格：${this.describeStyle(state.constraints.style)}` : undefined,
      state.constraints.budget != null ? `预算：¥${state.constraints.budget}，当前估算¥${state.totalEstimatedCost}` : undefined,
      effectiveMaxLegMinutes ? `单段步行尽量不超过 ${effectiveMaxLegMinutes} 分钟；公交地铁段不计入步行上限` : undefined,
      state.constraints.endPoint ? `指定终点：${state.constraints.endPoint}` : undefined,
      state.routeLegs.some((leg) => leg.estimated) ? "部分路段为无路径 API 时的直线估算，请以地图导航为准" : undefined,
      ...tradeoffs.map((tradeoff) =>
        `取舍说明：${tradeoff.issue} 当前选择：${tradeoff.decision} 可选调整：${tradeoff.alternatives.join("；")}`
      ),
      ...state.corrections.slice(-2)
    ].filter((item): item is string => Boolean(item));
    const advice = [
      routeRisk === "high" ? "优先执行室内站点，并准备雨具或备选交通。" : routeRisk === "medium" ? "天气或环境条件一般，请结合生活指数做好防晒、防暑、雨具等防护。" : "天气风险较低，可按计划出发。",
      weather.airQuality && weather.airQuality.aqi >= 100 ? "空气质量一般，敏感人群应减少长时间户外停留。" : undefined,
      weather.warning ? `关注${weather.warning.title}。` : undefined,
      ...weather.indices.slice(0, 2).map((index) => `${index.name}：${index.category}`)
    ].filter((item): item is string => Boolean(item));
    return {
      title: `${state.constraints.city} CityWalk｜${state.constraints.startPoint}出发`,
      city: state.constraints.city,
      startPoint: state.constraints.startPoint,
      endPoint: state.constraints.endPoint,
      stopCount: state.selectedStops.length,
      partyLabel: this.describeParty(state.constraints.party),
      time: { totalMinutes: state.totalEstimatedMinutes, travelMinutes, stayMinutes },
      cost: {
        total: state.totalEstimatedCost,
        perPerson: state.constraints.party.total > 0 ? Math.round(state.totalEstimatedCost / state.constraints.party.total) : undefined,
        budget: state.constraints.budget
      },
      weather: {
        summary: weather.summary,
        risk: routeRisk,
        rainProbability: weather.rainProbability,
        airQuality: weather.airQuality ? { aqi: weather.airQuality.aqi, category: weather.airQuality.category } : undefined,
        warning: weather.warning ? `${weather.warning.title}（${weather.warning.level}）` : undefined,
        advice
      },
      importantNotes,
      tradeoffs
    };
  }

  private completeStep(steps: AgentPlanStep[], stepId: string): AgentPlanStep[] {
    return steps.map((item) => (item.id === stepId ? { ...item, status: "completed" } : item));
  }

  private withRouteLegLabels(
    legs: RouteLeg[],
    startPoint: string,
    stops: Array<RouteStop & { location: string }>
  ): RouteLeg[] {
    const names = new Map(stops.map((stop) => [stop.location, stop.name]));
    return legs.map((leg) => ({
      ...leg,
      originName: leg.originName ?? names.get(leg.origin) ?? startPoint,
      destinationName: leg.destinationName ?? names.get(leg.destination) ?? leg.destination
    }));
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
        intent: state.intent.intent,
        response_kind: state.responseKind,
        budget: state.constraints.budget,
        used_budget: state.totalEstimatedCost,
        duration_minutes: state.constraints.durationMinutes,
        used_minutes: state.totalEstimatedMinutes,
        party: state.constraints.party,
        experience: state.constraints.experience,
        style: state.constraints.style,
        constraint_ledger: state.constraints.constraintLedger,
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
    "香江": "香港", "港岛": "香港",
    "濠江": "澳门",
  };

  // Single-char aliases matched ONLY as standalone word (not substring)
  private readonly singleCharAliases: Record<string, string> = {
    "沪": "上海", "穗": "广州", "渝": "重庆", "蓉": "成都",
  };

  private knownCities = [
    "南京", "北京", "上海", "杭州", "苏州", "广州", "深圳", "成都", "西安",
    "武汉", "重庆", "天津", "长沙", "郑州", "青岛", "厦门", "昆明", "大连",
    "宁波", "无锡", "合肥", "福州", "济南", "沈阳", "哈尔滨", "长春", "太原",
    "南昌", "南宁", "贵阳", "兰州", "银川", "海口", "拉萨", "乌鲁木齐",
    "香港", "澳门", "台北", "高雄", "台中", "台南",
    "石家庄", "呼和浩特", "西宁", "三亚", "珠海", "佛山", "东莞", "中山",
    "惠州", "汕头", "泉州", "温州", "嘉兴", "绍兴", "扬州", "镇江", "常州",
    "徐州", "南通", "洛阳", "开封", "桂林", "大理", "丽江", "秦皇岛",
    "威海", "烟台", "淄博", "潍坊", "唐山", "保定", "邯郸", "宜昌", "襄阳",
    "日本东京", "东京", "京都", "大阪", "首尔", "釜山", "新加坡", "曼谷", "清迈",
    "巴黎", "伦敦", "纽约", "洛杉矶", "旧金山", "罗马", "米兰", "柏林", "维也纳",
    "布拉格", "巴塞罗那", "马德里", "里斯本", "悉尼", "墨尔本"
  ];

  private matchCity(task: string): string | undefined {
    const matches: Array<{ index: number; city: string }> = [];
    const addMatches = (token: string, city: string) => {
      let from = 0;
      while (from < task.length) {
        const index = task.indexOf(token, from);
        if (index < 0) break;
        const after = task.slice(index + token.length, index + token.length + 4);
        // "南京东路" is a place name, not evidence that the route city is 南京.
        if (!/^[东西南北中]?(?:路|街|大道|大街)/u.test(after)) matches.push({ index, city });
        from = index + token.length;
      }
    };

    for (const [alias, city] of Object.entries(this.cityAliases)) {
      addMatches(alias, city);
    }
    for (const [alias, city] of Object.entries(this.singleCharAliases)) {
      const re = new RegExp(`(^|[^\\w])${alias}($|[^\\w])`);
      const match = re.exec(task);
      if (match) matches.push({ index: match.index + match[1].length, city });
    }
    for (const city of [...this.knownCities].sort((left, right) => right.length - left.length)) {
      addMatches(city, city === "日本东京" ? "东京" : city);
    }

    if (matches.length > 0) {
      const unique = matches
        .sort((left, right) => left.index - right.index)
        .filter((item, index, items) => index === 0 || item.index !== items[index - 1].index || item.city !== items[index - 1].city);
      const retargeted = unique.find((item) =>
        /(?:改|换|调整|迁移)(?:成|到|为|去)?\s*$/u.test(task.slice(Math.max(0, item.index - 10), item.index))
      );
      return retargeted?.city ?? unique[0].city;
    }

    // Open fallback for a city not yet in the catalogue, but only when the
    // wording clearly marks it as the destination. This avoids treating any
    // arbitrary noun as a city.
    const contextual = task.match(/(?:(?<!现)在|(?<!过)去|(?<![看知提遇等收得])到|目的地(?:是|为)?|城市(?:是|选)?)[\s：:]*(?:中国)?([\p{Script=Han}A-Za-z·]{2,16}?)(?:市|特别行政区)?(?=选|做|走|逛|玩|游|旅行|旅游|漫游|安排|规划|设计|有|的(?:路线|行程)|city\s*walk|[，。,\s])/iu)?.[1];
    return this.normalizeCityName(contextual);
  }

  private matchStartPoint(task: string): string | undefined {
    const patterns = [
      /从(.{2,20}?)(?:出发|开始|起步)/u,
      /(?:^|[，。！？!?；;\s])([\p{Script=Han}A-Za-z0-9·（）()\-]{2,24}?)(?:出发|开始|起步)/u,
      /(?:起点|出发点)(?:是|为|设在|选在|选择)?[：:\s]*(.{2,20}?)(?:[，。,.；;\n]|$)/u,
      /以(.{2,20}?)为(?:起点|出发点)/u,
    ];
    for (const pattern of patterns) {
      const value = task.match(pattern)?.[1]?.trim();
      if (value) return value;
    }
    return undefined;
  }

  private hasExplicitStartPointCue(task: string): boolean {
    return /(?:从.{1,24}(?:出发|开始|起步)|(?:^|[，。！？!?；;\s])[\p{Script=Han}A-Za-z0-9·（）()\-]{2,24}?(?:出发|开始|起步)|起点|出发点|以.{1,24}为起点)/u.test(task);
  }

  private hasUnlimitedBudget(task: string): boolean {
    return /(?:预算|花费|费用|消费|人均).{0,5}(?:不限|无限|不设限|无上限)|不设(?:预算|花费上限)/u.test(task);
  }

  private hasUnlimitedDuration(task: string): boolean {
    return /(?:时间|时长|游玩时间).{0,5}(?:不限|无限|不设限|无上限)|不限时/u.test(task);
  }

  private normalizeCityName(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    let city = value.trim().replace(/^(?:中国|中华人民共和国)[\s·-]*/u, "");
    if (!city) return undefined;
    if (/^(?:当前|当地|目标|未知|未指定|待确认)(?:城市)?$/u.test(city)) return undefined;
    city = this.cityAliases[city] ?? city;
    city = city.replace(/(?:特别行政区)$/u, "").replace(/市$/u, "");
    if (!city || /^(?:当前|当地|目标|未知|未指定|待确认)(?:城市)?$/u.test(city)) return undefined;
    return this.cityAliases[city] ?? city;
  }

  private sameCity(left: unknown, right: unknown): boolean {
    const normalizedLeft = this.normalizeCityName(left);
    const normalizedRight = this.normalizeCityName(right);
    return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
  }

  private defaultStartPointForCity(city: string): string {
    return city === UNSPECIFIED_CITY ? UNSPECIFIED_START_POINT : `${city}市中心`;
  }

  private isPoiCityCompatible(poi: Pick<Poi, "city">, requestedCity: string): boolean {
    if (!poi.city) return true;
    return this.sameCity(poi.city, requestedCity);
  }

  private matchDuration(task: string): number | undefined {
    const hourMatch = task.match(/(\d+(?:\.\d+)?)\s*(?:小时|h)/i);
    if (hourMatch) return Math.round(Number(hourMatch[1]) * 60);
    for (const minuteMatch of task.matchAll(/(\d+)\s*(?:分钟|min)/gi)) {
      const start = minuteMatch.index ?? 0;
      const contextBefore = task.slice(Math.max(0, start - 18), start);
      if (/(?:单段|每段|各段|步行|交通|换乘|休息间隔).{0,10}$/u.test(contextBefore)) continue;
      return Number(minuteMatch[1]);
    }
    return undefined;
  }

  private matchBudget(task: string): number | undefined {
    return Number(task.match(/(?:预算|人均|花费|控制在)?\s*(\d+)\s*(?:元|块)/)?.[1]) || undefined;
  }

  private matchPeopleCount(task: string): number | undefined {
    const family = task.match(/一家([零〇一二两三四五六七八九十\d]+)口/);
    if (family) return this.parseLocalizedCount(family[1]);
    const group = task.match(/(?:一行|同行|共|总共)?\s*([零〇一二两三四五六七八九十\d]+)\s*(?:个人|人)(?:同行|出行)?/);
    if (group) return this.parseLocalizedCount(group[1]);
    const composition = task.match(/([零〇一二两三四五六七八九十\d]+)\s*(?:大人|成人|大)\s*([零〇一二两三四五六七八九十\d]+)\s*(?:小孩|孩子|儿童|小)/);
    if (composition) {
      const adults = this.parseLocalizedCount(composition[1]) ?? 0;
      const children = this.parseLocalizedCount(composition[2]) ?? 0;
      return adults + children || undefined;
    }
    return undefined;
  }

  private matchPartyConstraints(task: string): Partial<PartyConstraints> {
    const number = "([零〇一二两三四五六七八九十\\d]+)";
    const party: Partial<PartyConstraints> = {};
    const composition = task.match(new RegExp(`${number}\\s*(?:位|个)?(?:大人|成人|大)\\s*${number}\\s*(?:名|位|个)?(?:小孩|孩子|儿童|小)`));
    if (composition) {
      party.adults = this.parseLocalizedCount(composition[1]);
      party.children = this.parseLocalizedCount(composition[2]);
    } else {
      const adult = task.match(new RegExp(`${number}\\s*(?:位|个)?(?:大人|成人)`));
      const child = task.match(new RegExp(`${number}\\s*(?:名|位|个)?(?:小孩|孩子|儿童|宝宝|娃)`));
      party.adults = adult ? this.parseLocalizedCount(adult[1]) : undefined;
      party.children = child ? this.parseLocalizedCount(child[1]) : undefined;
    }

    const senior = task.match(new RegExp(`${number}\\s*(?:名|位|个)?(?:老人|长辈|老年人)`));
    party.seniors = senior ? this.parseLocalizedCount(senior[1]) : undefined;
    if (party.children == null && /带.{0,5}(?:小孩|孩子|儿童|宝宝|娃)|亲子出行|亲子游/.test(task)) party.children = 1;
    if (party.seniors == null && /带.{0,5}(?:老人|长辈)|老人同行/.test(task)) party.seniors = 1;

    const ages = [
      ...task.matchAll(/(\d{1,2})\s*岁(?:半)?(?:的)?(?:小孩|孩子|儿童|宝宝|娃)/g),
      ...task.matchAll(/(?:小孩|孩子|儿童|宝宝|娃).{0,4}?(\d{1,2})\s*岁/g)
    ].map((match) => Number(match[1])).filter((age) => age >= 0 && age <= 17);
    if (ages.length > 0) {
      party.childAges = [...new Set(ages)];
      party.children = Math.max(party.children ?? 0, party.childAges.length);
    }

    party.total = this.matchPeopleCount(task);
    if (party.total == null && (party.adults != null || party.children != null || party.seniors != null)) {
      const known = (party.adults ?? 0) + (party.children ?? 0) + (party.seniors ?? 0);
      party.total = known + (party.adults == null && ((party.children ?? 0) > 0 || (party.seniors ?? 0) > 0) ? 1 : 0);
    }
    party.stroller = /婴儿车|儿童推车|宝宝推车|手推车/.test(task) ? true : undefined;
    const wheelchairCancelled = /(?:不再需要|不需要|无需|取消).{0,6}(?:轮椅|无障碍)/.test(task);
    const mobilityNeeds = [
      /轮椅/.test(task) && !wheelchairCancelled ? "轮椅通行" : undefined,
      /腿脚不便|行动不便|不便久走/.test(task) ? "行动不便" : undefined,
      /无障碍/.test(task) && !wheelchairCancelled ? "无障碍设施" : undefined
    ].filter((item): item is string => Boolean(item));
    party.mobilityNeeds = mobilityNeeds.length > 0 ? mobilityNeeds : undefined;
    return party;
  }

  private matchAccessibilityConstraints(task: string): AccessibilityConstraints {
    const wheelchairCancelled = /(?:不再需要|不需要|无需|取消).{0,6}(?:轮椅通行|无障碍设施|无障碍要求)/.test(task);
    const stepFreeCancelled = /(?:不再需要|不需要|无需|取消).{0,6}(?:无台阶|避开楼梯)/.test(task);
    const elevatorCancelled = /(?:不再需要|不需要|无需|取消).{0,6}电梯/.test(task);
    const restroomCancelled = /(?:不再需要|不需要|无需|取消).{0,6}无障碍卫生间/.test(task);
    const restCancelled = /(?:不再需要|不需要|无需|取消).{0,6}(?:频繁休息|休息点|座椅)/.test(task);
    const wheelchairSignal = /轮椅|无障碍通行|行动不便|腿脚不便/.test(task);
    const strollerOnly = /婴儿车|儿童推车|宝宝推车|手推车/.test(task) && !wheelchairSignal;
    return {
      wheelchairAccessRequired: wheelchairCancelled ? false : wheelchairSignal ? true : strollerOnly ? false : undefined,
      stepFreeRequired: stepFreeCancelled
        ? false
        : /无台阶|避开楼梯|不要楼梯|不能爬楼梯|不便爬楼梯|全程平路|轮椅|无障碍通行/.test(task) ? true : undefined,
      elevatorRequired: elevatorCancelled ? false : /(?:需要|必须|要有|有)电梯|电梯可达/.test(task) ? true : undefined,
      accessibleRestroomRequired: restroomCancelled ? false : /无障碍卫生间|无障碍厕所/.test(task) ? true : undefined,
      frequentRestRequired: restCancelled
        ? false
        : /频繁休息|随时休息|多安排.{0,4}休息|每.{0,6}分钟.{0,4}休息|需要.{0,4}(?:座椅|休息点)/.test(task) ? true : undefined
    };
  }

  private groundLlmAccessibility(task: string, candidate: unknown): AccessibilityConstraints {
    const explicit = this.matchAccessibilityConstraints(task);
    const parsed = this.normalizeAccessibilityCandidate(candidate);
    const grounded: AccessibilityConstraints = {};
    const fields: Array<keyof AccessibilityConstraints> = [
      "wheelchairAccessRequired",
      "stepFreeRequired",
      "elevatorRequired",
      "accessibleRestroomRequired",
      "frequentRestRequired"
    ];
    for (const field of fields) {
      if (explicit[field] !== undefined && parsed[field] !== undefined) grounded[field] = parsed[field];
    }
    return grounded;
  }

  private matchExperienceConstraints(task: string): RouteExperienceConstraints {
    let pace: RouteExperienceConstraints["pace"];
    if (/轻松|悠闲|慢节奏|不要太累|不赶时间|少走路|少步行/.test(task)) pace = "relaxed";
    if (/紧凑|高强度|尽量多去|多打卡/.test(task)) pace = "intensive";
    return {
      familyFriendly: /亲子|儿童友好|适合.{0,5}(?:小孩|孩子|儿童)|带.{0,5}(?:小孩|孩子|儿童|宝宝|娃)/.test(task) ? true : undefined,
      pace,
      restStopRequired: /休息点|中途休息|方便休息|有.{0,3}(?:座椅|休息区)/.test(task) ? true : undefined,
      restroomPreferred: /卫生间|洗手间|母婴室|母婴设施/.test(task) ? true : undefined,
      avoidCrowds: /避开.{0,3}(?:人群|拥挤|高峰)|不要拥挤|人少一点|清静一点/.test(task) ? true : undefined
    };
  }

  private parseLocalizedCount(raw: string): number | undefined {
    if (/^\d+$/.test(raw)) {
      const value = Number(raw);
      return value > 0 ? value : undefined;
    }
    const digits: Record<string, number> = {
      零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
      五: 5, 六: 6, 七: 7, 八: 8, 九: 9
    };
    if (raw === "十") return 10;
    if (raw.includes("十")) {
      const [left, right] = raw.split("十");
      const value = (left ? digits[left] : 1) * 10 + (right ? digits[right] : 0);
      return value > 0 ? value : undefined;
    }
    const value = digits[raw];
    return value > 0 ? value : undefined;
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
    const matched = this.matchExplicitPreferences(task);
    return matched.length > 0 ? matched : ["书店", "咖啡", "博物馆", "公园", "景点", "美食", "奶茶"];
  }

  private matchTransportMode(task: string): UserConstraints["transportMode"] | undefined {
    if (/尽量步行|优先步行|步行即可|全程步行/.test(task)) return "walk";
    if (/地铁|公交|公共交通|少走路/.test(task)) return "transit";
    return undefined;
  }

  private matchWeatherPreference(task: string): UserConstraints["weatherPreference"] | undefined {
    if (/室内优先|优先室内/.test(task)) return "indoor_first";
    if (/避雨|下雨|雨天/.test(task)) return "avoid_rain";
    if (/户外优先|可以户外|喜欢户外/.test(task)) return "outdoor_ok";
    return undefined;
  }

  private matchWeatherRisk(task: string): UserConstraints["weatherRisk"] | undefined {
    if (/暴雨|大雨|雷暴|台风|暴雪|冰雹|极端高温|红色预警/.test(task)) return "high";
    if (/下雨|雨天|降雨|下雪|高温|大风|黄色预警|橙色预警/.test(task)) return "medium";
    if (/天气很好|晴朗|无雨|适合户外/.test(task)) return "low";
    return undefined;
  }

  private matchExplicitPreferences(task: string): string[] {
    const allPrefs = ["书店", "咖啡", "博物馆", "美术馆", "展览", "公园", "街区", "商场", "美食", "餐厅", "景点", "奶茶", "甜品", "影院"];
    return allPrefs.filter((keyword) => task.includes(keyword));
  }

  private describeStructuredInput(input: PlanRequest): string {
    const budgetNote = input.budget != null ? `，预算${input.budget}元` : '';
    const timeNote = input.durationMinutes != null ? `${input.durationMinutes}分钟` : '不限时';
    const partyNote = input.party
      ? `，同行${input.party.total ?? input.peopleCount ?? "多人"}${input.party.children ? `（${input.party.children}名儿童）` : ""}`
      : input.peopleCount ? `，同行${input.peopleCount}人` : "";
    const experienceNote = input.experience?.familyFriendly ? "，亲子友好" : "";
    const styleNote = input.styleDescription ? `，风格为${input.styleDescription}` : input.style?.summary ? `，风格为${input.style.summary}` : "";
    const city = this.normalizeCityName(input.city) ?? UNSPECIFIED_CITY;
    const startPoint = input.startPoint?.trim() ?? this.defaultStartPointForCity(city);
    return `${city} CityWalk：从${startPoint}出发，${timeNote}${budgetNote}${partyNote}${experienceNote}${styleNote}，偏好${(input.preferences ?? ["书店", "咖啡"]).join("、")}`;
  }
}

const UNSPECIFIED_CITY = "待确认城市";
const UNSPECIFIED_START_POINT = "待确认起点";
