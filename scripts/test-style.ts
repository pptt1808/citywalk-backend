import assert from "node:assert/strict";

process.env.AMAP_KEY = "";
process.env.QWEATHER_KEY = "";
process.env.HEFENG_KEY = "";
process.env.DEEPSEEK_API_KEY = "";
process.env.DEEPSEEK_FLASH_API_KEY = "";
process.env.DEEPSEEK_PRO_API_KEY = "";
process.env.EMBEDDING_API_KEY = "";

import type { Poi } from "../src/tools/mapTool";
import type { WeatherContext } from "../src/tools/weatherTool";
import type { EmbeddingProvider } from "../src/services/embeddingService";

const candidatePois: Poi[] = [
  {
    name: "霓虹老街",
    category: "sight",
    averageCost: 0,
    location: "118,32",
    address: "老城街巷",
    tags: ["老街", "霓虹街区", "夜景"],
    distanceMeters: 300,
    rating: 4.7,
    indoor: false
  },
  {
    name: "网红商业综合体",
    category: "mall",
    averageCost: 80,
    location: "118.001,32.001",
    address: "商业综合体",
    tags: ["网红商业化空间", "购物中心"],
    distanceMeters: 500,
    rating: 4.9,
    indoor: true
  },
  {
    name: "普通公园",
    category: "park",
    averageCost: 0,
    location: "118.002,32.002",
    address: "城市公园",
    tags: ["公园"],
    distanceMeters: 700,
    rating: 4.5,
    indoor: false
  }
];

async function main() {
  const { UrbanPulseAgent } = await import("../src/agents/urbanPulseAgent");
  const { MapTool } = await import("../src/tools/mapTool");
  const { WeatherTool } = await import("../src/tools/weatherTool");
  const { StyleMatcher, compileHeuristicStyle } = await import("../src/services/styleService");

  class FakeMapTool extends MapTool {
    override async geocode(): Promise<string> { return "118,32"; }
    override async searchNearbyPoi(): Promise<Poi[]> { return candidatePois; }
    override async searchPoi(): Promise<Poi[]> { return candidatePois; }
    override async planRoute(origin: string, destinations: string[], mode: "walk" | "transit" | "mixed") {
      return destinations.map((destination) => ({
        origin,
        destination,
        distanceMeters: 500,
        durationMinutes: 8,
        mode: mode === "transit" ? "transit" as const : "walk" as const
      }));
    }
  }

  class FakeWeatherTool extends WeatherTool {
    override async getWeatherContext(city: string): Promise<WeatherContext> {
      return { rainProbability: 10, risk: "low", summary: `${city}天气良好`, indices: [] };
    }
  }

  class NoEmbeddingProvider implements EmbeddingProvider {
    readonly model = "test-none";
    readonly dimensions = 3;
    isConfigured(): boolean { return false; }
    async embed(): Promise<number[]> { return [0, 0, 0]; }
    async embedBatch(): Promise<number[][]> { return []; }
    contentHash(text: string): string { return text; }
  }

  class FakeEmbeddingProvider implements EmbeddingProvider {
    readonly model = "test-style";
    readonly dimensions = 3;
    isConfigured(): boolean { return true; }
    async embed(text: string): Promise<number[]> { return (await this.embedBatch([text]))[0]; }
    async embedBatch(texts: string[]): Promise<number[][]> {
      return texts.map((text) => text.includes("匹配") || text.includes("旧工业") ? [1, 0, 0] : [0, 1, 0]);
    }
    contentHash(text: string): string { return text; }
  }

  const semanticMatcher = new StyleMatcher(new FakeEmbeddingProvider());
  const semantic = await semanticMatcher.matchPois({
    rawText: "新颖的旧工业反差感",
    summary: "旧工业与当代生活的反差感",
    tags: [{ name: "旧工业", weight: 1 }],
    desiredScenes: [],
    avoidances: [],
    searchHints: [],
    narrativeArc: [],
    confidence: 1
  }, [
    { name: "语义匹配点", category: "sight", averageCost: 0, tags: ["匹配"], address: "" },
    { name: "无关点", category: "sight", averageCost: 0, tags: ["普通"], address: "" }
  ]);
  assert.ok((semantic.get("语义匹配点")?.score ?? 0) > (semantic.get("无关点")?.score ?? 0));
  assert.equal(semantic.get("语义匹配点")?.retrieval, "vector");

  class AlwaysSimilarEmbeddingProvider implements EmbeddingProvider {
    readonly model = "test-noisy-style";
    readonly dimensions = 3;
    isConfigured(): boolean { return true; }
    async embed(): Promise<number[]> { return [1, 0, 0]; }
    async embedBatch(texts: string[]): Promise<number[][]> { return texts.map(() => [1, 0, 0]); }
    contentHash(text: string): string { return text; }
  }

  const retroStyle = compileHeuristicStyle("做一条复古旧街巷风格路线");
  assert.ok(retroStyle.searchHints.includes("老街"));
  assert.ok(retroStyle.searchHints.includes("历史街区"));
  const noisySemantic = await new StyleMatcher(new AlwaysSimilarEmbeddingProvider()).matchPois(retroStyle, [
    { name: "国际金融中心", category: "mall", averageCost: 0, tags: ["购物服务", "现代商场"], address: "新街口" },
    { name: "南京历史博物馆", category: "museum", averageCost: 0, tags: ["历史", "博物馆"], address: "冶山道院" }
  ]);
  assert.equal(noisySemantic.get("国际金融中心")?.matches.length, 0, "现代商场不应仅凭高向量相似度冒充复古旧街");
  assert.ok((noisySemantic.get("国际金融中心")?.score ?? 1) < 0.25);
  assert.ok((noisySemantic.get("南京历史博物馆")?.score ?? 0) > (noisySemantic.get("国际金融中心")?.score ?? 1));

  const result = await new UrbanPulseAgent(
    new FakeMapTool(),
    new FakeWeatherTool(),
    new StyleMatcher(new NoEmbeddingProvider())
  ).plan({ task: "南京想要王家卫电影感的夜游，避开网红商业化" });

  assert.match(result.constraints.style.rawText, /王家卫|电影感/);
  assert.ok(result.constraints.style.tags.some((tag) => tag.name === "电影感"));
  assert.ok(result.constraints.style.searchHints.includes("老街"));
  assert.ok(result.constraints.style.avoidances.some((item) => item.includes("网红商业化")));
  assert.ok(result.stops.length > 0);
  assert.ok(result.stops.every((stop) => stop.name !== "网红商业综合体"));
  assert.ok(result.stops.some((stop) => stop.styleMatches?.length));
  assert.match(result.routeOverview?.importantNotes.join("；") ?? "", /风格/);
  assert.ok(result.summary.length < 100, "路线摘要不应退化成长篇散文");
  const poiAction = result.events?.find((event) => event.tool_call?.tool === "search_poi_nearby");
  assert.ok(JSON.stringify(poiAction?.tool_call?.input).includes("王家卫") || JSON.stringify(poiAction?.tool_call?.input).includes("电影感"));

  const custom = await new UrbanPulseAgent(new FakeMapTool(), new FakeWeatherTool(), new StyleMatcher(new NoEmbeddingProvider())).plan({
    task: "做一条路线",
    style: {
      rawText: "我想要一种潮湿旧城与霓虹反差的感觉",
      summary: "潮湿旧城与霓虹反差",
      tags: [{ name: "潮湿旧城与霓虹反差", weight: 1 }],
      searchHints: ["老街", "霓虹"]
    }
  });
  assert.equal(custom.constraints.style.summary, "潮湿旧城与霓虹反差");
  assert.equal(custom.constraints.style.tags[0]?.name, "潮湿旧城与霓虹反差");
  console.log("PASS open style pipeline: arbitrary profile / lexical+vector matching / avoidance / route explanation");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
