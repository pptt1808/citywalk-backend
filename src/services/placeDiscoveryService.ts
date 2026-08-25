import {
  InformationSource,
  PlaceDiscoveryMode,
  PlaceDiscoveryPolicy,
  WebDiscoveredPlace
} from "../types/plan";
import { inferPoiCategory, inferPoiKind, Poi, PoiSearchOptions } from "../tools/mapTool";
import {
  discoveryPolicyFromMode,
  exposurePolicyApplies,
  mergeDiscoveryPolicies
} from "./discoveryPolicyService";

interface PlaceDiscoveryMap {
  searchPoi(keywords: string[], options: PoiSearchOptions): Promise<Poi[]>;
  searchNearbyPoi(keywords: string[], options: PoiSearchOptions): Promise<Poi[]>;
  resolvePoiCandidate(
    name: string,
    options: Pick<PoiSearchOptions, "city" | "location" | "radius" | "signal">
  ): Promise<Poi | undefined>;
}

interface PlaceDiscoveryWeb {
  readonly available: boolean;
  search(query: string, options?: { maxResults?: number; signal?: AbortSignal }): Promise<InformationSource[]>;
}

interface PlaceDiscoveryLlm {
  extractCityWalkPlaceCandidates(
    city: string,
    discoveryBrief: string,
    sources: InformationSource[],
    preferredModel?: "flash" | "pro",
    signal?: AbortSignal
  ): Promise<{ data: WebDiscoveredPlace[] } | undefined>;
}

export interface PlaceDiscoveryRequest {
  city: string;
  task: string;
  keywords: string[];
  location?: string;
  radius?: number;
  indoorOnly?: boolean;
  mode: PlaceDiscoveryMode;
  policy?: PlaceDiscoveryPolicy;
  preferredModel?: "flash" | "pro";
  signal?: AbortSignal;
}

export interface PlaceDiscoveryResult {
  pois: Poi[];
  sources: InformationSource[];
  mapCandidateCount: number;
  webSourceCount: number;
  webMatchedCount: number;
}

const SPECIALTY_CUE = /小众|冷门|宝藏|本地人|社区|独立|古着|唱片|买手|主理人|旧货|二手|花店|杂货|甜品|工作室|工坊|市集|菜市场|街角|小巷|胡同|天桥|非景点|城市肌理|烟火气|王家卫|电影感|文艺/u;
const SPECIALTY_CATEGORIES = new Set<Poi["category"]>(["shop", "market", "studio", "street_scene", "bookstore"]);

function compact(value: string): string {
  return value.toLocaleLowerCase("zh-CN").replace(/[\s\p{P}\p{S}]/gu, "");
}

function likelySamePlace(left: string, right: string): boolean {
  const a = compact(left).replace(/(?:旗舰店|总店|分店|门店|店)$/u, "");
  const b = compact(right).replace(/(?:旗舰店|总店|分店|门店|店)$/u, "");
  return Boolean(a && b && (a === b || Math.min(a.length, b.length) >= 3 && (a.includes(b) || b.includes(a))));
}

function keywordMatches(poi: Poi, keywords: string[]): string[] {
  const descriptor = compact([poi.name, poi.subtype, ...(poi.tags ?? [])].filter(Boolean).join(" "));
  return keywords.filter((keyword) => {
    const normalized = compact(keyword);
    return normalized.length >= 2 && (descriptor.includes(normalized) || normalized.includes(compact(poi.name)));
  }).slice(0, 4);
}

function hasOverexposureEvidence(poi: Poi): boolean {
  return /网红|打卡|爆火|刷屏|游客扎堆|热门景区|商业综合体|购物中心|主题乐园|全国连锁/u.test([
    poi.name,
    poi.subtype,
    ...(poi.tags ?? []),
    ...(poi.discoveryReasons ?? [])
  ].filter(Boolean).join(" "));
}

function scorePoi(poi: Poi, keywords: string[], policy: PlaceDiscoveryPolicy): Poi {
  const matches = keywordMatches(poi, keywords);
  let score = 0.32;
  const reasons = [...(poi.discoveryReasons ?? [])];
  if (matches.length) {
    score += Math.min(0.24, matches.length * 0.08);
    reasons.push(`匹配“${matches.join("、")}”`);
  }
  if (SPECIALTY_CATEGORIES.has(poi.category)) {
    score += 0.16;
    reasons.push("具有独立业态或城市漫步场景价值");
  }
  if (poi.subtype && !/^(?:购物服务|餐饮服务|风景名胜|生活服务|科教文化服务)$/u.test(poi.subtype)) score += 0.08;
  if (poi.discoverySource === "web") score += 0.1 + Math.max(0, Math.min(0.1, (poi.discoveryConfidence ?? 0.6) * 0.1));
  if (poi.distanceMeters != null && Number.isFinite(poi.distanceMeters)) {
    score += Math.max(0, 0.12 - poi.distanceMeters / 50_000);
    if (poi.distanceMeters <= 2000) reasons.push("与起点距离适合步行串联");
  }
  if (poi.rating != null) score += Math.max(0, Math.min(0.05, (poi.rating - 4) * 0.05));
  if (policy.noveltyPreference === "long_tail" && /热门景区|商业综合体|购物中心|主题乐园|全国连锁/u.test(`${poi.name} ${(poi.tags ?? []).join(" ")}`)) {
    score -= 0.16;
    reasons.push("隐藏探索模式降低主流商业地标权重");
  }
  if (exposurePolicyApplies(policy, poi.category) && hasOverexposureEvidence(poi)) {
    score -= policy.exposureStrength === "strict" ? 0.42 : 0.2;
    reasons.push("用户要求降低社交媒体过度曝光地点的权重");
  }
  return {
    ...poi,
    cityWalkScore: Number(Math.max(0, Math.min(1, score)).toFixed(4)),
    discoveryReasons: [...new Set(reasons)].slice(0, 5)
  };
}

function mergePois(pois: Poi[]): Poi[] {
  const merged: Poi[] = [];
  for (const poi of pois) {
    const existingIndex = merged.findIndex((item) => item.id && poi.id ? item.id === poi.id : likelySamePlace(item.name, poi.name));
    if (existingIndex < 0) {
      merged.push(poi);
      continue;
    }
    const existing = merged[existingIndex];
    const preferWeb = poi.discoverySource === "web";
    merged[existingIndex] = {
      ...(preferWeb ? existing : poi),
      ...(preferWeb ? poi : existing),
      tags: [...new Set([...(existing.tags ?? []), ...(poi.tags ?? [])])].slice(0, 16),
      evidenceUrls: [...new Set([...(existing.evidenceUrls ?? []), ...(poi.evidenceUrls ?? [])])].slice(0, 6),
      discoveryReasons: [...new Set([...(existing.discoveryReasons ?? []), ...(poi.discoveryReasons ?? [])])].slice(0, 5),
      cityWalkScore: Math.max(existing.cityWalkScore ?? 0, poi.cityWalkScore ?? 0)
    };
  }
  return merged;
}

export class PlaceDiscoveryService {
  constructor(
    private readonly map: PlaceDiscoveryMap,
    private readonly web: PlaceDiscoveryWeb,
    private readonly llm: PlaceDiscoveryLlm
  ) {}

  async discover(request: PlaceDiscoveryRequest): Promise<PlaceDiscoveryResult> {
    const policy = request.policy ?? mergeDiscoveryPolicies(discoveryPolicyFromMode(request.mode));
    const keywords = [...new Set(request.keywords.map((keyword) => keyword.trim()).filter(Boolean))].slice(0, 12);
    const mapPromise = request.location
      ? this.map.searchNearbyPoi(keywords, {
          city: request.city,
          location: request.location,
          radius: request.radius ?? 5000,
          indoorOnly: request.indoorOnly,
          offset: 15,
          sortRule: "distance",
          signal: request.signal
        })
      : this.map.searchPoi(keywords, {
          city: request.city,
          indoorOnly: request.indoorOnly,
          offset: 15,
          signal: request.signal
        });
    const shouldUseWeb = this.web.available && policy.sourcePolicy !== "map_only"
      && (policy.sourcePolicy === "web_assisted"
        || policy.avoidOverexposed
        || policy.noveltyPreference === "long_tail"
        || SPECIALTY_CUE.test(`${request.task} ${keywords.join(" ")}`));
    const webPromise = shouldUseWeb
      ? this.web.search(this.webQuery(request, keywords), { maxResults: 7, signal: request.signal }).catch((error) => {
          if (request.signal?.aborted) throw error;
          console.warn(`[PlaceDiscovery] web discovery unavailable: ${error instanceof Error ? error.message : String(error)}`);
          return [] as InformationSource[];
        })
      : Promise.resolve([] as InformationSource[]);
    const [mapPois, sources] = await Promise.all([mapPromise, webPromise]);
    const webPois = await this.resolveWebCandidates(request, mapPois, sources);
    const pois = mergePois([...webPois, ...mapPois])
      .map((poi) => scorePoi(poi, keywords, policy))
      .sort((left, right) => (right.cityWalkScore ?? 0) - (left.cityWalkScore ?? 0)
        || (left.distanceMeters ?? Number.MAX_SAFE_INTEGER) - (right.distanceMeters ?? Number.MAX_SAFE_INTEGER));
    return {
      pois,
      sources,
      mapCandidateCount: mapPois.length,
      webSourceCount: sources.length,
      webMatchedCount: webPois.length
    };
  }

  private webQuery(request: PlaceDiscoveryRequest, keywords: string[]): string {
    const policy = request.policy ?? mergeDiscoveryPolicies(discoveryPolicyFromMode(request.mode));
    const focus = keywords.filter((keyword) => SPECIALTY_CUE.test(keyword)).slice(0, 6);
    const terms = focus.length ? focus : keywords.slice(0, 5);
    const exploration = [
      policy.noveltyPreference === "long_tail" ? "小众 独立小店 本地生活 非热门景点" : "CityWalk 本地特色",
      policy.avoidOverexposed ? "非网红 非打卡 低曝光" : ""
    ].filter(Boolean).join(" ");
    return `${request.city} ${terms.join(" ")} ${exploration}`.replace(/\s+/gu, " ").trim().slice(0, 280);
  }

  private async resolveWebCandidates(
    request: PlaceDiscoveryRequest,
    mapPois: Poi[],
    sources: InformationSource[]
  ): Promise<Poi[]> {
    if (!sources.length) return [];
    let extracted: WebDiscoveredPlace[] = [];
    try {
      extracted = (await this.llm.extractCityWalkPlaceCandidates(
        request.city,
        `${request.task}；检索词：${request.keywords.join("、")}`,
        sources,
        request.preferredModel,
        request.signal
      ))?.data ?? [];
    } catch (error) {
      if (request.signal?.aborted) throw error;
      console.warn(`[PlaceDiscovery] evidence extraction failed: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }

    const results: Poi[] = [];
    for (const candidate of extracted.slice(0, 6)) {
      const existing = mapPois.find((poi) => likelySamePlace(candidate.name, poi.name));
      const matched = existing ?? await this.map.resolvePoiCandidate(candidate.name, {
        city: request.city,
        location: request.location,
        radius: Math.max(request.radius ?? 5000, 8000),
        signal: request.signal
      });
      if (!matched?.location) continue;
      const inferredCategory = inferPoiCategory(`${matched.name};${candidate.subtype ?? ""};${candidate.tags.join(";")};${(matched.tags ?? []).join(";")}`);
      const category = inferredCategory === "sight" ? matched.category : inferredCategory;
      results.push({
        ...matched,
        category,
        kind: inferPoiKind(category),
        subtype: candidate.subtype || matched.subtype,
        tags: [...new Set([...(matched.tags ?? []), ...candidate.tags])].slice(0, 16),
        discoverySource: "web",
        verificationStatus: "map_matched",
        evidenceUrls: [candidate.sourceUrl],
        discoveryReasons: [`公开来源提及：${candidate.evidence.slice(0, 120)}`],
        discoveryConfidence: candidate.confidence
      });
    }
    return results;
  }
}
