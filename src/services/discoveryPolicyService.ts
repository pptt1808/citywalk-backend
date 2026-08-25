import {
  PlaceDiscoveryMode,
  PlaceDiscoveryPolicy,
  PlaceDiscoveryPolicyInput,
  PlaceExposureScope,
  PoiCategory
} from "../types/plan";

const LONG_TAIL_CUE = /小众|冷门|宝藏|隐藏|独立小店|本地人|社区感|本地生活|非景点|避开景点|不要景点|古着|唱片店|买手店|主理人|旧货|二手店|城市肌理|烟火气/u;
const MAINSTREAM_CUE = /经典(?:建筑|地标|景点)|热门景点|必去|第一次去|代表性地标/u;
const MAP_ONLY_CUE = /只推荐地图有的|仅地图结果|地图可核验|不要网页来源|不使用网页|只用高德/u;
const OVEREXPOSURE_CUE = /网红|打卡(?:地|店|点)|(?:避开|不要|别选|排除).{0,8}(?:热门|打卡)|社交媒体.{0,6}(?:爆火|热门|刷屏)|平台.{0,4}(?:爆火|热门|刷屏)|爆火|刷屏|游客扎堆/u;
const ALLOW_OVEREXPOSURE_CUE = /(?:网红|打卡|热门).{0,5}(?:也可以|可以接受|没关系|不介意)|(?:不必|不用|无需|不需要|不要刻意|不|别).{0,5}(?:避开|排除).{0,4}(?:网红|打卡|热门)|可以(?:去|选|安排|接受)?.{0,5}(?:网红|打卡|热门)/u;
const STRICT_EXPOSURE_CUE = /绝对|完全|严格|坚决|一律|任何.{0,4}都不|一个.{0,4}都不要/u;

const SCOPE_CUES: Array<{ scope: PlaceExposureScope; cue: RegExp }> = [
  { scope: "restaurant", cue: /餐饮|餐厅|饭店|正餐|吃饭|美食/u },
  { scope: "cafe", cue: /咖啡|甜品|甜点|饮品|下午茶|茶馆/u },
  { scope: "bookstore", cue: /书店|书局|阅读空间/u },
  { scope: "museum", cue: /博物馆|美术馆|展馆|展览/u },
  { scope: "sight", cue: /景点|地标|名胜|古迹/u },
  { scope: "mall", cue: /商场|购物中心|商业综合体/u },
  { scope: "shop", cue: /古着|唱片店|买手店|花店|杂货店|文创店|二手店|主理人店/u },
  { scope: "market", cue: /菜市场|市集|街市/u },
  { scope: "studio", cue: /工作室|工坊|手作空间|独立画廊/u },
  { scope: "street_scene", cue: /街区|街巷|胡同|小巷|街角|天桥|步道|河岸/u },
  { scope: "event", cue: /活动|展会|节庆|快闪|音乐节/u },
  { scope: "park", cue: /公园|绿地|花园|湿地/u }
];

function uniqueScopes(value: unknown): PlaceExposureScope[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const allowed = new Set<PlaceExposureScope>([
    "all", "bookstore", "cafe", "sight", "museum", "mall", "park", "restaurant",
    "shop", "market", "studio", "street_scene", "event"
  ]);
  const scopes = [...new Set(value.map(String).filter((item): item is PlaceExposureScope => allowed.has(item as PlaceExposureScope)))];
  if (scopes.includes("all")) return ["all"];
  return scopes.length ? scopes : undefined;
}

/** Convert the legacy single enum into its policy implications. */
export function discoveryPolicyFromMode(mode?: PlaceDiscoveryMode): PlaceDiscoveryPolicyInput | undefined {
  if (mode === "reliable") return { sourcePolicy: "map_only" };
  if (mode === "hidden_gems") return { sourcePolicy: "web_assisted", noveltyPreference: "long_tail" };
  if (mode === "balanced") return { sourcePolicy: "web_when_relevant" };
  return undefined;
}

/**
 * Deterministic current-turn signals. This is a policy compiler, not a theme
 * catalogue: the LLM can still expand open language, while operationally
 * important negative requests receive stable behavior across turns.
 */
export function compileDiscoveryPolicySignals(task: string): PlaceDiscoveryPolicyInput {
  const input: PlaceDiscoveryPolicyInput = {};
  const longTail = LONG_TAIL_CUE.test(task);
  const mainstream = MAINSTREAM_CUE.test(task);
  const mapOnly = MAP_ONLY_CUE.test(task);
  const exposureMentioned = OVEREXPOSURE_CUE.test(task);
  const allowOverexposed = ALLOW_OVEREXPOSURE_CUE.test(task);

  if (longTail) input.noveltyPreference = "long_tail";
  else if (mainstream) input.noveltyPreference = "mainstream";

  if (exposureMentioned) {
    input.avoidOverexposed = !allowOverexposed;
    if (!allowOverexposed) {
      const scopes = SCOPE_CUES.filter(({ cue }) => cue.test(task)).map(({ scope }) => scope);
      input.exposureScopes = scopes.length ? [...new Set(scopes)] : ["all"];
      input.exposureStrength = STRICT_EXPOSURE_CUE.test(task) ? "strict" : "soft";
      // Exposure is a public-content property, so the normal source strategy
      // must allow evidence discovery unless the user explicitly requests map-only.
      input.sourcePolicy = "web_assisted";
      // A global avoidance request implies long-tail discovery. Scoped requests
      // such as “餐饮别选网红店” must not rewrite the rest of the route.
      if (!input.noveltyPreference && input.exposureScopes.includes("all")) {
        input.noveltyPreference = "long_tail";
      }
    }
  }

  if (mapOnly) input.sourcePolicy = "map_only";
  else if (!input.sourcePolicy && longTail) input.sourcePolicy = "web_assisted";
  return input;
}

export function hasExplicitDiscoveryPolicySignal(task: string): boolean {
  return LONG_TAIL_CUE.test(task) || MAINSTREAM_CUE.test(task) || MAP_ONLY_CUE.test(task) || OVEREXPOSURE_CUE.test(task);
}

/** Merge partial policies in priority order and derive safe operational defaults. */
export function mergeDiscoveryPolicies(...values: Array<PlaceDiscoveryPolicyInput | undefined>): PlaceDiscoveryPolicy {
  const policies = values.filter((value): value is PlaceDiscoveryPolicyInput => Boolean(value));
  const pick = <K extends keyof PlaceDiscoveryPolicyInput>(field: K): PlaceDiscoveryPolicyInput[K] | undefined => {
    for (const policy of policies) {
      const value = policy[field];
      if (value !== undefined) return value;
    }
    return undefined;
  };
  const avoidOverexposed = pick("avoidOverexposed") ?? false;
  const exposureScopes = avoidOverexposed ? uniqueScopes(pick("exposureScopes")) ?? ["all"] : [];
  let noveltyPreference = pick("noveltyPreference") ?? "neutral";
  if (avoidOverexposed && exposureScopes.includes("all") && noveltyPreference === "neutral") {
    noveltyPreference = "long_tail";
  }
  const sourcePolicy = pick("sourcePolicy")
    ?? (avoidOverexposed || noveltyPreference === "long_tail" ? "web_assisted" : "web_when_relevant");
  return {
    sourcePolicy,
    noveltyPreference,
    avoidOverexposed,
    exposureScopes,
    exposureStrength: avoidOverexposed ? pick("exposureStrength") ?? "soft" : "soft"
  };
}

/** Legacy summary used by existing clients and analytics. */
export function deriveDiscoveryMode(policy: PlaceDiscoveryPolicy): PlaceDiscoveryMode {
  if (policy.noveltyPreference === "long_tail") return "hidden_gems";
  if (policy.sourcePolicy === "map_only") return "reliable";
  return "balanced";
}

export function exposurePolicyApplies(policy: PlaceDiscoveryPolicy, category: PoiCategory): boolean {
  return policy.avoidOverexposed
    && (policy.exposureScopes.includes("all") || policy.exposureScopes.includes(category));
}

export function describeDiscoveryPolicy(policy: PlaceDiscoveryPolicy): string {
  const source = policy.sourcePolicy === "map_only" ? "仅地图"
    : policy.sourcePolicy === "web_assisted" ? "主动网页辅助" : "相关时网页辅助";
  const novelty = policy.noveltyPreference === "long_tail" ? "长尾优先"
    : policy.noveltyPreference === "mainstream" ? "经典主流" : "中性探索";
  const exposure = policy.avoidOverexposed
    ? `避开过度曝光（${policy.exposureScopes.join("、")}，${policy.exposureStrength}）`
    : "不限制曝光度";
  return `${source}、${novelty}、${exposure}`;
}
