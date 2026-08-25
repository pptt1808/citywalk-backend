import { DesiredScene, StyleIntent, StyleTag } from "../types/plan";
import { Poi } from "../tools/mapTool";
import { EmbeddingProvider, embeddingProvider } from "./embeddingService";

export interface PoiStyleMatch {
  score: number;
  matches: string[];
  conflicts: string[];
  retrieval: "lexical" | "vector" | "hybrid" | "none";
}

type StyleCue = {
  pattern: RegExp;
  tags: string[];
  searchHints: string[];
  scenes: string[];
  arc?: string[];
};

// These cues are a resilient no-LLM fallback, not a list of supported themes.
// Unknown wording is preserved and remains available to the LLM and embedding matcher.
const FALLBACK_CUES: StyleCue[] = [
  {
    pattern: /恋爱|浪漫|情侣|约会|暧昧|告白|纪念日/,
    tags: ["浪漫", "适合交流", "有仪式感"],
    searchHints: ["安静咖啡馆", "花园", "江景", "夜景", "艺术空间"],
    scenes: ["适合两人慢慢交流的空间", "具有共同记忆点的景观"],
    arc: ["轻松破冰", "共同探索", "氛围升温", "有记忆点的收尾"]
  },
  {
    pattern: /文艺|人文|文学|书卷|艺术|独立文化/,
    tags: ["文艺", "人文", "安静", "可阅读"],
    searchHints: ["独立书店", "美术馆", "艺术空间", "老街", "特色咖啡馆"],
    scenes: ["可以阅读或观看展览的文化空间", "有城市肌理的街巷"],
    arc: ["文化进入", "街巷漫游", "安静停留"]
  },
  {
    pattern: /自然|大自然|户外探索|生态|湿地|森林|山野|绿野|滨水/,
    tags: ["自然探索", "生态", "户外", "开阔"],
    searchHints: ["湿地公园", "森林公园", "滨水步道", "观景台", "植物园"],
    scenes: ["能观察自然生态的区域", "适合步行探索的绿地或滨水空间"],
    arc: ["进入自然", "深入探索", "开阔观景", "舒缓返回"]
  },
  {
    pattern: /王家卫|电影感|胶片感|港风|霓虹|光影/,
    tags: ["电影感", "光影", "情绪化", "街头"],
    searchHints: ["老街", "霓虹街区", "天桥", "复古咖啡馆", "夜景"],
    scenes: ["具有层次光影的街道", "适合形成电影画面的复古空间"],
    arc: ["黄昏入场", "街头游荡", "光影高潮", "夜色收束"]
  },
  {
    pattern: /蒸汽朋克|工业|厂房|仓库|机械|废墟|粗粝/,
    tags: ["工业质感", "粗粝", "新旧反差"],
    searchHints: ["工业遗址", "旧厂房", "创意园", "铁路遗址", "仓库改造"],
    scenes: ["保留机械或厂房结构的空间", "旧工业与当代生活形成反差的场景"],
    arc: ["遗迹进入", "结构探索", "新旧反差", "开放空间收尾"]
  },
  {
    pattern: /烟火气|市井|本地生活|老城生活|菜市场/,
    tags: ["市井", "烟火气", "本地生活"],
    searchHints: ["菜市场", "老街", "社区小店", "传统小吃", "居民街区"],
    scenes: ["能观察本地日常生活的街区", "有传统饮食和社区交往的空间"]
  },
  {
    pattern: /复古|怀旧|旧街|老街|老巷|街巷/,
    tags: ["复古", "怀旧", "旧街巷"],
    searchHints: ["老街", "历史街区", "传统街巷", "古建筑", "老字号"],
    scenes: ["保留传统建筑与城市记忆的旧街巷", "能感受本地历史生活的老街空间"],
    arc: ["从当代城区进入", "穿行历史街巷", "停留观察老建筑", "在老字号附近收尾"]
  },
  {
    pattern: /历史|古城|古迹|传统建筑|民国|古典/,
    tags: ["历史感", "传统建筑", "城市记忆"],
    searchHints: ["历史街区", "古建筑", "名人故居", "城墙", "博物馆"],
    scenes: ["能读到城市历史层次的建筑或街区"]
  }
];

const STYLE_MARKER = /(?:风格|氛围|主题|美学|电影感|胶片感|感觉|质感|探索|约会|浪漫|文艺|自然|市井|烟火气|工业|历史)/i;
const CONTROL_ONLY = /^(?:亲子友好|轻松|悠闲|慢节奏|紧凑|少走路|避雨|室内优先|无障碍)(?:路线)?$/;

function clamp01(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback;
}

function strings(value: unknown, limit: number, length = 80): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))]
    .map((item) => item.slice(0, length))
    .slice(0, limit);
}

function tags(value: unknown): StyleTag[] {
  if (!Array.isArray(value)) return [];
  const result: StyleTag[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const raw = item as Record<string, unknown>;
    const name = String(raw.name ?? "").trim().slice(0, 60);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push({
      name,
      weight: clamp01(raw.weight, 0.7),
      evidence: typeof raw.evidence === "string" ? raw.evidence.trim().slice(0, 120) || undefined : undefined
    });
    if (result.length >= 16) break;
  }
  return result;
}

function scenes(value: unknown): DesiredScene[] {
  if (!Array.isArray(value)) return [];
  const result: DesiredScene[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const raw = item as Record<string, unknown>;
    const description = String(raw.description ?? "").trim().slice(0, 120);
    if (!description || seen.has(description)) continue;
    seen.add(description);
    result.push({
      description,
      importance: clamp01(raw.importance, 0.7),
      searchHints: strings(raw.searchHints, 6, 60)
    });
    if (result.length >= 10) break;
  }
  return result;
}

export function emptyStyleIntent(): StyleIntent {
  return {
    rawText: "",
    summary: "",
    tags: [],
    desiredScenes: [],
    avoidances: [],
    searchHints: [],
    narrativeArc: [],
    confidence: 0
  };
}

export function normalizeStyleIntent(value: unknown): StyleIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyStyleIntent();
  const raw = value as Record<string, unknown>;
  return {
    rawText: typeof raw.rawText === "string" ? raw.rawText.trim().slice(0, 500) : "",
    summary: typeof raw.summary === "string" ? raw.summary.trim().slice(0, 240) : "",
    tags: tags(raw.tags),
    desiredScenes: scenes(raw.desiredScenes),
    avoidances: strings(raw.avoidances, 12, 100),
    searchHints: strings(raw.searchHints, 16, 60),
    narrativeArc: strings(raw.narrativeArc, 10, 100),
    confidence: clamp01(raw.confidence)
  };
}

export function isStyleActive(style: StyleIntent | undefined): boolean {
  return Boolean(style && (style.rawText || style.summary || style.tags.length || style.desiredScenes.length || style.searchHints.length));
}

/** Merge profiles in priority order while retaining useful open-ended detail. */
export function mergeStyleIntents(...values: unknown[]): StyleIntent {
  const profiles = values.map(normalizeStyleIntent).filter(isStyleActive);
  if (profiles.length === 0) return emptyStyleIntent();
  const first = profiles[0];
  const mergeStrings = (pick: (profile: StyleIntent) => string[], limit: number) =>
    [...new Set(profiles.flatMap(pick))].slice(0, limit);
  const mergedTags = new Map<string, StyleTag>();
  const mergedScenes = new Map<string, DesiredScene>();
  for (const profile of profiles) {
    for (const tag of profile.tags) if (!mergedTags.has(tag.name)) mergedTags.set(tag.name, tag);
    for (const scene of profile.desiredScenes) if (!mergedScenes.has(scene.description)) mergedScenes.set(scene.description, scene);
  }
  return {
    rawText: profiles.find((profile) => profile.rawText)?.rawText ?? "",
    summary: profiles.find((profile) => profile.summary)?.summary ?? first.rawText,
    tags: [...mergedTags.values()].slice(0, 16),
    desiredScenes: [...mergedScenes.values()].slice(0, 10),
    avoidances: mergeStrings((profile) => profile.avoidances, 12),
    searchHints: mergeStrings((profile) => profile.searchHints, 16),
    narrativeArc: profiles.find((profile) => profile.narrativeArc.length)?.narrativeArc ?? [],
    confidence: Math.max(...profiles.map((profile) => profile.confidence))
  };
}

function extractAvoidances(text: string): string[] {
  return [...text.matchAll(/(?:不要|不想要?|不喜欢|避开|拒绝|远离)([^，,。；;！!？?]{1,30})/g)]
    .map((match) => match[1].replace(/^(?:太|过于)/, "").trim())
    .filter(Boolean)
    .slice(0, 8);
}

/**
 * Deterministic availability fallback. It never discards unknown style wording:
 * an unfamiliar phrase becomes an open tag and can still be embedded later.
 */
export function compileHeuristicStyle(text: string, force = false): StyleIntent {
  const trimmed = text.trim();
  if (!trimmed) return emptyStyleIntent();
  const clauses = trimmed.split(/[，,。；;！!？?]/).map((item) => item.trim()).filter(Boolean);
  const styleAvoidanceSignal = /商业|网红|打卡|正式|老套|游客|热闹|喧闹|嘈杂|复古|古板|审美|质感|电影|市井|工业|自然|人文|浪漫|文艺|安静/;
  const relevant = clauses.filter((clause) =>
    STYLE_MARKER.test(clause)
    || ((/不要|不想|避开|拒绝|远离/.test(clause)) && styleAvoidanceSignal.test(clause))
  );
  const matchedCues = FALLBACK_CUES.filter((cue) => cue.pattern.test(trimmed));
  if (!force && relevant.length === 0 && matchedCues.length === 0) return emptyStyleIntent();

  const rawText = (relevant.length ? relevant.join("，") : trimmed).slice(0, 500);
  const tagNames = [...new Set(matchedCues.flatMap((cue) => cue.tags))];
  if (tagNames.length === 0) {
    const openPhrase = rawText
      .replace(/^(?:想要|希望|来一条|安排一条|做一条)/, "")
      .replace(/(?:的)?(?:CityWalk|citywalk|路线|主题)$/i, "")
      .trim();
    if (openPhrase && !CONTROL_ONLY.test(openPhrase)) tagNames.push(openPhrase.slice(0, 60));
  }

  const searchHints = [...new Set(matchedCues.flatMap((cue) => cue.searchHints))];
  const desiredScenes = [...new Set(matchedCues.flatMap((cue) => cue.scenes))].map((description) => ({
    description,
    importance: 0.75,
    searchHints: searchHints.filter((hint) => description.includes(hint) || hint.includes(description)).slice(0, 4)
  }));
  const narrativeArc = matchedCues.find((cue) => cue.arc?.length)?.arc ?? [];
  const avoidances = extractAvoidances(trimmed);
  const summaryCore = tagNames.slice(0, 4).join("、") || rawText;
  return normalizeStyleIntent({
    rawText,
    summary: `${summaryCore}的 CityWalk 体验`,
    tags: tagNames.map((name, index) => ({ name, weight: Math.max(0.55, 0.9 - index * 0.05), evidence: rawText })),
    desiredScenes,
    avoidances,
    searchHints: searchHints.length ? searchHints : tagNames,
    narrativeArc,
    confidence: matchedCues.length ? 0.72 : 0.48
  });
}

function compactText(value: string): string {
  return value.toLocaleLowerCase("zh-CN").replace(/[\s\p{P}\p{S}]/gu, "");
}

function characterBigrams(value: string): Set<string> {
  const chars = Array.from(compactText(value));
  const grams = new Set<string>();
  for (let index = 0; index < chars.length - 1; index += 1) grams.add(chars[index] + chars[index + 1]);
  return grams;
}

function overlap(left: string, right: string): number {
  const normalizedLeft = compactText(left);
  const normalizedRight = compactText(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) return 1;
  const leftGrams = characterBigrams(normalizedLeft);
  const rightGrams = characterBigrams(normalizedRight);
  if (!leftGrams.size || !rightGrams.size) return 0;
  let hits = 0;
  for (const gram of leftGrams) if (rightGrams.has(gram)) hits += 1;
  return hits / Math.max(1, Math.min(leftGrams.size, rightGrams.size));
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  if (!leftNorm || !rightNorm) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function describePoiForStyle(poi: Poi): string {
  return [
    poi.name,
    poi.category,
    poi.subtype,
    poi.tags?.join("、"),
    poi.discoveryReasons?.join("；"),
    poi.address
  ].filter(Boolean).join("；");
}

function describeStyleForEmbedding(style: StyleIntent): string {
  return [
    style.summary,
    style.tags.map((tag) => `${tag.name}(${tag.weight})`).join("、"),
    style.desiredScenes.map((scene) => scene.description).join("；"),
    style.searchHints.join("、")
  ].filter(Boolean).join("；");
}

function lexicalMatch(style: StyleIntent, poi: Poi): PoiStyleMatch {
  const descriptor = describePoiForStyle(poi);
  const positive: Array<{ text: string; weight: number }> = [
    ...style.tags.map((tag) => ({ text: tag.name, weight: tag.weight })),
    ...style.searchHints.map((hint) => ({ text: hint, weight: 0.8 })),
    ...style.desiredScenes.map((scene) => ({ text: scene.description, weight: scene.importance }))
  ].filter((item) => !/(?:从.+出发|\d+(?:小时|分钟)|(?:做|安排|生成).{0,8}路线|优先级|使用轮椅)/u.test(item.text));
  const ranked = positive.map((item) => ({ ...item, overlap: overlap(item.text, descriptor) }))
    .filter((item) => item.overlap >= 0.2)
    .sort((left, right) => right.overlap * right.weight - left.overlap * left.weight);
  const conflicts = style.avoidances.filter((item) => overlap(item, descriptor) >= 0.35);
  const rawScore = ranked.slice(0, 4).reduce((sum, item) => sum + item.overlap * item.weight, 0);
  const score = Math.max(0, Math.min(1, rawScore / 1.8 - conflicts.length * 0.35));
  return {
    score,
    matches: ranked.slice(0, 3).map((item) => item.text),
    conflicts,
    retrieval: ranked.length || conflicts.length ? "lexical" : "none"
  };
}

export class StyleMatcher {
  private retryAfter = 0;
  private lastWarningAt = 0;

  constructor(private readonly embeddings: EmbeddingProvider = embeddingProvider) {}

  async matchPois(style: StyleIntent, pois: Poi[], limit = 24): Promise<Map<string, PoiStyleMatch>> {
    const matches = new Map<string, PoiStyleMatch>();
    if (!isStyleActive(style)) return matches;
    for (const poi of pois) matches.set(poi.name, lexicalMatch(style, poi));
    if (!this.embeddings.isConfigured() || Date.now() < this.retryAfter || pois.length === 0) return matches;

    const shortlist = [...pois]
      .sort((left, right) => {
        const styleDelta = (matches.get(right.name)?.score ?? 0) - (matches.get(left.name)?.score ?? 0);
        return styleDelta || (right.rating ?? 0) - (left.rating ?? 0);
      })
      .slice(0, Math.max(1, Math.min(limit, 40)));
    try {
      const vectors = await this.embeddings.embedBatch([
        describeStyleForEmbedding(style),
        ...shortlist.map(describePoiForStyle)
      ]);
      const queryVector = vectors[0];
      for (let index = 0; index < shortlist.length; index += 1) {
        const poi = shortlist[index];
        const lexical = matches.get(poi.name) ?? lexicalMatch(style, poi);
        const cosine = cosineSimilarity(queryVector, vectors[index + 1]);
        let semantic = Math.max(0, Math.min(1, (cosine + 1) / 2));
        const styleText = describeStyleForEmbedding(style);
        const poiText = describePoiForStyle(poi);
        const requestsHistoricStreet = /复古|怀旧|旧街|老街|老巷|街巷|历史街区|传统建筑|古城|古迹/u.test(styleText);
        const hasHistoricEvidence = /复古|怀旧|旧街|老街|老巷|街巷|历史|传统|古(?:城|迹|建|街|巷)?|民国|遗址|故居|城墙|牌坊|老字号|博物馆|道院/u.test(poiText);
        const historicEvidenceMissing = requestsHistoricStreet && !hasHistoricEvidence;
        if (historicEvidenceMissing) semantic = Math.min(semantic, 0.22);
        const score = lexical.retrieval === "lexical"
          ? semantic * 0.65 + lexical.score * 0.35
          : semantic;
        const conflicts = [...lexical.conflicts];
        if (historicEvidenceMissing && poi.category === "mall"
          && !conflicts.includes("现代商业空间缺少旧街巷或历史依据")) {
          conflicts.push("现代商业空间缺少旧街巷或历史依据");
        }
        matches.set(poi.name, {
          ...lexical,
          score: Number(Math.max(0, score - conflicts.length * 0.2).toFixed(4)),
          matches: lexical.matches.length || semantic < 0.58
            ? lexical.matches
            : [`与“${style.summary || style.rawText}”语义相符`],
          conflicts,
          retrieval: lexical.retrieval === "lexical" ? "hybrid" : "vector"
        });
      }
      this.retryAfter = 0;
    } catch (error) {
      this.retryAfter = Date.now() + 60_000;
      if (Date.now() - this.lastWarningAt >= 60_000) {
        console.warn(`[StyleMatcher] vector style matching disabled for 60s: ${error instanceof Error ? error.message : String(error)}`);
        this.lastWarningAt = Date.now();
      }
    }
    return matches;
  }
}

export const styleMatcher = new StyleMatcher();
