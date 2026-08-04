import { LlmRouter } from "../llm/llmRouter";
import { EmbeddingProvider, embeddingProvider } from "./embeddingService";
import {
  MemoryCandidate,
  MemoryContext,
  MemoryDecision,
  MemoryItem,
  MemoryMutationResult,
  PlaceFeedbackInput
} from "../types/memory";
import {
  ConstraintLedgerEntry,
  PlanningResult,
  PlanRequest,
  UserConstraints
} from "../types/plan";
import { memoryStore, MemoryStore } from "./memoryStore";
import { compileHeuristicStyle, emptyStyleIntent, isStyleActive, mergeStyleIntents, normalizeStyleIntent } from "./styleService";

const DURABLE_MEMORY_SIGNAL =
  /记住|忘掉|忘记|删除.{0,4}记忆|以后|下次|每次|一直|通常|总是|默认|习惯|去过|上次去|体验|觉得.{0,8}(?:好|差|挤|吵|贵)|我.{0,4}(?:喜欢|偏爱|讨厌|不喜欢|不能|不吃|过敏|腿脚不便|使用轮椅)|别再|不要再/;

const CATEGORY_TERMS = [
  "书店", "咖啡", "博物馆", "美术馆", "展览", "公园", "街区", "商场",
  "美食", "餐厅", "景点", "奶茶", "甜品", "影院", "酒吧", "夜市"
];

const CATEGORY_ALIASES: Record<string, string> = {
  bookstore: "书店", books: "书店", cafe: "咖啡", coffee: "咖啡",
  museum: "博物馆", gallery: "美术馆", park: "公园", mall: "商场",
  restaurant: "餐厅", food: "美食", sight: "景点", cinema: "影院"
};

export interface MemoryEmbeddingStatus {
  configured: boolean;
  available: boolean;
  model: string;
  dimensions: number;
  totalActive: number;
  indexed: number;
  pending: number;
  retryAfter?: string;
}

export interface MemoryEmbeddingBackfillResult extends MemoryEmbeddingStatus {
  indexedNow: number;
}

function slug(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, "_").replace(/[^\p{L}\p{N}_-]/gu, "");
}

function userAuthoredTask(task: string): string {
  return task.split(/\n<citywalk_ui_context>/u, 1)[0].trim();
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function appendConstraintMemoryLedger(
  constraints: UserConstraints,
  prefix: "party" | "experience" | "style",
  value: Record<string, unknown>
): void {
  const entries: ConstraintLedgerEntry[] = Object.entries(value)
    .filter(([, item]) => item !== undefined && item !== null)
    .map(([key, item]) => ({
      path: `${prefix}.${key}`,
      value: item,
      source: "memory" as const,
      priority: "soft" as const
    }));
  constraints.constraintLedger = [
    ...constraints.constraintLedger.filter((entry) => !entry.path.startsWith(`${prefix}.`)),
    ...entries
  ];
}

function sameMemory(existing: MemoryItem, candidate: MemoryCandidate): boolean {
  return existing.text.trim() === candidate.text.trim()
    && existing.polarity === (candidate.polarity ?? "neutral")
    && JSON.stringify(existing.data) === JSON.stringify(candidate.data ?? {});
}

export class MemoryService {
  private readonly llmRouter = new LlmRouter();
  private embeddingRetryAfter = 0;
  private lastEmbeddingWarningAt = 0;

  constructor(
    private readonly store: MemoryStore = memoryStore,
    private readonly embeddings: EmbeddingProvider = embeddingProvider
  ) {}

  async recall(input: PlanRequest): Promise<MemoryContext | undefined> {
    if (!input.userId) return undefined;
    const task = input.task ?? JSON.stringify(input);
    const recalled = await this.hybridSearch(input.userId, task, input.city, 8);
    return {
      userId: input.userId,
      threadId: input.threadId,
      recalled,
      recentMessages: input.threadId
        ? this.store.getRecentMessages(input.userId, input.threadId, 10)
        : []
    };
  }

  /**
   * Applies memory only as a default. Current-turn explicit constraints always win.
   */
  applyDefaults(constraints: UserConstraints, input: PlanRequest, context?: MemoryContext): UserConstraints {
    if (!context) return constraints;
    const next: UserConstraints = {
      ...constraints,
      preferences: [...constraints.preferences],
      party: constraints.party ?? { total: constraints.peopleCount ?? 1, adults: constraints.peopleCount ?? 1, mobilityNeeds: [] },
      experience: constraints.experience ?? { pace: "normal" },
      accessibility: constraints.accessibility ?? {},
      style: constraints.style ?? emptyStyleIntent(),
      constraintLedger: [...(constraints.constraintLedger ?? [])]
    };
    const task = input.task ?? "";
    const hasExplicitPreference = Boolean(constraints.preferencesExplicit)
      || Boolean(input.preferences?.length)
      || CATEGORY_TERMS.some((term) => task.includes(term));
    const positiveCategories = context.recalled
      .filter((memory) => memory.kind === "semantic" && memory.key.startsWith("preference:category:") && memory.polarity === "positive")
      .map((memory) => String(memory.data.category ?? ""))
      .filter(Boolean);
    const negativeCategories = new Set(
      context.recalled
        .filter((memory) => memory.kind === "semantic" && memory.key.startsWith("preference:category:") && memory.polarity === "negative")
        .map((memory) => String(memory.data.category ?? ""))
        .filter(Boolean)
    );

    if (!hasExplicitPreference && positiveCategories.length > 0) {
      next.preferences = [...new Set(positiveCategories)];
    }
    if (!hasExplicitPreference) {
      next.preferences = next.preferences.filter((preference) => !negativeCategories.has(preference));
    }

    for (const memory of context.recalled.filter((item) => item.kind === "procedural")) {
      const transportExplicit = Boolean(
        constraints.transportModeExplicit || input.transportMode || /步行|地铁|公交|公共交通|骑行/.test(task)
      );
      const weatherExplicit = Boolean(
        constraints.weatherPreferenceExplicit || input.weatherPreference || /室内|户外|避雨|下雨|雨天/.test(task)
      );
      const maxLegExplicit = Boolean(
        constraints.maxLegMinutesExplicit || input.maxLegMinutes || /(?:步行|每段|单段).{0,8}\d+\s*分钟/.test(task)
      );
      if (memory.key === "planning:transport_mode" && !transportExplicit) {
        const mode = memory.data.transportMode;
        if (mode === "walk" || mode === "transit" || mode === "mixed") next.transportMode = mode;
      }
      if (memory.key === "planning:weather_preference" && !weatherExplicit) {
        const preference = memory.data.weatherPreference;
        if (preference === "avoid_rain" || preference === "indoor_first" || preference === "outdoor_ok") {
          next.weatherPreference = preference;
        }
      }
      if (memory.key === "planning:max_leg_minutes" && !maxLegExplicit) {
        const minutes = Number(memory.data.maxLegMinutes);
        if (Number.isFinite(minutes) && minutes > 0) next.maxLegMinutes = minutes;
      }
    }

    const partyExplicit = Boolean(
      constraints.partyExplicit
      || input.party
      || input.peopleCount
      || /一家|一行|同行|大人|成人|孩子|小孩|儿童|老人|婴儿车|轮椅|亲子/.test(task)
    );
    if (!partyExplicit) {
      const partyMemory = context.recalled.find((memory) =>
        memory.kind === "semantic" && (memory.key.startsWith("party:") || memory.data.children != null || memory.data.seniors != null)
      );
      if (partyMemory) {
        const data = partyMemory.data;
        const children = positiveInteger(data.children);
        const seniors = positiveInteger(data.seniors);
        const adults = positiveInteger(data.adults);
        const childAges = Array.isArray(data.childAges)
          ? data.childAges.map(Number).filter((age) => Number.isInteger(age) && age >= 0 && age <= 17)
          : undefined;
        const stroller = typeof data.stroller === "boolean" ? data.stroller : undefined;
        const mobilityNeeds = Array.isArray(data.mobilityNeeds) ? data.mobilityNeeds.map(String).filter(Boolean) : [];
        const known = (adults ?? 0) + (children ?? 0) + (seniors ?? 0);
        const total = Math.max(next.party.total, known + (adults == null && known > 0 ? 1 : 0));
        next.party = {
          ...next.party,
          total,
          adults: adults ?? Math.max(0, total - (children ?? 0) - (seniors ?? 0)),
          children: children ?? next.party.children,
          seniors: seniors ?? next.party.seniors,
          childAges: childAges?.length ? childAges : next.party.childAges,
          stroller: stroller ?? next.party.stroller,
          mobilityNeeds: mobilityNeeds.length ? mobilityNeeds : next.party.mobilityNeeds
        };
        next.peopleCount = total;
        appendConstraintMemoryLedger(next, "party", next.party as unknown as Record<string, unknown>);
      }
    }

    const experienceExplicit = Boolean(
      constraints.experienceExplicit
      || input.experience
      || /亲子|儿童友好|轻松|悠闲|少走路|休息点|卫生间|洗手间|避开.{0,3}拥挤/.test(task)
    );
    if (!experienceExplicit) {
      const experienceMemory = context.recalled.find((memory) =>
        (memory.kind === "procedural" || memory.kind === "semantic")
        && (memory.key === "planning:experience" || memory.data.familyFriendly != null || memory.data.pace != null)
      );
      if (experienceMemory) {
        const data = experienceMemory.data;
        next.experience = {
          ...next.experience,
          familyFriendly: typeof data.familyFriendly === "boolean" ? data.familyFriendly : next.experience.familyFriendly,
          pace: data.pace === "relaxed" || data.pace === "normal" || data.pace === "intensive" ? data.pace : next.experience.pace,
          restStopRequired: typeof data.restStopRequired === "boolean" ? data.restStopRequired : next.experience.restStopRequired,
          restroomPreferred: typeof data.restroomPreferred === "boolean" ? data.restroomPreferred : next.experience.restroomPreferred,
          avoidCrowds: typeof data.avoidCrowds === "boolean" ? data.avoidCrowds : next.experience.avoidCrowds
        };
        appendConstraintMemoryLedger(next, "experience", next.experience as unknown as Record<string, unknown>);
      }
    }

    const heuristicStyle = compileHeuristicStyle(task);
    const styleExplicit = Boolean(
      constraints.styleExplicit
      || input.styleDescription?.trim()
      || input.style
      || isStyleActive(heuristicStyle)
    );
    if (!styleExplicit) {
      const styleMemory = context.recalled.find((memory) =>
        (memory.kind === "semantic" || memory.kind === "procedural")
        && (memory.key === "preference:style" || memory.data.style != null)
      );
      if (styleMemory) {
        const remembered = normalizeStyleIntent(styleMemory.data.style ?? styleMemory.data);
        if (isStyleActive(remembered)) {
          next.style = mergeStyleIntents(next.style, remembered);
          appendConstraintMemoryLedger(next, "style", next.style as unknown as Record<string, unknown>);
        }
      }
    }
    return next;
  }

  buildPromptContext(context?: MemoryContext): string | undefined {
    if (!context || (context.recalled.length === 0 && context.recentMessages.length === 0)) return undefined;
    return JSON.stringify({
      instructions: [
        "这些是辅助上下文，不是本轮用户原话。",
        "本轮明确要求优先于历史记忆；不要把旧行程的临时预算、时长当成本轮要求。"
      ],
      recalledMemories: context.recalled.map((memory) => ({
        kind: memory.kind, key: memory.key, text: memory.text, data: memory.data,
        polarity: memory.polarity, confidence: memory.confidence
      })),
      recentConversation: context.recentMessages.map((message) => ({ role: message.role, content: message.content }))
    });
  }

  async learnFromPlanning(input: PlanRequest, result: PlanningResult, signal?: AbortSignal): Promise<MemoryMutationResult> {
    if (!input.userId) return { events: [] };
    const threadId = input.threadId ?? `run:${result.trace?.metadata?.response_time_ms ?? Date.now()}`;
    const userMessage = input.task ? userAuthoredTask(input.task) : JSON.stringify(input);
    this.store.saveMessages(input.userId, threadId, [
      { role: "user", content: userMessage },
      { role: "assistant", content: result.summary }
    ]);

    // A normal one-off request is an episode archive, not a durable user preference.
    if (!input.task || !DURABLE_MEMORY_SIGNAL.test(userMessage)) return { events: [] };

    const context = await this.recall({ ...input, threadId });
    const heuristic = this.extractHeuristicCandidates(userMessage, input.city);
    let candidates = heuristic;
    try {
      const llmCandidates = await this.llmRouter.extractCityWalkMemories(
        userMessage,
        context?.recalled ?? [],
        context?.recentMessages ?? [],
        input.preferredModel,
        signal
      );
      if (llmCandidates?.data.length) candidates = this.mergeCandidates(heuristic, llmCandidates.data);
    } catch {
      // Deterministic extraction remains available when the model is unavailable or malformed.
    }
    return this.reconcile(input.userId, threadId, candidates);
  }

  async addExplicit(userId: string, candidate: MemoryCandidate, threadId?: string): Promise<MemoryDecision> {
    return this.applyCandidate(userId, threadId, {
      ...candidate,
      source: candidate.source ?? "user_explicit",
      confidence: candidate.confidence ?? 1
    });
  }

  async recordPlaceFeedback(input: PlaceFeedbackInput): Promise<MemoryDecision> {
    const placeIdentity = input.poiId ? `poi:${slug(input.poiId)}` : `place:${slug(`${input.city ?? "global"}:${input.placeName}`)}`;
    return this.applyCandidate(input.userId, input.threadId, {
      kind: "episodic",
      key: `feedback:${placeIdentity}`,
      text: `用户${input.sentiment === "like" ? "喜欢" : "不喜欢"}${input.city ? `${input.city}的` : ""}${input.placeName}${input.comment ? `：${input.comment}` : ""}`,
      data: {
        placeName: input.placeName,
        poiId: input.poiId,
        sentiment: input.sentiment,
        tags: input.tags ?? [],
        comment: input.comment
      },
      city: input.city,
      polarity: input.sentiment === "like" ? "positive" : "negative",
      confidence: 1,
      source: "user_feedback"
    });
  }

  getEmbeddingStatus(userId: string): MemoryEmbeddingStatus {
    const stats = this.store.getEmbeddingStats(userId, this.embeddings.model, this.embeddings.dimensions);
    const retryAfter = this.embeddingRetryAfter > Date.now()
      ? new Date(this.embeddingRetryAfter).toISOString()
      : undefined;
    return {
      configured: this.embeddings.isConfigured(),
      available: this.canUseEmbeddings(),
      model: this.embeddings.model,
      dimensions: this.embeddings.dimensions,
      ...stats,
      retryAfter
    };
  }

  async backfillEmbeddings(userId: string, limit = 100): Promise<MemoryEmbeddingBackfillResult> {
    if (!this.embeddings.isConfigured()) throw new Error("Embedding API key is not configured");
    const candidates = this.store.listEmbeddingRefreshCandidates(
      userId,
      this.embeddings.model,
      this.embeddings.dimensions,
      Math.min(Math.max(limit, 1), 500)
    );
    try {
      if (candidates.length > 0) {
        const vectors = await this.embeddings.embedBatch(candidates.map(({ memory }) => memory.text));
        let indexedNow = 0;
        for (let index = 0; index < candidates.length; index += 1) {
          const memory = candidates[index].memory;
          if (this.store.upsertEmbedding(
            memory.id,
            this.embeddings.model,
            vectors[index],
            this.embeddings.contentHash(memory.text),
            memory.text
          )) indexedNow += 1;
        }
        this.embeddingRetryAfter = 0;
        return { ...this.getEmbeddingStatus(userId), indexedNow };
      }
      return { ...this.getEmbeddingStatus(userId), indexedNow: 0 };
    } catch (error) {
      this.suspendEmbeddings(error);
      throw error;
    }
  }

  private async reconcile(
    userId: string,
    threadId: string | undefined,
    candidates: MemoryCandidate[]
  ): Promise<MemoryMutationResult> {
    const events: MemoryDecision[] = [];
    for (const candidate of candidates) events.push(await this.applyCandidate(userId, threadId, candidate));
    return { events };
  }

  private async applyCandidate(
    userId: string,
    threadId: string | undefined,
    candidate: MemoryCandidate
  ): Promise<MemoryDecision> {
    const normalizedCandidate = this.normalizeCandidate(candidate);
    const requestedExisting = normalizedCandidate.existingMemoryId
      ? this.store.getById(normalizedCandidate.existingMemoryId, userId)
      : undefined;
    const existing = requestedExisting
      && requestedExisting.kind === normalizedCandidate.kind
      && requestedExisting.key === normalizedCandidate.key
        ? requestedExisting
        : this.store.findByKey(userId, normalizedCandidate.kind, normalizedCandidate.key);

    if (normalizedCandidate.actionHint === "DELETE") {
      if (!existing || existing.status === "deleted") {
        return { event: "NONE", candidate: normalizedCandidate, reason: "没有匹配的有效记忆可删除" };
      }
      this.store.delete(existing.id, userId, "用户明确要求遗忘或新事实与旧记忆冲突", threadId);
      return { event: "DELETE", candidate: normalizedCandidate, memoryId: existing.id, reason: "删除冲突或被撤回的旧记忆" };
    }

    if (existing && existing.status === "active" && sameMemory(existing, normalizedCandidate)) {
      return { event: "NONE", candidate: normalizedCandidate, memoryId: existing.id, reason: "与已有记忆相同" };
    }
    const event = existing
      ? this.store.updateById(existing.id, userId, normalizedCandidate, {
          threadId,
          reason: "同一记忆键出现了更具体或更新的信息"
        })
      : this.store.upsert(userId, normalizedCandidate, {
      threadId,
      reason: "抽取到新的持久化用户事实"
    });
    await this.indexMemory(event.memoryId, normalizedCandidate.text);
    return {
      event: event.action,
      candidate: normalizedCandidate,
      memoryId: event.memoryId,
      reason: event.reason
    };
  }

  private extractHeuristicCandidates(task: string, city?: string): MemoryCandidate[] {
    const candidates: MemoryCandidate[] = [];
    const forget = /忘掉|忘记|删除.{0,4}记忆/.test(task);
    for (const category of CATEGORY_TERMS.filter((term) => task.includes(term))) {
      const polarity = this.preferencePolarity(task, category);
      if (!polarity && !forget) continue;
      candidates.push({
        kind: "semantic",
        key: `preference:category:${slug(category)}`,
        text: `用户${polarity === "negative" ? "不喜欢" : "喜欢"}${category}类地点`,
        data: { category },
        polarity: polarity ?? "neutral",
        confidence: 0.95,
        source: "user_explicit",
        actionHint: forget ? "DELETE" : "UPSERT"
      });
    }

    if (/以后|每次|总是|默认|记住/.test(task)) {
      const durableStyle = compileHeuristicStyle(task);
      if (isStyleActive(durableStyle)) {
        candidates.push({
          kind: "semantic",
          key: "preference:style",
          text: `用户长期偏好${durableStyle.summary || durableStyle.rawText}的路线风格`,
          data: { style: durableStyle },
          polarity: "neutral",
          confidence: durableStyle.confidence,
          source: "user_explicit"
        });
      }
      if (/带.{0,5}(?:小孩|孩子|儿童|宝宝)|亲子/.test(task)) {
        candidates.push({
          kind: "semantic",
          key: "party:children",
          text: "用户通常会带儿童同行，路线需要考虑亲子友好性",
          data: { children: 1, familyFriendly: true },
          polarity: "neutral", confidence: 0.9, source: "user_explicit"
        });
      }
      if (/带.{0,5}(?:老人|长辈)|老人同行/.test(task)) {
        candidates.push({
          kind: "semantic",
          key: "party:seniors",
          text: "用户通常会与老人同行，需要轻松节奏和休息点",
          data: { seniors: 1, pace: "relaxed", restStopRequired: true },
          polarity: "neutral", confidence: 0.9, source: "user_explicit"
        });
      }
      if (/婴儿车|儿童推车/.test(task)) {
        candidates.push({
          kind: "semantic",
          key: "party:stroller",
          text: "用户同行时可能携带婴儿车，需要无障碍和少步行路线",
          data: { stroller: true, mobilityNeeds: ["无障碍设施"] },
          polarity: "neutral", confidence: 0.9, source: "user_explicit"
        });
      }
      if (/轻松|悠闲|少走路|休息点|卫生间|避开.{0,3}(?:拥挤|人群)/.test(task)) {
        candidates.push({
          kind: "procedural",
          key: "planning:experience",
          text: "用户长期偏好轻松、有休息点且设施便利的路线",
          data: {
            pace: /轻松|悠闲|少走路/.test(task) ? "relaxed" : undefined,
            restStopRequired: /休息点/.test(task) ? true : undefined,
            restroomPreferred: /卫生间/.test(task) ? true : undefined,
            avoidCrowds: /避开.{0,3}(?:拥挤|人群)/.test(task) ? true : undefined
          },
          polarity: "neutral", confidence: 0.9, source: "user_explicit"
        });
      }
      if (/少走|不太能走|腿脚|步行.{0,6}(?:不超过|以内)/.test(task)) {
        const minutes = Number(task.match(/步行.{0,8}?(\d+)\s*分钟/)?.[1] ?? 30);
        candidates.push({
          kind: "procedural", key: "planning:max_leg_minutes",
          text: `规划时单段步行尽量不超过${minutes}分钟`, data: { maxLegMinutes: minutes },
          polarity: "neutral", confidence: 0.95, source: "user_explicit"
        });
      }
      if (/优先.{0,4}(?:地铁|公交)|少走路/.test(task)) {
        candidates.push({
          kind: "procedural", key: "planning:transport_mode", text: "规划时优先使用公共交通，减少长距离步行",
          data: { transportMode: "transit" }, polarity: "neutral", confidence: 0.95, source: "user_explicit"
        });
      } else if (/尽量步行|优先步行/.test(task)) {
        candidates.push({
          kind: "procedural", key: "planning:transport_mode", text: "规划时优先步行",
          data: { transportMode: "walk" }, polarity: "neutral", confidence: 0.95, source: "user_explicit"
        });
      }
      if (/室内优先|优先室内|避雨/.test(task)) {
        candidates.push({
          kind: "procedural", key: "planning:weather_preference", text: "规划时遇到天气风险优先安排室内地点",
          data: { weatherPreference: "indoor_first" }, polarity: "neutral", confidence: 0.95, source: "user_explicit"
        });
      }
    }
    return candidates;
  }

  private preferencePolarity(task: string, category: string): "positive" | "negative" | undefined {
    const clauses = task.split(/[，,。；;！!？?]|但是|不过|但|却/).filter((clause) => clause.includes(category));
    const clause = clauses.at(-1) ?? task;
    if (/不喜欢|讨厌|避开|不要再|别再/.test(clause)) return "negative";
    if (/喜欢|偏爱|爱逛|常去|优先/.test(clause)) return "positive";
    return undefined;
  }

  private normalizeCandidate(candidate: MemoryCandidate): MemoryCandidate {
    const data = { ...(candidate.data ?? {}) };
    let key = candidate.key.trim().toLocaleLowerCase("zh-CN");
    if (key === "preference:route_style" || key === "preference:theme" || key === "preference:style_profile" || key.startsWith("preference:style:")) {
      key = "preference:style";
    }
    if (key === "preference:style" && !data.style && isStyleActive(normalizeStyleIntent(data))) {
      data.style = normalizeStyleIntent(data);
    }
    if (candidate.kind === "semantic" && key.startsWith("preference:category:")) {
      const rawCategory = String(data.category ?? key.split(":").at(-1) ?? "").trim().toLocaleLowerCase("zh-CN");
      const category = CATEGORY_ALIASES[rawCategory] ?? rawCategory;
      if (category) {
        data.category = category;
        key = `preference:category:${slug(category)}`;
      }
    }
    return {
      ...candidate,
      key: key.slice(0, 160),
      text: candidate.text.trim().slice(0, 500),
      data,
      city: candidate.kind === "semantic" && key.startsWith("preference:category:")
        ? undefined
        : candidate.city?.trim()
    };
  }

  private mergeCandidates(left: MemoryCandidate[], right: MemoryCandidate[]): MemoryCandidate[] {
    const merged = new Map<string, MemoryCandidate>();
    for (const candidate of [...left, ...right]) {
      if (!candidate.key || !candidate.text) continue;
      const identity = `${candidate.kind}:${candidate.key}`;
      const previous = merged.get(identity);
      if (!previous || (candidate.confidence ?? 0) >= (previous.confidence ?? 0)) merged.set(identity, candidate);
    }
    return [...merged.values()];
  }

  private async hybridSearch(userId: string, query: string, city: string | undefined, limit: number): Promise<MemoryContext["recalled"]> {
    const candidateLimit = Math.max(limit * 4, 24);
    const lexical = this.store.search(userId, query, city, candidateLimit, false);
    if (!this.canUseEmbeddings()) {
      const fallback = lexical.slice(0, limit);
      this.store.markAccessed(fallback.map((memory) => memory.id));
      return fallback;
    }

    try {
      await this.backfillMissingEmbeddings(userId);
      const queryVector = await this.embeddings.embed(query);
      const vector = this.store.searchVector(userId, queryVector, this.embeddings.model, city, candidateLimit);
      const byId = new Map<string, { lexical?: typeof lexical[number]; vector?: typeof vector[number] }>();
      for (const memory of lexical) byId.set(memory.id, { ...byId.get(memory.id), lexical: memory });
      for (const memory of vector) byId.set(memory.id, { ...byId.get(memory.id), vector: memory });

      const recalled = [...byId.values()].map(({ lexical: lexicalMemory, vector: vectorMemory }) => {
        const memory = vectorMemory ?? lexicalMemory!;
        const lexicalScore = lexicalMemory?.score ?? 0;
        const vectorRankScore = vectorMemory?.score ?? 0;
        const vectorScore = vectorMemory?.vectorScore ?? vectorRankScore;
        const confidenceScore = memory.confidence * 0.1;
        const score = lexicalMemory && vectorMemory
          ? vectorRankScore * 0.65 + lexicalScore * 0.25 + confidenceScore
          : vectorMemory
            ? vectorRankScore * 0.85 + memory.confidence * 0.15
            : lexicalScore;
        return {
          ...memory,
          score: Number(Math.max(0, Math.min(1, score)).toFixed(4)),
          retrieval: lexicalMemory && vectorMemory ? "hybrid" as const : vectorMemory ? "vector" as const : "lexical" as const,
          lexicalScore: lexicalMemory ? Number(lexicalScore.toFixed(4)) : undefined,
          vectorScore: vectorMemory ? Number(vectorScore.toFixed(4)) : undefined
        };
      }).filter((memory) => memory.score >= 0.28)
        .sort((left, right) => right.score - left.score)
        .slice(0, limit);
      this.store.markAccessed(recalled.map((memory) => memory.id));
      return recalled;
    } catch (error) {
      this.suspendEmbeddings(error);
      const fallback = lexical.slice(0, limit);
      this.store.markAccessed(fallback.map((memory) => memory.id));
      return fallback;
    }
  }

  private async backfillMissingEmbeddings(userId: string): Promise<void> {
    await this.backfillEmbeddings(userId, 32);
  }

  private async indexMemory(memoryId: string, text: string): Promise<void> {
    if (!this.canUseEmbeddings()) return;
    try {
      const vector = await this.embeddings.embed(text);
      this.store.upsertEmbedding(
        memoryId,
        this.embeddings.model,
        vector,
        this.embeddings.contentHash(text),
        text
      );
    } catch (error) {
      this.suspendEmbeddings(error);
    }
  }

  private canUseEmbeddings(): boolean {
    return this.embeddings.isConfigured() && Date.now() >= this.embeddingRetryAfter;
  }

  private suspendEmbeddings(error: unknown): void {
    this.embeddingRetryAfter = Date.now() + 60_000;
    const now = Date.now();
    if (now - this.lastEmbeddingWarningAt >= 60_000) {
      console.warn(`[MemoryEmbedding] vector retrieval disabled for 60s: ${error instanceof Error ? error.message : String(error)}`);
      this.lastEmbeddingWarningAt = now;
    }
  }
}

export const memoryService = new MemoryService();
