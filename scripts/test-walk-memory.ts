import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { MemoryService, compileWalkBehaviorCandidates } from "../src/services/memoryService";
import { MemoryStore } from "../src/services/memoryStore";
import { EmbeddingProvider } from "../src/services/embeddingService";
import { WalkBehaviorEventRecord, WalkBehaviorEventType } from "../src/services/walkSessionStore";

const now = new Date().toISOString();
let eventIndex = 0;
function event(walkId: string, eventType: WalkBehaviorEventType, payload: Record<string, unknown> = {}): WalkBehaviorEventRecord {
  return { eventId: `event_${eventIndex++}`, walkId, eventType, payload, createdAt: now };
}

const firstWalkOnly = [
  event("walk_1", "stop_completed", { category: "cafe" }),
  event("walk_1", "walk_finished", { styleTags: [{ name: "胶片感" }] })
];
assert.deepEqual(compileWalkBehaviorCandidates(firstWalkOnly), [], "一次实际行程不能被提升为长期偏好");

const repeated = [
  ...firstWalkOnly,
  event("walk_1", "route_adjusted", { reason: "tired" }),
  event("walk_1", "stop_completed", { category: "shop" }),
  event("walk_1", "stop_skipped", { category: "museum" }),
  event("walk_2", "stop_completed", { category: "cafe" }),
  event("walk_2", "route_adjusted", { reason: "rest" }),
  event("walk_2", "stop_completed", { category: "shop" }),
  event("walk_2", "stop_skipped", { category: "museum" }),
  event("walk_2", "walk_finished", { styleTags: [{ name: "胶片感" }] })
];
const candidates = compileWalkBehaviorCandidates(repeated);
assert.ok(candidates.some((item) => item.key === "preference:category:咖啡" && item.source === "system_observed"));
assert.ok(candidates.some((item) => item.key === "preference:category:特色小店" && item.source === "system_observed"));
assert.ok(candidates.some((item) => item.key === "planning:experience" && item.data.pace === "relaxed"));
assert.ok(candidates.some((item) => item.key === "preference:style"));
assert.ok(!candidates.some((item) => item.polarity === "negative"), "跳过地点可能由时间等临时因素造成，不能直接学成厌恶");

async function main() {
  const noEmbedding: EmbeddingProvider = {
    model: "test", dimensions: 2, isConfigured: () => false,
    embed: async () => [0, 0], embedBatch: async (texts) => texts.map(() => [0, 0]),
    contentHash: (text) => createHash("sha256").update(text).digest("hex")
  };
  const store = new MemoryStore(":memory:");
  const service = new MemoryService(store, noEmbedding);
  const explicit = await service.addExplicit("user_1", {
    kind: "procedural", key: "planning:experience", text: "用户明确喜欢紧凑路线",
    data: { pace: "intensive" }, confidence: 1, source: "user_explicit"
  });
  assert.equal(explicit.event, "ADD");
  const observed = await service.addExplicit("user_1", {
    kind: "procedural", key: "planning:experience", text: "观察到用户常需要休息",
    data: { pace: "relaxed" }, confidence: 0.62, source: "system_observed"
  });
  assert.equal(observed.event, "NONE", "观察行为不得覆盖用户明确确认的偏好");
  assert.equal(store.findByKey("user_1", "procedural", "planning:experience")?.data.pace, "intensive");
  store.close();

  console.log("PASS walk memory: repeated evidence / no skip dislike / explicit preference precedence");
}

void main();
