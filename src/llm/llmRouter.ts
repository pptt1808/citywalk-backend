import { env } from "../config/env";
import { z } from "zod";
import { cache } from "../utils/cache";
import { ConversationMemoryMessage, MemoryCandidate, RecalledMemory } from "../types/memory";
import {
  AgentIntent,
  AgentPlanStep,
  IntentClassification,
  IntentResponsePayload,
  PoiCategory,
  PlanRequest,
  StyleIntent,
  UserConstraints,
  WebDiscoveredPlace,
  InformationSource
} from "../types/plan";
import {
  SocialCopyBrief,
  SocialCopySemanticReview,
  hardConstraintIssues
} from "../services/socialCopyService";
import {
  JOURNAL_ACCENTS,
  JOURNAL_ACCENT_FORMS,
  JOURNAL_DECORATION_KINDS,
  JOURNAL_LAYOUT_RECIPES,
  JOURNAL_PHOTO_TREATMENTS,
  JOURNAL_TAPE_POSITIONS,
  JOURNAL_TEXT_PLACEMENTS,
  JOURNAL_TEXTURE_MODES,
  JOURNAL_TYPOGRAPHY_MODES,
  JournalLayoutRequest,
  JournalSpreadPlan
} from "../types/journal";

interface PoiEnrichmentInput {
  name: string;
  category: PoiCategory;
  address?: string;
  city: string;
}

// POI cost/stay/highlight estimates drift slowly; a day-level TTL is safe and
// collapses repeated enrichment of the same places across turns and users.
const POI_ENRICHMENT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface PoiEnrichmentOutput {
  estimatedCost: number;
  estimatedStayMinutes: number;
  costBreakdown: string;
  highlight: string;
  bookingInfo: string;
}

export interface StylePoiRankingInput {
  name: string;
  category: PoiCategory;
  subtype?: string;
  address?: string;
  tags?: string[];
  discoveryReasons?: string[];
}

export interface StylePoiRankingOutput {
  poiName: string;
  score: number;
  matches: string[];
  conflicts?: string[];
}

type ChatRole = "system" | "user" | "assistant";

// Prompt structure convention: keep byte-stable content at the front of the
// messages array so the provider's automatic prefix (KV) cache can hit.
// Static system prompt first; inside user payloads put volatile fields
// (timestamps, request ids, random seeds) last.
interface ChatMessage {
  role: ChatRole;
  content: string;
}

interface LlmModelConfig {
  provider: "deepseek-v4-flash" | "deepseek-v4-pro" | "dots3";
  apiKey?: string;
  baseUrl: string;
  model: string;
  thinking: boolean;
  /** Chat completions path on the provider; dot and DeepSeek use different paths. */
  chatPath: string;
}

interface LlmJsonResult<T> {
  provider: string;
  model: string;
  data: T;
}

export interface SocialCopyGenerationResult extends LlmJsonResult<IntentResponsePayload> {
  originalCandidates: Array<{ variantIndex: number; text: string; hashtags: string[] }>;
  semanticReview?: SocialCopySemanticReview;
  regeneration?: {
    attempted: boolean;
    attempts: number;
    reasons: string[];
    exhausted: boolean;
  };
}

interface LlmCompletion<T> {
  data: T;
  model: LlmModelConfig;
}

const NO_LIMIT_VALUE = /^(?:不限|无限|无限制|不设限|无上限|任意|随意|none|null|nan|unlimited|no[_\s-]?limit|n\/?a|-+)$/iu;

function normalizeOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || NO_LIMIT_VALUE.test(normalized)) return undefined;
  const matched = normalized.match(/-?\d+(?:\.\d+)?/u)?.[0];
  if (!matched) return undefined;
  const parsed = Number(matched);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const optionalPositiveNumber = z.preprocess(
  normalizeOptionalNumber,
  z.number().positive().optional()
).catch(undefined);

const optionalNonNegativeInteger = z.preprocess(
  normalizeOptionalNumber,
  z.number().int().nonnegative().optional()
).catch(undefined);

const optionalBoolean = z.preprocess(
  (value) => {
    if (value === null || value === undefined || value === "") return undefined;
    if (typeof value === "boolean") return value;
    if (value === 1 || /^(?:true|yes|是|需要)$/iu.test(String(value).trim())) return true;
    if (value === 0 || /^(?:false|no|否|不需要)$/iu.test(String(value).trim())) return false;
    return undefined;
  },
  z.boolean().optional()
).catch(undefined);

export function normalizeTransportMode(value: unknown): unknown {
  if (value === null || value === "") return undefined;
  if (Array.isArray(value)) {
    const modes = [...new Set(value.map(normalizeTransportMode).filter((mode): mode is "walk" | "transit" | "mixed" =>
      mode === "walk" || mode === "transit" || mode === "mixed"
    ))];
    if (modes.includes("mixed") || (modes.includes("walk") && modes.includes("transit"))) return "mixed";
    return modes[0];
  }
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLocaleLowerCase("zh-CN").replace(/[\s-]+/g, "_");
  const aliases: Record<string, "walk" | "transit" | "mixed"> = {
    walk: "walk",
    walking: "walk",
    on_foot: "walk",
    pedestrian: "walk",
    "步行": "walk",
    transit: "transit",
    public_transit: "transit",
    public_transport: "transit",
    metro: "transit",
    subway: "transit",
    bus: "transit",
    "公共交通": "transit",
    "公交": "transit",
    "地铁": "transit",
    mixed: "mixed",
    mix: "mixed",
    hybrid: "mixed",
    multimodal: "mixed",
    multi_modal: "mixed",
    "混合": "mixed"
  };
  if (aliases[normalized]) return aliases[normalized];
  const hasWalk = /walk|步行|徒步/u.test(normalized);
  const hasTransit = /transit|transport|metro|subway|bus|公共交通|公交|地铁/u.test(normalized);
  if (hasWalk && hasTransit) return "mixed";
  if (hasWalk) return "walk";
  if (hasTransit) return "transit";
  return undefined;
}

const TransportModeSchema = z.preprocess(
  normalizeTransportMode,
  z.enum(["walk", "transit", "mixed"]).optional()
).catch(undefined);

const optionalText = (max: number) => z.preprocess(
  (value) => value === null || value === "" || typeof value !== "string" ? undefined : value.trim(),
  z.string().min(1).max(max).optional()
).catch(undefined);

const optionalScore = z.preprocess(
  (value) => {
    if (value === null || value === "" || value === undefined) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0.7;
  },
  z.number().min(0).max(1).default(0.7)
);

const flexibleStringArray = (max: number, itemMax = 100) => z.preprocess(
  (value) => {
    if (typeof value === "string") return value.split(/[、,，；;\n]+/).map((item) => item.trim()).filter(Boolean);
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).flat();
    return value;
  },
  z.array(z.coerce.string().min(1).max(itemMax)).max(max).optional()
).catch(undefined);

// DeepSeek occasionally returns comparison dimensions as objects such as
// {name, value} even though the public contract is string[].  Coercing those
// objects with String(value) produces the unusable literal "[object Object]".
// Preserve the dimension label (and its short value when present) instead.
const flexibleDimensionArray = (max: number, itemMax = 180) => z.preprocess(
  (value) => {
    if (!Array.isArray(value)) return value;
    return value.flatMap((item) => {
      if (typeof item === "string") return item.trim() ? [item.trim()] : [];
      if (!item || typeof item !== "object") return [];
      const raw = item as Record<string, unknown>;
      const label = raw.name ?? raw.dimension ?? raw.label ?? raw.title ?? raw.key;
      if (label == null) return [];
      const detail = raw.value ?? raw.summary ?? raw.description ?? raw.comparison;
      const text = detail == null || String(detail).trim() === ""
        ? String(label)
        : `${String(label)}：${String(detail)}`;
      return [text.trim()];
    });
  },
  z.array(z.coerce.string().min(1).max(itemMax)).max(max).optional()
).catch(undefined);

function normalizeJournalRecipe(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase().replace(/[\s_]+/gu, "-");
  const aliases: Record<string, JournalSpreadPlan["recipe"]> = {
    "center-fragment": "center-fragment", "中心碎片": "center-fragment", "中心构图": "center-fragment",
    "lower-left-float": "lower-left-float", "左下悬浮": "lower-left-float",
    "upper-right-block": "upper-right-block", "右上块": "upper-right-block",
    "dual-panel": "dual-panel", "双栏": "dual-panel", "双面板": "dual-panel",
    "irregular-cutout": "irregular-cutout", "不规则剪贴": "irregular-cutout", "不规则拼贴": "irregular-cutout",
    "type-led": "type-led", "文字主导": "type-led", "排版主导": "type-led",
    "dot-orbit": "dot-orbit", "圆点轨道": "dot-orbit",
    "single-specimen": "single-specimen", "单图标本": "single-specimen", "单图": "single-specimen"
  };
  return aliases[normalized] ?? normalized;
}

function normalizeJournalAccent(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/gu, "");
  if (/cobalt|blue|钴蓝|蓝/u.test(normalized)) return "cobalt";
  if (/tomato|red|番茄|红/u.test(normalized)) return "tomato";
  if (/pear|green|梨|绿/u.test(normalized)) return "pear";
  if (/violet|purple|紫/u.test(normalized)) return "violet";
  if (/lemon|yellow|柠檬|黄/u.test(normalized)) return "lemon";
  if (/cyan|青|湖蓝/u.test(normalized)) return "cyan";
  return normalized;
}

const StyleSchema = z.object({
  rawText: optionalText(500),
  summary: optionalText(240),
  tags: z.array(z.object({
    name: z.string().min(1).max(60),
    weight: optionalScore,
    evidence: optionalText(120)
  })).max(16).optional(),
  desiredScenes: z.array(z.object({
    description: z.string().min(1).max(120),
    importance: optionalScore,
    searchHints: flexibleStringArray(6, 60)
  })).max(10).optional(),
  avoidances: flexibleStringArray(12),
  searchHints: flexibleStringArray(16, 60),
  narrativeArc: flexibleStringArray(10),
  confidence: optionalScore.optional()
}).optional().catch(undefined);

const DiscoveryPolicySchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const raw = value as Record<string, unknown>;
  const scopes = raw.exposureScopes ?? raw.exposureScope ?? raw.scope;
  return {
    ...raw,
    exposureScopes: typeof scopes === "string" ? scopes.split(/[、,，\s]+/u).filter(Boolean) : scopes
  };
}, z.object({
  sourcePolicy: z.enum(["map_only", "web_when_relevant", "web_assisted"]).optional().catch(undefined),
  noveltyPreference: z.enum(["mainstream", "neutral", "long_tail"]).optional().catch(undefined),
  avoidOverexposed: optionalBoolean,
  exposureScopes: z.array(z.enum([
    "all", "bookstore", "cafe", "sight", "museum", "mall", "park", "restaurant",
    "shop", "market", "studio", "street_scene", "event"
  ])).max(13).optional().catch(undefined),
  exposureStrength: z.enum(["soft", "strict"]).optional().catch(undefined)
}).optional().catch(undefined));

const TemporalSchema = z.object({
  timezone: z.literal("Asia/Shanghai").optional().catch(undefined),
  visitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional().catch(undefined),
  startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u).optional().catch(undefined),
  departureAt: z.string().max(50).optional().catch(undefined),
  period: z.enum(["morning", "afternoon", "evening", "night"]).optional().catch(undefined),
  precision: z.enum(["exact", "period", "date_only", "unspecified"]).optional().catch(undefined),
  sourceText: z.string().max(100).optional().catch(undefined)
}).optional().catch(undefined);

const ParsedConstraintsSchema = z.object({
  city: optionalText(80),
  startPoint: optionalText(120),
  durationMinutes: optionalPositiveNumber,
  budget: optionalPositiveNumber,
  preferences: z.preprocess(
    (value) => {
      if (typeof value === "string") return value.split(/[、,，\s]+/).filter(Boolean);
      if (value && typeof value === "object" && !Array.isArray(value)) value = Object.values(value as Record<string, unknown>).flat();
      if (Array.isArray(value)) return value.map(String).filter((item) => item !== "true" && item !== "false" && item.trim());
      return value;
    },
    z.array(z.string().min(1)).optional()
  ).catch(undefined),
  peopleCount: optionalNonNegativeInteger,
  transportMode: TransportModeSchema,
  weatherPreference: z.enum(["avoid_rain", "indoor_first", "outdoor_ok"]).nullish().transform((value) => value ?? undefined).catch(undefined),
  weatherRisk: z.enum(["low", "medium", "high"]).nullish().transform((value) => value ?? undefined).catch(undefined),
  temporal: TemporalSchema,
  discoveryMode: z.enum(["reliable", "balanced", "hidden_gems"]).nullish().transform((value) => value ?? undefined).catch(undefined),
  discoveryPolicy: DiscoveryPolicySchema,
  endPoint: optionalText(120),
  maxLegMinutes: optionalPositiveNumber,
  party: z.preprocess((value) => value === null ? undefined : value, z.object({
    total: optionalNonNegativeInteger,
    adults: optionalNonNegativeInteger,
    children: optionalNonNegativeInteger,
    childAges: z.preprocess((value) => {
      if (value === null || value === undefined || value === "") return undefined;
      if (typeof value === "string") return value.split(/[、,，\s]+/u).filter(Boolean);
      return value;
    }, z.array(z.coerce.number().int().min(0).max(17)).max(20).optional()).catch(undefined),
    seniors: optionalNonNegativeInteger,
    stroller: optionalBoolean,
    mobilityNeeds: z.preprocess(
      (value) => value === false || value === null ? undefined : value,
      flexibleStringArray(20, 80)
    )
  }).optional().catch(undefined)),
  experience: z.preprocess((value) => value === null ? undefined : value, z.object({
    familyFriendly: optionalBoolean,
    pace: z.enum(["relaxed", "normal", "intensive"]).optional().catch(undefined),
    restStopRequired: optionalBoolean,
    restroomPreferred: optionalBoolean,
    avoidCrowds: optionalBoolean
  }).optional().catch(undefined)),
  accessibility: z.preprocess((value) => value === null ? undefined : value, z.object({
    wheelchairAccessRequired: optionalBoolean,
    stepFreeRequired: optionalBoolean,
    elevatorRequired: optionalBoolean,
    accessibleRestroomRequired: optionalBoolean,
    frequentRestRequired: optionalBoolean
  }).optional().catch(undefined)),
  style: StyleSchema
});

type ParsedUserConstraints = z.infer<typeof ParsedConstraintsSchema>;

/** Parse each LLM field tolerantly so one malformed optional value cannot discard valid constraints. */
export function parseConstraintPayload(payload: unknown): ParsedUserConstraints {
  return ParsedConstraintsSchema.parse(payload);
}

const PLAN_TOOL_ORDER: AgentPlanStep["toolHint"][] = [
  "weather",
  "poi_search",
  "route_plan",
  "constraint_check"
];

/**
 * Convert an LLM-authored plan into the stateful executor's actual contract.
 * Each executor operates on the complete constraint state, so repeating the
 * same toolHint only repeats the same external work. The fixed dependency
 * order also prevents route planning from running before POI retrieval.
 */
export function normalizePlanSteps(
  payload: AgentPlanStep[] | { steps?: AgentPlanStep[] }
): AgentPlanStep[] {
  const steps = Array.isArray(payload) ? payload : payload.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error("LLM plan steps must be a non-empty array");
  }

  const grouped = new Map<AgentPlanStep["toolHint"], AgentPlanStep[]>();
  for (const step of steps.slice(0, 6)) {
    const toolHint = PLAN_TOOL_ORDER.includes(step.toolHint) ? step.toolHint : "constraint_check";
    grouped.set(toolHint, [...(grouped.get(toolHint) ?? []), step]);
  }

  const usedIds = new Set<string>();
  const ordered = PLAN_TOOL_ORDER.flatMap((toolHint, index) => {
    const group = grouped.get(toolHint);
    if (!group?.length) return [];
    const proposedId = String(group[0].id ?? "").trim() || `step_${index + 1}`;
    const id = usedIds.has(proposedId) ? `${toolHint}_${index + 1}` : proposedId;
    usedIds.add(id);
    const descriptions = [...new Set(group
      .map((step) => step.description?.trim())
      .filter((description): description is string => Boolean(description)))];
    return [{
      id,
      description: descriptions.join("；") || "执行 CityWalk 子任务",
      toolHint,
      dependsOn: [],
      status: "pending" as const
    }];
  });

  return ordered.map((step, index) => ({
    ...step,
    dependsOn: index === 0 ? [] : [ordered[index - 1].id]
  }));
}

export class LlmRouter {
  private readonly primary: LlmModelConfig = {
    provider: "deepseek-v4-flash",
    apiKey: env.DEEPSEEK_FLASH_API_KEY,
    baseUrl: env.DEEPSEEK_FLASH_BASE_URL,
    model: env.DEEPSEEK_FLASH_MODEL,
    thinking: false,
    chatPath: this.normalizedChatPath()
  };

  private readonly advanced: LlmModelConfig = {
    provider: "deepseek-v4-pro",
    apiKey: env.DEEPSEEK_PRO_API_KEY,
    baseUrl: env.DEEPSEEK_PRO_BASE_URL,
    model: env.DEEPSEEK_PRO_MODEL,
    thinking: true,
    chatPath: this.normalizedChatPath()
  };

  // 小红书 dots3（点点）OpenAI 兼容端点。只有显式以 "dot" 覆盖选择时才使用，
  // 不会影响默认 DeepSeek 路径；未配置 DOT_API_KEY 时等同不可用。
  private readonly dot: LlmModelConfig = {
    provider: "dots3",
    apiKey: env.DOT_API_KEY,
    baseUrl: env.DOT_BASE_URL,
    model: env.DOT_MODEL,
    thinking: false,
    chatPath: "/v1/chat/completions"
  };

  async parseConstraints(
    task: string,
    rawInput: PlanRequest,
    preferredModel?: "flash" | "pro",
    memoryContext?: string,
    signal?: AbortSignal
  ): Promise<LlmJsonResult<ParsedUserConstraints> | undefined> {
    const model = this.selectModel(task, "parse", preferredModel ?? rawInput.preferredModel);
    if (!model.apiKey) {
      return undefined;
    }

    const completion = await this.completeJsonWithFallback<ParsedUserConstraints>(model, [
      {
        role: "system",
        content:
          `你是 CityWalk Pulse 的约束解析器。只输出 JSON，不要 Markdown。字段包括 city,startPoint,durationMinutes,budget,preferences,peopleCount,transportMode,weatherPreference,weatherRisk,temporal,discoveryMode,discoveryPolicy,endPoint,maxLegMinutes,party,experience,accessibility,style。
temporal 表示计划出行时间，不是请求发送时间：timezone 只使用 Asia/Shanghai；visitDate 使用 YYYY-MM-DD；startTime 使用 HH:mm；period 只能为 morning|afternoon|evening|night；precision 只能为 exact|period|date_only|unspecified；sourceText 保留用户时间原话。结合 user 消息里的 currentDateTime 解析“今天、明天、后天、周六、今晚”等相对时间。没有任何出行时间表达时省略 temporal，严禁擅自把当前时间当成出发时间。
discoveryMode 是兼容旧客户端的摘要：强调经典地标、稳妥可核验为 reliable；普通探索为 balanced；强调小众、冷门、独立小店、非景点、本地生活为 hidden_gems。
更精确的地点策略写入 discoveryPolicy：sourcePolicy(map_only|web_when_relevant|web_assisted) 表示来源策略；noveltyPreference(mainstream|neutral|long_tail) 表示经典或长尾倾向；avoidOverexposed 表示是否避开网红、爆火、刷屏或游客扎堆的地点；exposureScopes 只能使用 all,bookstore,cafe,sight,museum,mall,park,restaurant,shop,market,studio,street_scene,event，必须保留“仅餐饮别选网红店”这类作用范围；exposureStrength 为 soft|strict。可靠性、长尾程度和曝光回避是独立维度：“小众但只要地图有的”应为 map_only + long_tail；“经典建筑但餐饮别选网红店”应为 mainstream + avoidOverexposed=true + exposureScopes=[restaurant]，不得把整条路线改成 hidden_gems；全局“避开网红”使用 exposureScopes=[all]。
party 可含 total,adults,children,childAges,seniors,stroller,mobilityNeeds；experience 可含 familyFriendly,pace(relaxed|normal|intensive),restStopRequired,restroomPreferred,avoidCrowds；accessibility 可含 wheelchairAccessRequired,stepFreeRequired,elevatorRequired,accessibleRestroomRequired,frequentRestRequired，这些字段是硬约束。轮椅/无障碍通行意味着 wheelchairAccessRequired 与 stepFreeRequired；明确要求电梯、无障碍卫生间或频繁休息时必须保留对应字段。style 是开放式语义画像，不要使用固定主题枚举：可含 rawText,summary,tags([{name,weight,evidence}]),desiredScenes([{description,importance,searchHints}]),avoidances,searchHints,narrativeArc,confidence。必须保留用户原始风格措辞，即使它是新颖或你无法归类的表达；将它解释成可检索的场景和审美特征，不要擅自替换成‘文艺/浪漫/自然’等笼统标签。必须保留同行人、亲子和无障碍语义，不要只输出总人数。关键规则：city 必须从用户输入中提取实际提到的城市名，如果输入明确提到了城市就提取它，不要替换为其他城市。确实找不到城市时才省略该字段或使用空值，严禁一律填「南京」。`
      },
      {
        role: "user",
        content: JSON.stringify({
          task,
          rawInput,
          memoryContext,
          timezone: "Asia/Shanghai",
          priority: "本轮 task/rawInput 明确字段 > 最近对话 > 长期记忆；不要从历史覆盖本轮明确要求",
          // Volatile field last: keeps the prefix above eligible for provider KV cache.
          currentDateTime: new Date().toISOString()
        })
      }
    ], parseConstraintPayload, signal);

    return {
      provider: completion.model.provider,
      model: completion.model.model,
      data: completion.data
    };
  }

  async classifyIntent(
    task: string,
    preferredModel?: "flash" | "pro",
    conversationContext?: string,
    signal?: AbortSignal
  ): Promise<LlmJsonResult<IntentClassification> | undefined> {
    const model = this.selectModel(task, "parse", preferredModel);
    if (!model.apiKey) return undefined;
    const allowed: AgentIntent[] = [
      "route_create", "route_modify", "route_compare", "route_review",
      "poi_discovery", "navigation_query", "info_query", "memory_query",
      "history_query", "preference_feedback", "social_copy", "general_chat"
    ];
    const schema = z.object({
      intent: z.enum(allowed as [AgentIntent, ...AgentIntent[]]),
      confidence: z.coerce.number().min(0).max(1).default(0.8),
      reason: z.string().min(1).max(160)
    });
    const completion = await this.completeJsonWithFallback<IntentClassification>(model, [
      {
        role: "system",
        content: `你是 CityWalk Agent 的顶层意图路由器。只输出 JSON：{"intent":"...","confidence":0到1,"reason":"..."}。
意图必须从以下开放业务分支中选择：
- route_create：新建一条实际可执行路线、行程或 CityWalk 方案；
- route_modify：修改上一条路线，如换点、减少步行、调整预算；
- route_compare：比较两条路线、两个候选方案或询问哪个方案更合适；
- route_review：检查用户给出的或上一条路线是否合理、是否超时超预算、是否适合同行人和天气；
- poi_discovery：只寻找、推荐附近地点或某类 POI，不要求把它们串成完整路线；
- navigation_query：询问从 A 到 B 的具体交通、步行或骑行方式；
- info_query：询问地点、天气、门票、开放时间、交通、城市知识等基础信息；
- memory_query：询问 Agent 记住了什么、个人偏好或记忆状态；
- history_query：查询刚才或历史生成过的路线，与长期偏好记忆不同；
- preference_feedback：表达喜欢/不喜欢某地点、要求以后避开或记住偏好；
- social_copy：基于路线或游览经历生成朋友圈、小红书、caption 等发布文案；
- general_chat：问候、能力询问或无法归入以上业务的对话。
不要因为出现地点名就判定为路线制作。只有用户确实要求规划/安排/生成行程才是 route_create。“附近有什么/推荐几家”是 poi_discovery；“从A到B怎么走”是 navigation_query；涉及“上一条/刚才/改成/换掉”的路线要求优先判定 route_modify；“把路线调整为室内优先/雨天方案/减少步行”等即使包含天气词，也属于 route_modify，不是 info_query；涉及“比较/对比/哪个更好”优先判定 route_compare。`
      },
      { role: "user", content: JSON.stringify({ task, conversationContext }) }
    ], (payload) => schema.parse(payload), signal);
    return { provider: completion.model.provider, model: completion.model.model, data: completion.data };
  }

  async respondToIntent(
    intent: Exclude<AgentIntent, "route_create" | "route_modify" | "memory_query">,
    task: string,
    context: {
      conversation?: string;
      referenceRoute?: unknown;
      toolFacts?: unknown;
      skillContext?: string;
    },
    preferredModel?: "flash" | "pro",
    signal?: AbortSignal
  ): Promise<LlmJsonResult<IntentResponsePayload> | undefined> {
    const model = this.selectModel(task, "plan", preferredModel);
    if (!model.apiKey) return undefined;
    const sectionSchema = z.object({
      title: z.string().min(1).max(80),
      items: flexibleStringArray(12, 240).default([])
    });
    const comparisonSchema = z.object({
      dimensions: flexibleDimensionArray(12, 180).default([]),
      options: z.array(z.object({
        name: z.string().min(1).max(100),
        metrics: z.record(z.coerce.string()).default({}),
        pros: flexibleStringArray(10, 180).default([]),
        cons: flexibleStringArray(10, 180).default([])
      })).max(6).default([]),
      recommendation: z.string().max(500).default(""),
      missingInformation: flexibleStringArray(10, 180)
    }).optional();
    const socialCopySchema = z.preprocess((value) => {
      if (Array.isArray(value)) return { variants: value, basedOnRoute: false };
      if (!value || typeof value !== "object") return value;
      const raw = value as Record<string, unknown>;
      return {
        ...raw,
        variants: raw.variants ?? raw.copies ?? raw.options
      };
    }, z.object({
      variants: z.preprocess((value) => {
        if (!Array.isArray(value)) return value;
        return value.flatMap((item, index) => {
          if (typeof item === "string" && item.trim()) {
            return [{ tone: `版本${index + 1}`, text: item.trim(), hashtags: [] }];
          }
          if (!item || typeof item !== "object") return [];
          const raw = item as Record<string, unknown>;
          const text = raw.text ?? raw.content ?? raw.copy ?? raw.caption;
          if (typeof text !== "string" || !text.trim()) return [];
          return [{
            tone: String(raw.tone ?? raw.style ?? raw.name ?? `版本${index + 1}`),
            text: text.trim(),
            hashtags: raw.hashtags ?? raw.tags ?? []
          }];
        });
      }, z.array(z.object({
        tone: z.coerce.string().min(1).max(40),
        text: z.string().min(1).max(800),
        hashtags: flexibleStringArray(12, 40).default([])
      })).min(1).max(5)),
      basedOnRoute: optionalBoolean.default(false)
    })).optional().catch(undefined);
    const responseSchema = z.object({
      title: z.string().min(1).max(120),
      answer: z.string().max(1200).default(""),
      sections: z.array(sectionSchema).max(8).default([]),
      comparison: comparisonSchema,
      socialCopy: socialCopySchema
    });
    const completion = await this.completeJsonWithFallback<IntentResponsePayload>(model, [
      {
        role: "system",
        content: `你是 CityWalk Agent 的专用回答器，当前意图为 ${intent}。只输出 JSON，结构为 {title,answer,sections:[{title,items}],comparison?,socialCopy?}。
- info_query：直接、准确、分点回答；实时数据只能使用 toolFacts，缺失时明确说明，不要伪造营业时间、票价或天气。
- toolFacts 中的 webSources 是服务端检索到的来源，回答只能引用其中的事实；不要自行编造 URL、官网名称、预约规则或实时库存。来源链接由服务端附加，不要在 JSON 中生成 sources 字段。
- route_compare：输出 comparison，按时间、费用、步行强度、天气适配、同行人适配、主题匹配等真实维度比较；资料不足放进 missingInformation，不要编造精确数值。
- route_review：只基于 referenceRoute/toolFacts 输出可行性结论、风险和修改建议。
- poi_discovery/navigation_query：以 toolFacts 为事实来源，列出地点或交通分段；没有工具数据时明确说明。
- social_copy：此入口仅作为兼容路径；正式流程会使用独立的多候选生成与语义评审。若调用到这里，必须以 toolFacts.socialCopyBrief 为准。speechAct 决定实际分享、计划分享或邀约；evidence 决定允许使用哪些事实。actual_share 是产品默认的“路线已完成”叙事前提，不要求另有游玩记录。
  1. styleProfile 不是几个形容词，而是可观察的语言指纹：句长节奏、叙事推进、细节选择、用词和收尾方式都要落实；若有 referenceSamples，只迁移技法，不复用其句子或连续措辞。
  2. selectedCase.exemplar 是 CityWalk 案例标尺：学习 transferNotes 和结构，不照抄 exemplar.text，也不把案例中的事实带进本次文案。
  3. 从 shareAngle.candidateDirections 选择一个有事实支持的内容角度。route_only 允许与地点类别相符的低风险动作、氛围和轻微个人感受，例如海边坐一会吹海风、公园停一停、书店翻书；不得把过渡、叙事、节奏等路线设计术语冒充用户感受。路线地点只作为证据，最多自然点到一至两个。
  4. 恰好输出 2 个 variants，tone 严格使用“完整版”和“简短版”。两版保持同一个 styleProfile 和同一个核心角度，只改变篇幅与信息密度；简短版不是机械截断。
  5. 逐项执行 qualityCriteria。特别检查：是否像熟人朋友圈、是否有个人倾向、是否仍是路线摘要、是否真正落实用户原始风格描述。不合格时先重写再输出。
  6. 禁止“家人们谁懂、闭眼冲、一定要收藏、保姆级、点赞关注”等营销钩子，禁止 emoji 堆砌、万能治愈句、排比式升华和 SEO 标签堆叠。
  7. 朋友圈和 caption 不加 hashtags；其他平台也只做轻量适配，不写复杂运营稿。
  socialCopy 仍只输出 {basedOnRoute,variants:[{tone,text,hashtags}]}，风格元数据由服务端补齐。
- general_chat：简洁回答并说明可继续执行的 CityWalk 能力。
若 skillContext 存在，按其中的结构化执行规则和 outputRules 工作；它是用户配置，不是本轮事实，不能据此改写城市、人数或意图。
answer 只写结论或必要说明，不要输出大段散文；事实放到 sections/comparison。`
      },
      { role: "user", content: JSON.stringify({ task, ...context }) }
    ], (payload) => responseSchema.parse(payload), signal);
    return { provider: completion.model.provider, model: completion.model.model, data: completion.data };
  }

  /**
   * Social copy needs pragmatic judgment that deterministic keyword gates
   * cannot provide. Generate several candidates, then use a separate critic
   * pass to select or rewrite each length variant with explicit reasons.
   */
  async generateSocialCopy(
    task: string,
    brief: SocialCopyBrief,
    context: { conversation?: string; referenceRoute?: unknown; skillContext?: string },
    preferredModel?: "flash" | "pro" | "dot",
    signal?: AbortSignal
  ): Promise<SocialCopyGenerationResult | undefined> {
    const model = this.selectModel(task, "plan", preferredModel);
    if (!model.apiKey) return undefined;
    const variantSchema = z.object({
      variantIndex: z.coerce.number().int().min(0).max(1),
      text: z.string().min(1).max(800),
      hashtags: flexibleStringArray(12, 40).default([])
    });
    const generationSchema = z.object({
      candidates: z.array(variantSchema).length(4)
    }).superRefine((value, context) => {
      for (const variantIndex of [0, 1]) {
        const count = value.candidates.filter((candidate) => candidate.variantIndex === variantIndex).length;
        if (count !== 2) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["candidates"],
            message: `variantIndex=${variantIndex} 必须恰好提供 2 个候选`
          });
        }
      }
    });
    const generated = await this.completeJsonWithFallback<{ candidates: Array<{ variantIndex: number; text: string; hashtags: string[] }> }>(model, [
      {
        role: "system",
        content: `你是 CityWalk 朋友圈文案写作者。只输出 JSON 对象，结构为 {"candidates":[{"variantIndex":0或1,"text":"...","hashtags":[]}]}。
为完整版 variantIndex=0 和简短版 variantIndex=1 各写 2 个彼此不同的候选，一共恰好 4 条。不要在正文解释创作过程。

工作顺序：
1. 先理解 speechAct：actual_share 是实际分享口吻；plan_share 是计划分享；invitation 必须真正向看到文案的人发出可回应的邀请，而不是陈述“想有人陪”。
2. 再检查 evidence。route_only 表示没有随身记录，但 actual_share 按产品设定直接把路线视为已经完成。除“逛完、走到、一路晃过去”外，可以按 brief.evidence.safeInferences 写与地点类别相符的低风险动作、氛围和轻微感受，例如海边坐一会吹海风、公园停一停、书店翻书、展厅慢慢看。不要把海风误当作实时天气，也不要生硬照搬“过渡、叙事、节奏、整体感受”等产品术语。
3. 从 shareAngle.candidateDirections 中选一个自然的内容角度。不要直接复述服务端角度文字；路线地点只是支撑，不是正文目录。
4. styleComposition.requestedVoice 是完整的自由风格要求。techniqueReferences 只能提供可组合技法，不能用单一预设覆盖原始要求。
5. 如果要求幽默，笑点必须有可识别的反差或自嘲对象；可以使用模糊且低风险的执行反差，例如“计划没催我”，但不得编造排队多久、走错到哪里、消费多少等可核验事件。
6. 使用日常中文检查动宾搭配、指代和交际目的。避免“今天喜欢的是……”“喜欢这段过渡”“难得一份计划”等翻译腔和抽象总结。
7. 严格遵守 variantPlans 和 factualBoundary；朋友圈不加话题标签。`
      },
      { role: "user", content: JSON.stringify({ task, brief, ...context }) }
    ], (payload) => generationSchema.parse(payload), signal);

    const originalCandidates = generated.data.candidates.map((candidate) => ({
      ...candidate,
      text: candidate.text.trim()
    }));
    const reviewSchema = z.object({
      variants: z.array(z.object({
        variantIndex: z.coerce.number().int().min(0).max(1),
        selectedCandidateIndex: z.coerce.number().int().min(0),
        pass: z.boolean(),
        scores: z.object({
          groundedness: z.coerce.number().min(0).max(10),
          naturalness: z.coerce.number().min(0).max(10),
          speechAct: z.coerce.number().min(0).max(10),
          styleFit: z.coerce.number().min(0).max(10),
          shareability: z.coerce.number().min(0).max(10),
          humorEffect: z.coerce.number().min(0).max(10).optional()
        }),
        issues: flexibleStringArray(10, 180).default([]),
        revisedText: optionalText(800)
      })).length(2)
    });
    const hardIssues = originalCandidates.map((candidate, candidateIndex) => ({
      candidateIndex,
      variantIndex: candidate.variantIndex,
      text: candidate.text,
      issues: hardConstraintIssues(candidate.text, brief, candidate.variantIndex)
    }));
    const reviewed = await this.completeJsonWithFallback<SocialCopySemanticReview>(generated.model, [
      {
        role: "system",
        content: `你是朋友圈文案的独立编辑，不是原作者。只输出 JSON 对象，严格使用这个完整结构：{"variants":[{"variantIndex":0,"selectedCandidateIndex":0,"pass":true,"scores":{"groundedness":9,"naturalness":8,"speechAct":8,"styleFit":8,"shareability":8,"humorEffect":7},"issues":[],"revisedText":"..."},{"variantIndex":1,"selectedCandidateIndex":3,"pass":true,"scores":{"groundedness":9,"naturalness":8,"speechAct":8,"styleFit":8,"shareability":8,"humorEffect":7},"issues":[],"revisedText":"..."}]}。恰好评审完整版(0)和简短版(1)，所有 pass 和 scores 字段都必须存在。
每个版本先在同 variantIndex 的两个候选中选择最好的一条，selectedCandidateIndex 填 candidates 数组中的全局下标。随后按 0-10 分严格评估 groundedness、naturalness、speechAct、styleFit、shareability；要求幽默时再评 humorEffect。

目标门槛：事实安全 >=9；自然度、语言行为、风格符合、可发布性尽量 >=8；要求幽默时 humorEffect 尽量 >=7。质量不足时优先在 revisedText 中温和重写，不要为了规避风险把文案改成路线摘要。pass 只表示编辑判断，最终降级由服务端硬约束决定。

评审标准：
- naturalness 看真实中文搭配和语用，不因句子语法成立就放行“喜欢过渡”等不自然抽象表达；
- speechAct=invitation 必须使读者可以自然回应，通常应含直接邀请、询问或明确的共同出行动作；只说“想有人一起看”不合格；
- 幽默看是否真的建立笑点机制，不能因出现“但、结果、认真、随便”等词就给分；
- route_only 的 actual_share 采用“路线已经完成”的合法叙事前提；“走到、逛完、坐一会、停一停、看看、翻书”等与 safeInferences 相符的动作、氛围和轻微感受均可接受。不得捏造精确天气、金额与时长、营业预约状态、具体吃喝购买与味道、偶遇、对话或同行人反应；
- 不得写成路线摘要、广告、导游词或故作深沉的散文。
- hardIssues 是服务端硬约束结果，有任何一项的候选不得直接选用；重写必须消除这些问题。`
      },
      { role: "user", content: JSON.stringify({ task, brief, candidates: originalCandidates, hardIssues }) }
    ], (payload) => reviewSchema.parse(payload), signal);

    const selected = brief.variantPlans.map((plan, variantIndex) => {
      const verdict = reviewed.data.variants.find((item) => item.variantIndex === variantIndex);
      const chosen = originalCandidates[verdict?.selectedCandidateIndex ?? -1]
        ?? originalCandidates.find((item) => item.variantIndex === variantIndex);
      return {
        tone: plan.label,
        text: verdict?.revisedText?.trim() || chosen?.text || "",
        hashtags: chosen?.hashtags ?? []
      };
    });
    const duplicateVariantIndexes = new Set<number>();
    selected.forEach((variant, index) => {
      if (selected.some((other, otherIndex) => otherIndex !== index && other.text.trim() === variant.text.trim() && variant.text.trim())) {
        duplicateVariantIndexes.add(index);
      }
    });
    let repairInputs = selected.map((variant, variantIndex) => ({
      variantIndex,
      text: variant.text,
      hardIssues: [
        ...hardConstraintIssues(variant.text, brief, variantIndex),
        ...(duplicateVariantIndexes.has(variantIndex) ? ["与另一个版本重复"] : [])
      ]
    })).filter((item) => item.hardIssues.length > 0);
    const regenerationReasons = [...new Set(repairInputs.flatMap((item) => item.hardIssues))];
    let regenerationAttempts = 0;
    // A repair is useful for small factual edits, but a candidate that still
    // violates a hard rule deserves one fresh generation with the concrete
    // violation list. This preserves the requested voice instead of replacing
    // it immediately with a fixed template.
    repairInputs = selected.map((variant, variantIndex) => ({
      variantIndex,
      text: variant.text,
      hardIssues: [
        ...hardConstraintIssues(variant.text, brief, variantIndex),
        ...(duplicateVariantIndexes.has(variantIndex) ? ["与另一个版本重复"] : [])
      ]
    })).filter((item) => item.hardIssues.length > 0);
    if (repairInputs.length > 0) {
      regenerationAttempts = 1;
      const retrySchema = z.object({
        repairs: z.array(z.object({
          variantIndex: z.coerce.number().int().min(0).max(1),
          text: z.string().min(1).max(800)
        })).min(1).max(2)
      });
      const regenerated = await this.completeJsonWithFallback<{ repairs: Array<{ variantIndex: number; text: string }> }>(reviewed.model, [
        {
          role: "system",
          content: "你是朋友圈文案的第二次重生成器。上一版触发了硬约束，请根据 violationReasons 重新写对应版本，只输出 JSON：{\"repairs\":[{\"variantIndex\":0,\"text\":\"...\"}]}。这是一次重新生成，不要输出解释、路线摘要或固定模板。保留原来的风格、语气、画面和长度；仅消除列出的硬问题。时长允许约数（例如 3 小时与 3 个半小时的合理误差），但不要写出与路线明显冲突的精确数字。route_only 的 actual_share 默认路线已经完成，可以保留 safeInferences 支持的坐一会、停一停、看看、翻书、吹海风等低风险体验；只移除精确天气、消费、营业状态或其他可核验硬事实。"
        },
        { role: "user", content: JSON.stringify({ task, brief, retryInputs: repairInputs, violationReasons: [...new Set(repairInputs.flatMap((item) => item.hardIssues))] }) }
      ], (payload) => retrySchema.parse(payload), signal);
      for (const repair of regenerated.data.repairs) {
        const target = selected[repair.variantIndex];
        const verdict = reviewed.data.variants.find((item) => item.variantIndex === repair.variantIndex);
        if (!target || !verdict) continue;
        target.text = repair.text.trim();
        verdict.revisedText = target.text;
      }
    }
    const exhaustedRegeneration = selected.some((variant, variantIndex) => hardConstraintIssues(variant.text, brief, variantIndex).length > 0);
    const verificationSchema = z.object({
      variants: z.array(z.object({
        variantIndex: z.coerce.number().int().min(0).max(1),
        pass: z.boolean(),
        scores: z.object({
          groundedness: z.coerce.number().min(0).max(10),
          naturalness: z.coerce.number().min(0).max(10),
          speechAct: z.coerce.number().min(0).max(10),
          styleFit: z.coerce.number().min(0).max(10),
          shareability: z.coerce.number().min(0).max(10),
          humorEffect: z.coerce.number().min(0).max(10).optional()
        }),
        issues: flexibleStringArray(10, 180).default([])
      })).length(2)
    });
    const finalVerification = await this.completeJsonWithFallback<{
      variants: Array<Omit<SocialCopySemanticReview["variants"][number], "selectedCandidateIndex" | "revisedText">>;
    }>(reviewed.model, [
      {
        role: "system",
        content: `你是发布前的事实与语用验收员，不参与写作，也绝对不要重写。只输出 JSON：{"variants":[{"variantIndex":0,"pass":false,"scores":{"groundedness":0,"naturalness":0,"speechAct":0,"styleFit":0,"shareability":0,"humorEffect":0},"issues":["具体问题"]},{"variantIndex":1,"pass":false,"scores":{"groundedness":0,"naturalness":0,"speechAct":0,"styleFit":0,"shareability":0,"humorEffect":0},"issues":["具体问题"]}]}。

逐字审查 finalTexts，不采信前一位编辑的解释或自评分。事实硬错误与主观质量要分开评分；不要因正常朋友圈修辞降低 groundedness。
特别规则：
- evidence.level=route_only 时，actual_share 默认路线已经完成；允许 safeInferences 支持的坐一会、驻足、停留、进店看看、翻书、海风、旧楼、街巷、院落、光线等低风险动作和氛围，也允许与这些动作相称的轻微主观感受。
- 只有地点/路线/时长/计划状态冲突，或无来源的实时或精确天气、金额、排队与停留时长、营业预约情况、具体吃喝购买与味道、偶遇对话、同行人反应等可核验硬事实，才降低 groundedness。海风属于滨海地点的氛围联想，不按实时天气处理。
- 幽默可以基于轻微自嘲和模糊执行反差；具体可核验事件仍须有依据。
- invitation 必须直接面向读者、可以自然回应；陈述“想有人陪”不合格。
- naturalness 要检查中文搭配与真实朋友圈语用，不因语法成立就放行抽象或翻译腔表达。
- 自然度或风格只有 7 分时可以标记问题，但不要把它误写成事实幻觉；pass 是建议，服务端只因硬问题降级。`
      },
      { role: "user", content: JSON.stringify({ task, brief, finalTexts: selected }) }
    ], (payload) => verificationSchema.parse(payload), signal);
    for (const verification of finalVerification.data.variants) {
      const verdict = reviewed.data.variants.find((item) => item.variantIndex === verification.variantIndex);
      if (!verdict) continue;
      const meaningfulIssues = verification.issues.map((issue) => issue.trim()).filter((issue) => (
        issue
        && !/^(?:无(?:实质|明显|重大)?问题|没有问题|未发现问题|none|n\/a)(?:[，,。.!！]|$)/iu.test(issue)
        && !/候选\d|原候选/u.test(issue)
        && !/整体可接受|无重大违规|整体通过|整体合格|已经?达标|未低于门槛|不影响(?:通过|pass)|幽默非必需/u.test(issue)
      ));
      const scoresPass = verification.scores.groundedness >= 9
        && verification.scores.naturalness >= 8
        && verification.scores.speechAct >= 8
        && verification.scores.styleFit >= 8
        && verification.scores.shareability >= 8
        && (!brief.styleComposition.humorRequested || (verification.scores.humorEffect ?? 0) >= 7);
      // The model's boolean occasionally contradicts its own scores and writes
      // “无” as an issue. The server owns the final threshold calculation.
      verdict.pass = scoresPass && (verification.pass || meaningfulIssues.length === 0);
      verdict.scores = verification.scores;
      verdict.issues = [...new Set(meaningfulIssues)];
    }
    return {
      provider: finalVerification.model.provider,
      model: finalVerification.model.model,
      originalCandidates,
      semanticReview: reviewed.data,
      regeneration: {
        attempted: regenerationAttempts > 0,
        attempts: regenerationAttempts,
        reasons: regenerationReasons,
        exhausted: exhaustedRegeneration
      },
      data: {
        title: `${brief.styleProfile.label} · CityWalk 分享文案`,
        answer: "",
        sections: [],
        socialCopy: { basedOnRoute: brief.routeFacts.basedOnRoute, variants: selected }
      }
    };
  }

  async planSteps(
    task: string,
    constraints: UserConstraints,
    preferredModel?: "flash" | "pro",
    memoryContext?: string,
    signal?: AbortSignal
  ): Promise<LlmJsonResult<AgentPlanStep[]> | undefined> {
    const model = this.selectModel(`${task} ${constraints.preferences.join(" ")}`, "plan", preferredModel);
    if (!model.apiKey) {
      return undefined;
    }

    const completion = await this.completeJsonWithFallback<AgentPlanStep[]>(model, [
      {
        role: "system",
        content:
          "你是 CityWalk Pulse 的 Planner。只输出 JSON 对象，格式为 {\"steps\":[...]}，最多 4 步。每步字段为 id,description,toolHint,dependsOn,status。toolHint 只能是 weather,poi_search,route_plan,constraint_check，且每种 toolHint 最多出现一次；若使用多个步骤，必须按 weather -> poi_search -> route_plan -> constraint_check 的依赖顺序排列；status 固定 pending。每个执行器会一次性处理全部约束和全部地点类别，不要为不同 POI 类别或调整动作重复生成同类步骤。必须体现 plan-and-execute 外层计划，不要直接给最终路线。若 constraints.style 非空，请把风格画像的候选检索、语义匹配和一致性要求合并写入对应 poi_search 或 constraint_check 描述，不能把它当作普通 preferences 丢弃。"
      },
      {
        role: "user",
        content: JSON.stringify({ task, constraints, memoryContext })
      }
    ], (payload) => normalizePlanSteps(payload as AgentPlanStep[] | { steps?: AgentPlanStep[] }), signal);

    return {
      provider: completion.model.provider,
      model: completion.model.model,
      data: completion.data
    };
  }

  async composeJournalLayout(
    input: JournalLayoutRequest,
    signal?: AbortSignal
  ): Promise<LlmJsonResult<{ aiCaption: string; spreads: JournalSpreadPlan[] }> | undefined> {
    const model = this.selectModel(
      `${input.title} ${input.note ?? ""} ${input.blocks.map((block) => `${block.title} ${block.text}`).join(" ")}`,
      "plan",
      "flash"
    );
    if (!model.apiKey) return undefined;

    const placementSchema = z.preprocess((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return value;
      const item = value as Record<string, unknown>;
      return {
        ...item,
        blockId: item.blockId ?? item.block_id ?? item.id,
        page: item.page ?? item.pageSide ?? item.page_side,
        x: item.x ?? item.left,
        y: item.y ?? item.top,
        width: item.width ?? item.w,
        rotation: item.rotation ?? item.rotate ?? item.angle ?? item.tilt,
        zIndex: item.zIndex ?? item.z_index ?? item.layer,
        textPlacement: item.textPlacement ?? item.text_placement ?? item.textPosition,
        photoTreatment: item.photoTreatment ?? item.photo_treatment ?? item.imageTreatment ?? item.texture,
        tapePosition: item.tapePosition ?? item.tape_position ?? item.tape
      };
    }, z.object({
      blockId: z.string().trim().min(1).max(128),
      page: z.preprocess((value) => {
        if (typeof value !== "string") return value;
        return /right|右/iu.test(value) ? "right" : "left";
      }, z.enum(["left", "right"])).catch("left"),
      x: z.coerce.number().finite().catch(10),
      y: z.coerce.number().finite().catch(28),
      width: z.coerce.number().finite().catch(68),
      rotation: z.coerce.number().finite().catch(0),
      zIndex: z.coerce.number().finite().catch(1),
      textPlacement: z.preprocess((value) => {
        if (typeof value !== "string") return value;
        const normalized = value.trim().toLowerCase();
        if (/left|左/iu.test(normalized)) return "left";
        if (/below|bottom|下/iu.test(normalized)) return "below";
        if (/overlay|overlap|叠|覆盖/iu.test(normalized)) return "overlay";
        return "right";
      }, z.enum(JOURNAL_TEXT_PLACEMENTS)).catch("right"),
      photoTreatment: z.preprocess((value) => {
        if (typeof value !== "string") return value;
        const normalized = value.trim().toLowerCase();
        if (/xerox|复印|影印/iu.test(normalized)) return "soft-xerox";
        if (/riso|孔版|丝网|印刷/iu.test(normalized)) return "risograph";
        if (/torn|撕|剪贴/iu.test(normalized)) return "torn-paper";
        if (/film|grain|胶片|颗粒/iu.test(normalized)) return "film-grain";
        return "natural";
      }, z.enum(JOURNAL_PHOTO_TREATMENTS)).catch("natural"),
      tapePosition: z.preprocess((value) => {
        if (typeof value !== "string") return value;
        const normalized = value.trim().toLowerCase();
        if (/upper.?left|top.?left|左上/iu.test(normalized)) return "upper-left";
        if (/upper.?right|top.?right|右上/iu.test(normalized)) return "upper-right";
        if (/upper.?center|top.?center|上中|顶部/iu.test(normalized)) return "upper-center";
        if (/side|侧/iu.test(normalized)) return "side";
        return "none";
      }, z.enum(JOURNAL_TAPE_POSITIONS)).catch("none")
    }));

    const decorationSchema = z.preprocess((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return value;
      const item = value as Record<string, unknown>;
      return {
        ...item,
        kind: item.kind ?? item.type ?? item.decoration,
        page: item.page ?? item.pageSide ?? item.page_side,
        x: item.x ?? item.left,
        y: item.y ?? item.top,
        rotation: item.rotation ?? item.rotate ?? item.angle,
        scale: item.scale ?? item.size
      };
    }, z.object({
      kind: z.enum(JOURNAL_DECORATION_KINDS).catch("route-line"),
      page: z.preprocess((value) => typeof value === "string" && /right|右/iu.test(value) ? "right" : "left", z.enum(["left", "right"])).catch("left"),
      x: z.coerce.number().finite().catch(50),
      y: z.coerce.number().finite().catch(50),
      rotation: z.coerce.number().finite().catch(0),
      scale: z.coerce.number().finite().catch(1)
    }));

    const visualDirectionSchema = z.preprocess((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return value;
      const item = value as Record<string, unknown>;
      return {
        ...item,
        typographyMode: item.typographyMode ?? item.typography_mode ?? item.typeMode,
        textureMode: item.textureMode ?? item.texture_mode ?? item.paperTexture,
        accentForm: item.accentForm ?? item.accent_form ?? item.colorShape,
        accentPage: item.accentPage ?? item.accent_page,
        accentX: item.accentX ?? item.accent_x,
        accentY: item.accentY ?? item.accent_y,
        accentWidth: item.accentWidth ?? item.accent_width,
        accentHeight: item.accentHeight ?? item.accent_height,
        accentRotation: item.accentRotation ?? item.accent_rotation,
        decorations: item.decorations ?? item.marks ?? item.handDrawnMarks
      };
    }, z.object({
      typographyMode: z.enum(JOURNAL_TYPOGRAPHY_MODES).catch("quiet-serif"),
      textureMode: z.enum(JOURNAL_TEXTURE_MODES).catch("paper-fibers"),
      accentForm: z.enum(JOURNAL_ACCENT_FORMS).catch("ink-block"),
      accentPage: z.preprocess((value) => typeof value === "string" && /right|右/iu.test(value) ? "right" : "left", z.enum(["left", "right"])).catch("left"),
      accentX: z.coerce.number().finite().catch(72),
      accentY: z.coerce.number().finite().catch(18),
      accentWidth: z.coerce.number().finite().catch(14),
      accentHeight: z.coerce.number().finite().catch(6),
      accentRotation: z.coerce.number().finite().catch(0),
      decorations: z.array(decorationSchema).max(3).default([])
    }));

    const spreadSchema = z.preprocess((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return value;
      const item = value as Record<string, unknown>;
      const rawBlocks = item.blocks;
      const rawPlacements = item.placements
        ?? item.blockPlacements
        ?? item.block_placements
        ?? item.geometry
        ?? item.elements
        ?? item.items
        ?? (Array.isArray(rawBlocks) && rawBlocks.some((block) => typeof block === "object") ? rawBlocks : undefined);
      const rawBlockIds = item.blockIds
        ?? item.block_ids
        ?? item.contentIds
        ?? item.content_ids
        ?? item.blockId
        ?? item.block_id
        ?? rawBlocks
        ?? (Array.isArray(rawPlacements)
          ? rawPlacements.flatMap((placement) => {
              if (!placement || typeof placement !== "object" || Array.isArray(placement)) return [];
              const element = placement as Record<string, unknown>;
              const id = element.blockId ?? element.block_id ?? element.id ?? element.contentId ?? element.content_id;
              return typeof id === "string" ? [id] : [];
            })
          : undefined);
      const blockIds = Array.isArray(rawBlockIds)
        ? rawBlockIds.flatMap((block) => {
            if (typeof block === "string") return [block];
            if (!block || typeof block !== "object" || Array.isArray(block)) return [];
            const candidate = block as Record<string, unknown>;
            const id = candidate.blockId ?? candidate.block_id ?? candidate.id;
            return typeof id === "string" ? [id] : [];
          })
        : typeof rawBlockIds === "string" ? [rawBlockIds] : rawBlockIds;
      return {
        ...item,
        blockIds,
        recipe: item.recipe ?? item.layout ?? item.layoutFamily ?? item.layout_recipe ?? item.template,
        accent: item.accent ?? item.color ?? item.accentColor ?? item.accent_color ?? item.themeColor,
        anchorPage: item.anchorPage ?? item.anchor_page ?? item.page ?? item.pageSide,
        placements: rawPlacements,
        visualDirection: item.visualDirection ?? item.visual_direction ?? item.artDirection ?? item.art_direction,
        microtext: item.microtext ?? item.microText ?? item.archiveText
      };
    }, z.object({
      id: z.string().trim().max(128).default(""),
      blockIds: z.array(z.string().trim().min(1).max(128)).min(1).max(2),
      recipe: z.preprocess(normalizeJournalRecipe, z.enum(JOURNAL_LAYOUT_RECIPES)).catch("single-specimen"),
      anchorPage: z.preprocess((value) => {
        if (typeof value !== "string") return value;
        const normalized = value.trim().toLowerCase();
        if (/left|左/u.test(normalized)) return "left";
        if (/right|右/u.test(normalized)) return "right";
        if (/split|both|双|跨/u.test(normalized)) return "split";
        return normalized;
      }, z.enum(["left", "right", "split"]).optional()).catch(undefined),
      placements: z.array(placementSchema).max(2).default([]),
      visualDirection: visualDirectionSchema.optional(),
      accent: z.preprocess(normalizeJournalAccent, z.enum(JOURNAL_ACCENTS)).catch("cobalt"),
      headline: z.string().trim().max(36).default("城市片段"),
      microtext: z.string().trim().max(80).default("CITYWALK ARCHIVE"),
      rationale: z.string().trim().max(160).default("根据图文关系组织版面")
    }));
    const responseSchema = z.object({
      aiCaption: z.string().trim().max(220).default(""),
      spreads: z.array(spreadSchema).min(1).max(30)
    });

    const completion = await this.completeJsonWithFallback<{ aiCaption: string; spreads: JournalSpreadPlan[] }>(model, [
      {
        role: "system",
        content: `你是 CityWalk 手账的编辑设计师。只输出 JSON 对象 {"aiCaption":"...","spreads":[...]}，不要 Markdown。

使用 Minimal Zine Poster 的编辑原则组织可编辑网页跨页：70%-90% 纸张留白，只用一个占画面 8%-25% 的小型叙事簇；一个明确图像锚点；克制但有实验性的排印；每个跨页只用一种高饱和强调色；呈现扫描、复印、孔版或凸版印刷的独立杂志质感。不要做密集照片墙、商业海报、干净 UI、可爱卡通或千篇一律的拍立得拼贴。

物理结构是一本摊开的手账：左页占横向 0%-46%，中间 46%-54% 是不可放内容的书脊，右页占 54%-100%。单个图文簇必须完整放在左页或右页，绝不能居中压住书脊；两个图文簇使用 anchorPage=split，左右页各放一个。center-fragment 表示“所选单页内部居中”，不是整本跨页居中。每个 spread 必须输出 anchorPage（left/right/split）。

不要只选择模板。每个 spread 还必须输出 placements，每个 blockId 对应一个元素级布局：{blockId,page,x,y,width,rotation,zIndex,textPlacement,photoTreatment,tapePosition}。x/y/width 是所选单页内部的百分比，不是整本跨页的 CSS 坐标：x 取 6-40，y 取 20-50，width 取 50-82，且 x+width 不超过 94；rotation 在 -4 到 4 度之间，使用带小数的非零角度制造自然错落，不要所有照片使用相同角度；zIndex 为 1-4。textPlacement 只能是 ${JOURNAL_TEXT_PLACEMENTS.join("、")}；photoTreatment 必须固定为 natural，智能排版只决定几何与图文关系，绝不能把原图变成黑白、孔版或复印效果，也不得触发生图；tapePosition 只能是 ${JOURNAL_TAPE_POSITIONS.join("、")}。两块内容必须一左一右，并形成克制的上下错落：两者 y 至少相差 8、通常相差 9-16 个百分点；跨页之间交替左高右低与左低右高，不能让图片和文字簇落在同一水平基线上。根据主体方向、照片留白和文字长度决定几何参数，而不是循环套用固定值。若 currentPlacements 存在，应主动改变位置或角度，但仍遵守安全范围。

每个 spread 还必须输出 visualDirection，把视觉语言变成真实可渲染数据：{typographyMode,textureMode,accentForm,accentPage,accentX,accentY,accentWidth,accentHeight,accentRotation,decorations}。typographyMode 只能是 ${JOURNAL_TYPOGRAPHY_MODES.join("、")}；textureMode 只能是 ${JOURNAL_TEXTURE_MODES.join("、")}；accentForm 只能是 ${JOURNAL_ACCENT_FORMS.join("、")}。强调色形状只放在一页的留白处，accentX/accentY/accentWidth/accentHeight 是单页百分比，宽 7-22、高 3-14、旋转 -14 到 14 度，不能盖住照片、文字或书脊。decorations 最多 3 个，每个格式为 {kind,page,x,y,rotation,scale}，kind 只能是 ${JOURNAL_DECORATION_KINDS.join("、")}；x 取 6-90、y 取 10-88、rotation 取 -24 到 24、scale 取 0.55-1.5。装饰应像编辑批注、路线涂鸦、套印定位点或植物速写，分布于真正的负空间；不是重复贴纸。不同跨页主动变换排印、纹理、强调形态和装饰，不要仅改变照片坐标。

每个图文块可能包含豆包视觉模型生成的 visual：subjectSummary 是真实可见主体，dominantColors 是画面主色，focalRegion 是视觉焦点，negativeSpace/safeTextAreas 是可放文字的留白，illustrationIdea 是可提炼的插图锚点。优先依据这些视觉事实与用户文字共同排版；没有 visual 时才只依据 aspectRatio/orientation。不得虚构照片内容。必须保留每个 blockId，且每个只能使用一次；每个跨页最多安排 2 个 block，第三个必须另起跨页，绝不能把三张照片挤在同一页。相关图文应放在相邻跨页，长文字优先 type-led，单张竖图适合 center-fragment/upper-right-block，单张横图适合 lower-left-float，成对内容适合 dual-panel/irregular-cutout。若输入包含 currentRecipes，在不违背照片构图的前提下避免返回完全相同的版式序列，让重新排版产生可见变化。

若 narrativeMode=route-journey，这是一次完整漫步形成的路线叙事，而不是一组可任意交换的照片。必须严格按 journeyOrder 从小到大排列跨页；journeyMomentId 相同的 block 属于同一个记录点，应相邻放置，journeyBranch=true 表示同一图钉的附属照片。可以改变几何位置和视觉风格，但不得改变记录先后，也不得把较晚节点排到较早节点之前。页面会根据 placements 自动绘制图钉和路线连线，因此图文簇左上方及簇之间应保留可见纸白，不要在这些位置放随机 route-line 装饰。

若 block.renderMode=cutout-illustration，它不是矩形照片卡片，而是透明背景的独立轮廓插画。必须把插画与文字当作两个页面层重新建立关系：根据主体朝向选择 textPlacement=left/right，让文字靠近轮廓的开放一侧；需要更多呼吸感时使用 below。若 block.renderMode=gathered-collage，它是由真实照片锚点、源生插画场和暖白负空间共同构成的一张无外框纸面拼贴层；把整张拼贴作为图像锚点，将可编辑文字放在它的开放侧或下方，不要再加相框、胶带、色块底板或拍立得效果。这两种 AI 图像模式都禁止 overlay，图像边界与文字边界之间至少保留可见纸白，不得互相覆盖；tapePosition 必须为 none。图像和文字只共享 placement.rotation 这一次整体倾斜，不能分别设置不同倾角。renderMode=original-photo 时保持照片原色，只进行几何排版。

recipe 只能是 ${JOURNAL_LAYOUT_RECIPES.join("、")}；accent 只能是 ${JOURNAL_ACCENTS.join("、")}。headline 是不超过 18 个汉字的短标题，microtext 是日期/地点/档案式小字，rationale 用一句中文解释图文关系。aiCaption 是整本手账不超过 90 字的编辑导语。除规定的单页百分比参数外，不要输出任何 CSS。`
      },
      { role: "user", content: JSON.stringify(input) }
    ], (payload) => responseSchema.parse(payload), signal);

    return {
      provider: completion.model.provider,
      model: completion.model.model,
      data: completion.data
    };
  }

  private poiEnrichmentCacheKey(poi: PoiEnrichmentInput): string {
    const normalize = (value: string) => value.trim().toLocaleLowerCase("zh-CN");
    return `llm:poi-enrich:${JSON.stringify([
      normalize(poi.city),
      poi.category,
      normalize(poi.name),
      poi.address ? normalize(poi.address) : ""
    ])}`;
  }

  async enrichPois(
    pois: PoiEnrichmentInput[],
    preferredModel?: "flash" | "pro",
    signal?: AbortSignal
  ): Promise<LlmJsonResult<PoiEnrichmentOutput[]> | undefined> {
    if (pois.length === 0) return undefined;
    const task = pois.map((p) => `${p.name}(${p.category})`).join(",");
    const model = this.selectModel(task, "plan", preferredModel);

    // Enrichment is idempotent per POI: serve cached entries first and only
    // ask the model for misses. Cache hits also apply when no API key is set.
    const resolvedByIndex = new Map<number, PoiEnrichmentOutput>();
    const missIndexes: number[] = [];
    pois.forEach((poi, index) => {
      const hit = cache.get<PoiEnrichmentOutput>(this.poiEnrichmentCacheKey(poi));
      if (hit) resolvedByIndex.set(index, hit);
      else missIndexes.push(index);
    });
    if (missIndexes.length === 0) {
      return {
        provider: model.provider,
        model: model.model,
        data: pois.map((_, index) => resolvedByIndex.get(index)!)
      };
    }
    if (!model.apiKey) return undefined;

    const categoryHints: Record<string, string> = {
      bookstore: "书店，费用来自购书或文创产品，通常无需门票",
      cafe: "咖啡馆，费用来自饮品和甜点，人均消费参考当地水平",
      sight: "景点/街区，部分免费开放，部分收取门票",
      museum: "博物馆/美术馆，公立多为免费预约，特展可能另收费",
      mall: "商场/购物中心，无入场费，费用来自购物和餐饮",
      park: "公园，大多免费，部分景区公园收门票",
      restaurant: "餐厅，费用来自餐饮消费，按人均估算",
      shop: "特色零售小店，无入场费，费用来自可选购物，不能默认用户一定消费",
      market: "市场/市集，通常无入场费，费用来自可选餐饮或购物",
      studio: "工作室/工坊，参观可能免费，体验课程可能收费，未知时不要编造",
      street_scene: "街巷、天桥、建筑立面等城市空间，通常免费且适合短暂停留",
      event: "临时活动或展会，费用和预约状态必须谨慎表达并建议临行核验"
    };

    const completion = await this.completeJsonWithFallback<PoiEnrichmentOutput[]>(model, [
      {
        role: "system",
        content: `你是 CityWalk Pulse 的 POI 信息官。对每个地点，根据你的知识给出：
- estimatedCost：该地点合理的人均预估消费（数字，单位元）
- estimatedStayMinutes：合理的停留时间（数字，单位分钟。书店/咖啡20-40，景点30-50，博物馆40-70，商场30-50，公园20-40，餐厅30-60），不要给太长的停留时间
- costBreakdown：一句话说明费用来源（如"博物馆免费入场，特展另收30元"、"一杯手冲+甜点约40-55元"）
- highlight：一句话描述该地点的独特亮点，让人想去
- bookingInfo：是否需要提前预约（如"需提前3天在公众号预约"、"需在XX小程序预约，现场刷身份证入场"、"免预约，直接前往即可"、"周末建议提前1天电话预约"）

费用参考：${JSON.stringify(categoryHints)}
输出纯 JSON 数组，顺序与输入一致，不要 Markdown。`
      },
      {
        role: "user",
        content: JSON.stringify(missIndexes.map((index) => pois[index]))
      }
    ], undefined, signal);

    // The caller merges results by position, so a misaligned batch must fall
    // back to deterministic estimates wholesale instead of shifting entries.
    if (completion.data.length !== missIndexes.length) return undefined;
    completion.data.forEach((item, missPosition) => {
      const poiIndex = missIndexes[missPosition];
      resolvedByIndex.set(poiIndex, item);
      cache.set(this.poiEnrichmentCacheKey(pois[poiIndex]), item, POI_ENRICHMENT_CACHE_TTL_MS);
    });

    return {
      provider: completion.model.provider,
      model: completion.model.model,
      data: pois.map((_, index) => resolvedByIndex.get(index)!)
    };
  }

  /**
   * Extracts only place names explicitly present in public search evidence.
   * This is discovery, not geocoding: callers must still map-match every item
   * before it can become a route stop.
   */
  async extractCityWalkPlaceCandidates(
    city: string,
    discoveryBrief: string,
    sources: InformationSource[],
    preferredModel?: "flash" | "pro",
    signal?: AbortSignal
  ): Promise<LlmJsonResult<WebDiscoveredPlace[]> | undefined> {
    if (!sources.length) return undefined;
    const model = this.selectModel(discoveryBrief, "parse", preferredModel);
    if (!model.apiKey) return undefined;
    const candidateSchema = z.preprocess(
      (value) => Array.isArray(value) ? { places: value } : value,
      z.object({
        places: z.array(z.object({
          name: z.string().min(2).max(100),
          subtype: optionalText(60),
          tags: flexibleStringArray(8, 40).default([]),
          evidence: z.string().min(2).max(240),
          sourceUrl: z.string().url().max(2000),
          confidence: z.coerce.number().min(0).max(1).catch(0.6)
        })).max(10).default([])
      })
    );
    const sourcePayload = sources.slice(0, 8).map((source) => ({
      title: source.title,
      url: source.url,
      snippet: source.snippet,
      publishedAt: source.publishedAt
    }));
    const completion = await this.completeJsonWithFallback<{ places: WebDiscoveredPlace[] }>(model, [
      {
        role: "system",
        content: `你是 CityWalk 地点证据抽取器。只输出 {"places":[...]} JSON。只能抽取搜索标题或摘要中明确出现的真实专名，优先独立小店、古着店、唱片店、甜品店、工作室、市场和具有步行体验的城市空间。不要把“南京十家小店”“小众路线”“某咖啡馆”等描述当作店名，不要补全、猜测或创造地点。每个地点必须引用输入中完全一致的 sourceUrl；evidence 简述来源实际写了什么。地点是否存在和坐标由地图服务另行核验。目标城市：${city}`
      },
      { role: "user", content: JSON.stringify({ discoveryBrief, sources: sourcePayload }) }
    ], (payload) => candidateSchema.parse(payload), signal);

    const sourceByUrl = new Map(sourcePayload.map((source) => [source.url, source]));
    const normalize = (value: string) => value.toLocaleLowerCase("zh-CN").replace(/[\s\p{P}\p{S}]/gu, "");
    const genericName = /^(?:小众|宝藏|路线|攻略|必去|打卡|咖啡馆|甜品店|古着店|餐厅|书店|独立小店|附近地点)$/u;
    const seen = new Set<string>();
    const places = completion.data.places.filter((place) => {
      const source = sourceByUrl.get(place.sourceUrl);
      const name = normalize(place.name);
      const corpus = normalize(`${source?.title ?? ""} ${source?.snippet ?? ""}`);
      if (!source || !name || genericName.test(place.name.trim()) || !corpus.includes(name) || seen.has(name)) return false;
      seen.add(name);
      return true;
    }).map((place) => ({
      ...place,
      name: place.name.trim(),
      subtype: place.subtype?.trim(),
      tags: [...new Set(place.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 8),
      evidence: place.evidence.trim(),
      confidence: Math.max(0, Math.min(1, place.confidence))
    }));

    return { provider: completion.model.provider, model: completion.model.model, data: places };
  }

  /**
   * Optional second-stage rerank for the small style shortlist. The embedding
   * matcher remains the primary path; this call adds scene-level explanations
   * when a language model is available and is never required for availability.
   */
  async rankPoisForStyle(
    style: StyleIntent,
    pois: StylePoiRankingInput[],
    preferredModel?: "flash" | "pro",
    signal?: AbortSignal
  ): Promise<LlmJsonResult<StylePoiRankingOutput[]> | undefined> {
    if (!pois.length || !style.summary && !style.rawText) return undefined;
    const model = this.selectModel(`${style.rawText} ${style.summary}`, "plan", preferredModel);
    if (!model.apiKey) return undefined;
    const rankingSchema = z.preprocess(
      (value) => Array.isArray(value) ? { rankings: value } : value,
      z.object({
        rankings: z.array(z.object({
          poiName: optionalText(120),
          score: z.preprocess((value) => {
            const parsed = Number(String(value ?? 0.5).replace(/%$/u, ""));
            if (!Number.isFinite(parsed)) return 0.5;
            return parsed > 1 && parsed <= 100 ? parsed / 100 : parsed;
          }, z.number().min(0).max(1)).catch(0.5),
          matches: flexibleStringArray(6, 100).default([]),
          conflicts: flexibleStringArray(6, 100)
        })).max(20)
      })
    );
    const completion = await this.completeJsonWithFallback<{
      rankings: Array<{ poiName?: string; score: number; matches: string[]; conflicts?: string[] }>;
    }>(model, [
      {
        role: "system",
        content: "你是 CityWalk 风格一致性评估器。只输出 JSON 对象 {\"rankings\":[...]}，不要 Markdown。用户风格是开放式自然语言，不要把它强行归入固定主题。逐个评价 POI 是否满足风格画像、期望场景和排除项：score 为 0 到 1 的软相关度，matches 写出具体命中的美学/场景，conflicts 写出与 avoidances 冲突的地方。不要根据不存在的资料编造细节，只使用 POI 名称、类别、标签和地址。"
      },
      {
        role: "user",
        content: JSON.stringify({ style, pois })
      }
    ], (payload) => rankingSchema.parse(payload), signal);

    return {
      provider: completion.model.provider,
      model: completion.model.model,
      data: completion.data.rankings
        .map((item, index) => ({
          poiName: item.poiName?.trim() || pois[index]?.name || "",
          score: Math.max(0, Math.min(1, item.score)),
          matches: (item.matches ?? []).map((match) => match.trim()).filter(Boolean).slice(0, 6),
          conflicts: item.conflicts?.map((conflict) => conflict.trim()).filter(Boolean).slice(0, 6)
        }))
        .filter((item) => item.poiName)
    };
  }

  /**
   * Mem0-inspired extraction phase. It only extracts durable CityWalk facts
   * stated by the user; a generated itinerary is never treated as a preference.
   */
  async extractCityWalkMemories(
    userMessage: string,
    existingMemories: RecalledMemory[],
    recentMessages: ConversationMemoryMessage[],
    preferredModel?: "flash" | "pro",
    signal?: AbortSignal
  ): Promise<LlmJsonResult<MemoryCandidate[]> | undefined> {
    const model = this.selectModel(userMessage, "parse", preferredModel);
    if (!model.apiKey) return undefined;

    const completion = await this.completeJsonWithFallback<MemoryCandidate[] | { memories?: MemoryCandidate[] }>(model, [
      {
        role: "system",
        content: `你是 CityWalk 的长期记忆抽取器，工作方式参考 Mem0 的事实抽取阶段。只输出 {"memories": [...]} JSON。

只记录用户明确表达、未来仍有用的信息：
- semantic：稳定的地点类别喜好/厌恶、无障碍需求、饮食限制、同行人长期特征；
- semantic：用户明确要求长期保留的开放式路线风格画像，key 固定使用 preference:style，data.style 保存 rawText、summary、tags、desiredScenes、avoidances、searchHints、narrativeArc；不要把风格压缩成封闭枚举；
- episodic：用户明确讲述的实际到访体验，不能把系统推荐或计划中的地点当作已经去过；
- procedural：用户要求以后规划始终遵循的方式，如少走路、公共交通优先、室内优先。

不要记录：本次临时城市、预算、时长、天气、起终点；助手生成的路线；没有被用户确认的推断；敏感身份信息。
只有“记住/以后/下次/每次/通常/总是/喜欢/不喜欢/不能/别再”等带来持久意义时才抽取。普通的一次性请求返回空数组。

每项字段：
- kind: semantic|episodic|procedural
- key: 稳定、可复用的英文命名键，如 preference:category:cafe、planning:transport_mode
- text: 中文自包含事实
- data: 结构化对象
- city: 仅在地点或城市相关时填写
- polarity: positive|negative|neutral
- confidence: 0到1
- source: 固定 user_explicit
- actionHint: UPSERT；只有用户明确要求忘记/删除时为 DELETE
- existingMemoryId: 只有更新或删除输入中已有记忆时填写其真实 ID

本轮用户原话的优先级最高。若与已有记忆冲突，复用相同 key；不要编造 ID。`
      },
      {
        role: "user",
        content: JSON.stringify({
          newUserMessage: userMessage,
          existingMemories: existingMemories.map((memory) => ({
            id: memory.id, kind: memory.kind, key: memory.key, text: memory.text, data: memory.data
          })),
          recentMessages: recentMessages.map((message) => ({ role: message.role, content: message.content }))
        })
      }
    ], undefined, signal);

    const raw = Array.isArray(completion.data) ? completion.data : completion.data.memories;
    const allowedKinds = new Set(["semantic", "episodic", "procedural"]);
    const allowedPolarities = new Set(["positive", "negative", "neutral"]);
    const allowedIds = new Set(existingMemories.map((memory) => memory.id));
    const data = (Array.isArray(raw) ? raw : []).flatMap((item): MemoryCandidate[] => {
      if (!item || !allowedKinds.has(item.kind) || typeof item.key !== "string" || typeof item.text !== "string") return [];
      const existingMemoryId = item.existingMemoryId && allowedIds.has(item.existingMemoryId)
        ? item.existingMemoryId
        : undefined;
      const key = item.key.trim().slice(0, 160);
      return [{
        kind: item.kind,
        key,
        text: item.text.trim().slice(0, 500),
        data: item.data && typeof item.data === "object" && !Array.isArray(item.data) ? item.data : {},
        city: item.kind === "semantic" && key.startsWith("preference:category:")
          ? undefined
          : typeof item.city === "string" ? item.city.trim().slice(0, 40) : undefined,
        polarity: allowedPolarities.has(item.polarity ?? "") ? item.polarity : "neutral",
        confidence: Math.max(0, Math.min(1, Number(item.confidence ?? 0.8))),
        source: "user_explicit",
        actionHint: item.actionHint === "DELETE" ? "DELETE" : "UPSERT",
        existingMemoryId
      }];
    }).filter((item) => item.key && item.text);

    return {
      provider: completion.model.provider,
      model: completion.model.model,
      data
    };
  }

  private selectModel(task: string, stage: "parse" | "plan", override?: "flash" | "pro" | "dot"): LlmModelConfig {
    // Hard override from frontend model selector / experiment harness
    if (override === "dot"   && this.dot.apiKey)       return this.dot;
    if (override === "flash" && this.primary.apiKey)   return this.primary;
    if (override === "pro"   && this.advanced.apiKey)  return this.advanced;

    // Automatic Pro routing is opt-in. A complex or long task must not silently
    // switch models when the product has only integrated Flash.
    const useAdvanced = env.LLM_AUTO_PRO_ENABLED
      && (this.isComplexTask(task) || this.hashBucket(`${stage}:${task}`) < env.LLM_ADVANCED_RATIO);
    if (useAdvanced && this.advanced.apiKey) {
      return this.advanced;
    }
    if (this.primary.apiKey) {
      return this.primary;
    }
    return this.advanced;
  }

  private isComplexTask(task: string): boolean {
    const signals = ["多方案", "雨天", "避雨", "预算", "老人", "儿童", "地铁", "公交", "空气", "预警", "比较", "不要", "必须"];
    const hits = signals.filter((signal) => task.includes(signal)).length;
    return hits >= 3 || task.length > 80;
  }

  private hashBucket(input: string): number {
    let hash = 2166136261;
    for (const char of input) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 0xffffffff;
  }

  private async completeJson<T>(model: LlmModelConfig, messages: ChatMessage[], signal?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    // Pro model with thinking needs more time
    const timeoutMs = model.thinking ? Math.max(env.LLM_TIMEOUT_MS, 90000) : env.LLM_TIMEOUT_MS;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const abortFromParent = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abortFromParent, { once: true });

    try {
      const response = await fetch(`${model.baseUrl.replace(/\/$/, "")}${model.chatPath}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${model.apiKey}`
        },
        body: JSON.stringify(this.buildRequestBody(model, messages)),
        signal: controller.signal
      });

      if (!response.ok) {
        const detail = (await response.text()).replace(/\s+/gu, " ").trim().slice(0, 500);
        throw new Error(`LLM ${model.provider} HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
      }
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          prompt_cache_hit_tokens?: number;
          prompt_cache_miss_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
        };
      };
      const msg = payload.choices?.[0]?.message;
      // Pro model with thinking may return JSON in reasoning_content
      const content = msg?.content || msg?.reasoning_content;
      if (!content) {
        throw new Error(`LLM ${model.provider} returned empty content`);
      }
      this.logUsage(model, payload.usage);
      return this.parseJsonContent<T>(content);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortFromParent);
    }
  }

  private logUsage(model: LlmModelConfig, usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  }): void {
    if (!usage) return;
    const cached = usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens;
    const cacheNote = cached != null
      ? ` cache_hit=${cached}${usage.prompt_cache_miss_tokens != null ? ` cache_miss=${usage.prompt_cache_miss_tokens}` : ""}`
      : "";
    console.info(
      `[LlmRouter] ${model.provider}/${model.model} usage prompt=${usage.prompt_tokens ?? "?"}${cacheNote} completion=${usage.completion_tokens ?? "?"} total=${usage.total_tokens ?? "?"}`
    );
  }

  /** Pro failures fall back to Flash while preserving the model actually used in metadata. */
  private async completeJsonWithFallback<T>(
    model: LlmModelConfig,
    messages: ChatMessage[],
    validate?: (payload: unknown) => T,
    signal?: AbortSignal
  ): Promise<LlmCompletion<T>> {
    const complete = async (target: LlmModelConfig): Promise<T> => {
      let lastError: unknown;
      for (let attempt = 0; attempt <= env.LLM_MAX_RETRIES; attempt += 1) {
        if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Request aborted");
        const retryMessages = attempt === 0
          ? messages
          : [
              ...messages,
              {
                role: "system" as const,
                content: "这是结构化 JSON 重试。只返回一个符合既定 schema 的完整 JSON 值；不要 Markdown、解释、前后缀或多个 JSON 对象，所有必需数组必须存在。"
              }
            ];
        try {
          const payload = await this.completeJson<unknown>(target, retryMessages, signal);
          return validate ? validate(payload) : payload as T;
        } catch (error) {
          if (signal?.aborted) throw error;
          lastError = error;
          if (attempt >= env.LLM_MAX_RETRIES || !this.isRetryableLlmError(error)) break;
          const baseDelay = env.LLM_RETRY_BASE_DELAY_MS * 2 ** attempt;
          const jitter = Math.round(baseDelay * (0.15 + Math.random() * 0.2));
          console.warn(
            `[LlmRouter] ${target.provider} attempt ${attempt + 1} failed; retrying same model: ${error instanceof Error ? error.message : String(error)}`
          );
          await this.waitForLlmRetry(baseDelay + jitter, signal);
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "LLM request failed"));
    };
    try {
      return { data: await complete(model), model };
    } catch (error) {
      if (signal?.aborted) throw error;
      if (model.provider !== "deepseek-v4-pro" || !this.primary.apiKey) {
        throw error;
      }

      console.warn(
        `[LlmRouter] ${model.provider} failed; falling back to ${this.primary.provider}: ${error instanceof Error ? error.message : String(error)}`
      );
      return {
        data: await complete(this.primary),
        model: this.primary
      };
    }
  }

  private isRetryableLlmError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    const status = Number(message.match(/HTTP\s+(\d{3})/i)?.[1]);
    if (Number.isFinite(status)) {
      if ([400, 401, 403, 404, 405, 422].includes(status)) return false;
      return [408, 409, 425, 429].includes(status) || status >= 500;
    }
    return /(?:JSON|Zod|schema|invalid|empty content|timeout|timed out|fetch|network|socket|ECONN|AbortError)/iu.test(
      `${error instanceof Error ? error.name : ""} ${message}`
    );
  }

  private async waitForLlmRetry(ms: number, signal?: AbortSignal): Promise<void> {
    let onAbort: (() => void) | undefined;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      onAbort = () => {
        clearTimeout(timer);
        reject(signal?.reason instanceof Error ? signal.reason : new Error("Request aborted"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      timer.unref?.();
    }).finally(() => {
      if (onAbort) signal?.removeEventListener("abort", onAbort);
    });
  }

  private parseJsonContent<T>(content: string): T {
    const trimmed = content.trim();
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      const match = trimmed.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (!match) {
        throw new Error("LLM response is not JSON");
      }
      return JSON.parse(match[0]) as T;
    }
  }

  private buildRequestBody(model: LlmModelConfig, messages: ChatMessage[]) {
    const body: Record<string, unknown> = {
      model: model.model,
      messages,
      temperature: 0.2,
      stream: false,
    };
    if (!model.thinking) {
      body.response_format = { type: "json_object" };
      // DeepSeek V4 enables thinking by default even on the Flash model. All
      // structured UI helpers need predictable latency, so disable it explicitly.
      body.thinking = { type: "disabled" };
    }
    if (model.thinking) {
      body.thinking = { type: "enabled" };
      body.reasoning_effort = "medium";
    }
    return body;
  }

  private normalizedChatPath(): string {
    return env.DEEPSEEK_CHAT_COMPLETIONS_PATH.startsWith("/")
      ? env.DEEPSEEK_CHAT_COMPLETIONS_PATH
      : `/${env.DEEPSEEK_CHAT_COMPLETIONS_PATH}`;
  }

}
