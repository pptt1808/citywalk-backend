import assert from "node:assert/strict";
import http from "node:http";

async function main() {
  let calls = 0;
  let constraintCalls = 0;
  const models: string[] = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += String(chunk); });
    request.on("end", () => {
      calls += 1;
      const payload = JSON.parse(body) as { model?: string; messages?: Array<{ content?: string }> };
      models.push(String(payload.model));
      const system = (payload.messages ?? []).map((message) => message.content ?? "").join("\n");
      let content: string;
      if (system.includes("CityWalk 朋友圈文案写作者")) {
        content = JSON.stringify({ candidates: [
          { variantIndex: 0, text: "这次从先锋书店慢慢走到玄武湖公园，在湖边坐了一会，风吹过来时整个人都松了下来。", hashtags: [] },
          { variantIndex: 0, text: "先锋书店翻完几页书，又一路晃到玄武湖公园。下午没有赶路，只在水边安静地待了一会。", hashtags: [] },
          { variantIndex: 1, text: "书店翻书，湖边坐坐，这个下午刚刚好。", hashtags: [] },
          { variantIndex: 1, text: "从书店晃到湖边，慢一点也很好。", hashtags: [] }
        ] });
      } else if (system.includes("朋友圈文案的独立编辑")) {
        content = JSON.stringify({ variants: [
          { variantIndex: 0, selectedCandidateIndex: 0, pass: true, scores: { groundedness: 9, naturalness: 9, speechAct: 9, styleFit: 9, shareability: 9 }, issues: [] },
          { variantIndex: 1, selectedCandidateIndex: 2, pass: true, scores: { groundedness: 9, naturalness: 9, speechAct: 9, styleFit: 9, shareability: 9 }, issues: [] }
        ] });
      } else if (system.includes("发布前的事实与语用验收员")) {
        content = JSON.stringify({ variants: [
          { variantIndex: 0, pass: true, scores: { groundedness: 9, naturalness: 9, speechAct: 9, styleFit: 9, shareability: 9 }, issues: [] },
          { variantIndex: 1, pass: true, scores: { groundedness: 9, naturalness: 9, speechAct: 9, styleFit: 9, shareability: 9 }, issues: [] }
        ] });
      } else {
        constraintCalls += 1;
        content = constraintCalls === 1 ? "not-json" : JSON.stringify({
            city: "南京",
            accessibility: {
              wheelchairAccessRequired: true,
              stepFreeRequired: true
            }
          });
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("retry test server failed to bind");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  process.env.DEEPSEEK_API_KEY = "test-key";
  process.env.DEEPSEEK_FLASH_API_KEY = "test-key";
  process.env.DEEPSEEK_FLASH_BASE_URL = baseUrl;
  process.env.DEEPSEEK_FLASH_MODEL = "deepseek-v4-flash";
  process.env.DEEPSEEK_PRO_API_KEY = "test-pro-key";
  process.env.DEEPSEEK_PRO_BASE_URL = baseUrl;
  process.env.DEEPSEEK_PRO_MODEL = "deepseek-v4-pro";
  process.env.LLM_AUTO_PRO_ENABLED = "false";
  process.env.LLM_MAX_RETRIES = "2";
  process.env.LLM_RETRY_BASE_DELAY_MS = "100";
  process.env.LLM_TIMEOUT_MS = "2000";

  try {
    const [{ LlmRouter }, { buildSocialCopyBrief }] = await Promise.all([
      import("../src/llm/llmRouter"),
      import("../src/services/socialCopyService")
    ]);
    const result = await new LlmRouter().parseConstraints(
      "南京轮椅无障碍路线",
      { task: "南京轮椅无障碍路线", preferredModel: "flash" },
      "flash"
    );
    assert.equal(calls, 2, "格式错误的第一次响应应在同一模型上重试");
    assert.deepEqual(models, ["deepseek-v4-flash", "deepseek-v4-flash"]);
    assert.equal(result?.data.accessibility?.wheelchairAccessRequired, true);
    assert.equal(result?.model, "deepseek-v4-flash");

    const automatic = await new LlmRouter().parseConstraints(
      "南京必须安排一条包含老人儿童预算雨天公交的复杂长路线，但不要自动切换 Pro",
      { task: "南京复杂路线" }
    );
    assert.equal(models.at(-1), "deepseek-v4-flash", "关闭自动路由后，复杂任务也必须留在 Flash");
    assert.equal(automatic?.model, "deepseek-v4-flash");

    const explicit = await new LlmRouter().parseConstraints(
      "南京路线",
      { task: "南京路线", preferredModel: "pro" },
      "pro"
    );
    assert.equal(models.at(-1), "deepseek-v4-pro", "显式选择且单独配置 Pro 时仍应允许使用 Pro");
    assert.equal(explicit?.model, "deepseek-v4-pro");

    const route = {
      title: "南京慢走",
      routeOverview: { title: "南京慢走", city: "南京" },
      totalEstimatedMinutes: 120,
      constraints: { city: "南京" },
      stops: [
        { name: "先锋书店", category: "bookstore", reason: "阅读空间" },
        { name: "玄武湖公园", category: "park", reason: "湖边绿地" }
      ]
    } as Parameters<typeof buildSocialCopyBrief>[1];
    const brief = buildSocialCopyBrief("根据刚才路线写一条自然的朋友圈文案", route);
    const social = await new LlmRouter().generateSocialCopy(
      "根据刚才路线写一条自然的朋友圈文案",
      brief,
      { referenceRoute: route },
      "flash"
    );
    assert.equal(social?.originalCandidates.length, 4, "分享文案必须只生成 4 个候选");
    assert.deepEqual(
      [0, 1].map((variantIndex) => social?.originalCandidates.filter((candidate) => candidate.variantIndex === variantIndex).length),
      [2, 2],
      "完整版和简短版必须各有 2 个候选"
    );
    console.log("PASS DeepSeek retry / automatic Pro disabled / explicit Pro opt-in / four social candidates");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
