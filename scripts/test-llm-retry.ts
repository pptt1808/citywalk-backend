import assert from "node:assert/strict";
import http from "node:http";

async function main() {
  let calls = 0;
  const models: string[] = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += String(chunk); });
    request.on("end", () => {
      calls += 1;
      models.push(String(JSON.parse(body).model));
      const content = calls === 1
        ? "not-json"
        : JSON.stringify({
            city: "南京",
            accessibility: {
              wheelchairAccessRequired: true,
              stepFreeRequired: true
            }
          });
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
  process.env.DEEPSEEK_PRO_API_KEY = "";
  process.env.LLM_MAX_RETRIES = "2";
  process.env.LLM_RETRY_BASE_DELAY_MS = "100";
  process.env.LLM_TIMEOUT_MS = "2000";

  try {
    const { LlmRouter } = await import("../src/llm/llmRouter");
    const result = await new LlmRouter().parseConstraints(
      "南京轮椅无障碍路线",
      { task: "南京轮椅无障碍路线", preferredModel: "flash" },
      "flash"
    );
    assert.equal(calls, 2, "格式错误的第一次响应应在同一模型上重试");
    assert.deepEqual(models, ["deepseek-v4-flash", "deepseek-v4-flash"]);
    assert.equal(result?.data.accessibility?.wheelchairAccessRequired, true);
    assert.equal(result?.model, "deepseek-v4-flash");
    console.log("PASS DeepSeek retry: malformed JSON retried on the same model");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
