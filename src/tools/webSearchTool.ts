import { createHash } from "node:crypto";
import { env } from "../config/env";
import { InformationSource, InformationSourceType } from "../types/plan";
import { cache } from "../utils/cache";
import { fetchJsonWithRetry } from "../utils/httpClient";

type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  published_date?: string;
};

type TavilyResponse = {
  results?: TavilyResult[];
  response_time?: string;
  request_id?: string;
};

const SEARCH_CACHE_TTL_MS = 30 * 60 * 1000;

const TRUSTED_OFFICIAL_DOMAINS = [
  "gov.cn",
  "mct.gov.cn",
  "ncha.gov.cn",
  "culturedc.cn",
  "chnmuseum.cn",
  "njmuseum.org.cn",
  "wisdommuseum.cn",
  "njztf.cn"
];

function hostnameMatches(hostname: string, expected: string): boolean {
  return hostname === expected || hostname.endsWith(`.${expected}`);
}

function classifySource(hostname: string): { sourceType: InformationSourceType; reason: string } {
  if (TRUSTED_OFFICIAL_DOMAINS.some((domain) => hostnameMatches(hostname, domain))) {
    return { sourceType: "official_link", reason: "政府、公共文化平台或已登记场馆官方域名" };
  }
  if (hostname.endsWith(".edu.cn")) {
    return { sourceType: "official_link", reason: "教育机构官方域名" };
  }
  return { sourceType: "unverified", reason: "搜索结果尚未完成官方域名核验" };
}

function safePublicUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
    const hostname = url.hostname.toLowerCase();
    if (hostname === "localhost" || hostname.endsWith(".local") || hostname === "0.0.0.0" || hostname === "::1") return undefined;
    if (/^(?:10|127)\./.test(hostname) || /^192\.168\./.test(hostname) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname)) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

function compactText(value: string | undefined, maxLength: number): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

export class WebSearchTool {
  get available(): boolean {
    return Boolean(env.TAVILY_API_KEY);
  }

  async search(query: string, options: { maxResults?: number; signal?: AbortSignal } = {}): Promise<InformationSource[]> {
    const normalizedQuery = query.replace(/\s+/g, " ").trim().slice(0, 300);
    if (!this.available || !normalizedQuery) return [];
    const maxResults = Math.min(Math.max(options.maxResults ?? 5, 1), 8);
    const cacheKey = `web-search:${createHash("sha256").update(`${normalizedQuery}:${maxResults}`).digest("hex")}`;
    const cached = cache.get<InformationSource[]>(cacheKey);
    if (cached) return cached;

    const response = await fetchJsonWithRetry<TavilyResponse>(`${env.TAVILY_BASE_URL.replace(/\/$/, "")}/search`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.TAVILY_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query: normalizedQuery,
        search_depth: "basic",
        chunks_per_source: 1,
        max_results: maxResults,
        topic: "general",
        include_answer: false,
        include_raw_content: false,
        include_images: false,
        include_favicon: false
      })
    }, {
      retries: 1,
      timeoutMs: env.TAVILY_SEARCH_TIMEOUT_MS,
      signal: options.signal
    });

    const retrievedAt = new Date().toISOString();
    const seen = new Set<string>();
    const sources = (response.results ?? []).flatMap((result): InformationSource[] => {
      const url = safePublicUrl(result.url);
      if (!url) return [];
      const canonical = `${url.hostname.toLowerCase()}${url.pathname.replace(/\/$/, "")}`;
      if (seen.has(canonical)) return [];
      seen.add(canonical);
      const verification = classifySource(url.hostname.toLowerCase());
      return [{
        title: compactText(result.title, 180) ?? url.hostname,
        url: url.toString(),
        domain: url.hostname.toLowerCase(),
        snippet: compactText(result.content, 500),
        sourceType: verification.sourceType,
        verificationReason: verification.reason,
        provider: "tavily",
        retrievedAt,
        publishedAt: compactText(result.published_date, 40)
      }];
    }).sort((left, right) => Number(right.sourceType === "official_link") - Number(left.sourceType === "official_link"));

    cache.set(cacheKey, sources, SEARCH_CACHE_TTL_MS);
    return sources;
  }

  searchVenueOfficialInfo(placeName: string, city: string, userQuestion: string, signal?: AbortSignal): Promise<InformationSource[]> {
    const focus = /预约|门票|票价/.test(userQuestion)
      ? "官方 预约 门票"
      : /开放|营业|闭馆|开门|关门/.test(userQuestion)
        ? "官方网站 开放时间 临时闭馆"
        : "官方网站 参观信息";
    return this.search(`${city} ${placeName} ${focus}`, { maxResults: 6, signal });
  }
}

export const webSearchTool = new WebSearchTool();
