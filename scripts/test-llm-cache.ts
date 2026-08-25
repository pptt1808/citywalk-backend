import assert from "node:assert/strict";
import http from "node:http";

async function main() {
  const { cache } = await import("../src/utils/cache");

  cache.clear();
  cache.set("expired", "x", 1);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(cache.get("expired"), undefined, "过期条目必须不可读");

  cache.clear();
  for (let index = 0; index < 600; index += 1) cache.set(`k${index}`, index, 60_000);
  assert.equal(cache.get("k0"), undefined, "超出容量后最旧条目应被驱逐");
  assert.equal(cache.get("k599"), 599, "最新条目必须保留");

  cache.clear();
  cache.set("hot", "v", 60_000);
  for (let index = 0; index < 600; index += 1) {
    cache.get("hot");
    cache.set(`filler${index}`, index, 60_000);
  }
  assert.equal(cache.get("hot"), "v", "被反复访问的条目不应被 LRU 驱逐");

  const requests: string[] = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += String(chunk); });
    request.on("end", () => {
      requests.push(body);
      const payload = JSON.parse(body) as { messages?: Array<{ role?: string; content?: string }> };
      const user = payload.messages?.find((message) => message.role === "user");
      const pois = JSON.parse(user?.content ?? "[]") as Array<{ name: string }>;
      const data = pois.map((poi) => ({
        estimatedCost: 30,
        estimatedStayMinutes: 40,
        costBreakdown: `${poi.name}费用`,
        highlight: `${poi.name}亮点`,
        bookingInfo: "免预约"
      }));
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(data) } }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_cache_hit_tokens: 60, prompt_cache_miss_tokens: 40 }
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("cache test server failed to bind");

  process.env.DEEPSEEK_API_KEY = "test-key";
  process.env.DEEPSEEK_FLASH_API_KEY = "test-key";
  process.env.DEEPSEEK_FLASH_BASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.DEEPSEEK_FLASH_MODEL = "deepseek-v4-flash";
  process.env.LLM_AUTO_PRO_ENABLED = "false";
  process.env.LLM_MAX_RETRIES = "0";

  try {
    const { LlmRouter } = await import("../src/llm/llmRouter");
    const router = new LlmRouter();
    const poiA = { name: "缓存测试书店甲", category: "bookstore" as const, city: "南京" };
    const poiB = { name: "缓存测试公园乙", category: "park" as const, city: "南京" };
    const poiC = { name: "缓存测试咖啡丙", category: "cafe" as const, city: "南京" };

    const first = await router.enrichPois([poiA, poiB], "flash");
    assert.equal(requests.length, 1, "首次必须调用模型");
    assert.equal(first?.data.length, 2);
    assert.equal(first?.data[0]?.highlight, "缓存测试书店甲亮点");

    const second = await router.enrichPois([poiA, poiB], "flash");
    assert.equal(requests.length, 1, "全部命中缓存时不得调用模型");
    assert.deepEqual(second?.data, first?.data, "缓存结果必须与首次一致");

    const third = await router.enrichPois([poiA, poiC], "flash");
    assert.equal(requests.length, 2, "部分未命中时只应为缺失 POI 调用模型");
    const lastRequestPois = JSON.parse(
      (JSON.parse(requests[1]) as { messages: Array<{ role: string; content: string }> })
        .messages.find((message) => message.role === "user")!.content
    ) as Array<{ name: string }>;
    assert.deepEqual(lastRequestPois.map((poi) => poi.name), ["缓存测试咖啡丙"], "请求中只能包含未命中的 POI");
    assert.deepEqual(
      third?.data.map((item) => item.highlight),
      ["缓存测试书店甲亮点", "缓存测试咖啡丙亮点"],
      "合并结果必须保持输入顺序"
    );
    console.log("PASS MemoryCache capacity/LRU/expiry + enrichPois per-POI cache hit/merge");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
