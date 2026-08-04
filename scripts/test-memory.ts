import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EmbeddingProvider } from "../src/services/embeddingService";
import { MemoryService } from "../src/services/memoryService";
import { MemoryStore } from "../src/services/memoryStore";
import { PlanRequest, UserConstraints } from "../src/types/plan";
import { emptyStyleIntent } from "../src/services/styleService";

class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly model = "test-embedding";
  readonly dimensions = 8;

  isConfigured(): boolean { return true; }
  contentHash(text: string): string { return `${this.model}:${text}`; }
  async embed(text: string): Promise<number[]> { return (await this.embedBatch([text]))[0]; }
  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const vector = Array.from({ length: this.dimensions }, () => 0);
      const groups = [
        /安静|清静|喧闹|拥挤|太吵/,
        /书店|阅读|图书/,
        /咖啡|饮品/,
        /地铁|公交|公共交通/,
        /步行|走路/,
        /室内|避雨/,
        /夜市|热闹/,
        /南京|上海/
      ];
      groups.forEach((pattern, index) => { if (pattern.test(text)) vector[index] = 1; });
      if (vector.every((value) => value === 0)) vector[7] = 0.2;
      const norm = Math.sqrt(vector.reduce((sum, value) => sum + value ** 2, 0));
      return vector.map((value) => value / norm);
    });
  }
}

function baseConstraints(): UserConstraints {
  return {
    city: "南京",
    startPoint: "新街口",
    preferences: ["书店", "咖啡"],
    peopleCount: 1,
    party: { total: 1, adults: 1, mobilityNeeds: [] },
    accessibility: {},
    experience: { pace: "normal" },
    style: emptyStyleIntent(),
    constraintLedger: [],
    transportMode: "mixed"
  };
}

async function main() {
  const store = new MemoryStore(":memory:");
  const embeddings = new FakeEmbeddingProvider();
  const service = new MemoryService(store, embeddings);
  try {
    const added = await service.addExplicit("alice", {
      kind: "semantic",
      key: "preference:category:cafe",
      text: "用户喜欢咖啡类地点",
      data: { category: "咖啡" },
      polarity: "positive"
    });
    assert.equal(added.event, "ADD");

    const duplicate = await service.addExplicit("alice", {
      kind: "semantic",
      key: "preference:category:cafe",
      text: "用户喜欢咖啡类地点",
      data: { category: "咖啡" },
      polarity: "positive"
    });
    assert.equal(duplicate.event, "NONE");

    const updated = await service.addExplicit("alice", {
      kind: "semantic",
      key: "preference:category:cafe",
      text: "用户不喜欢咖啡类地点",
      data: { category: "咖啡" },
      polarity: "negative"
    });
    assert.equal(updated.event, "UPDATE");
    assert.equal(store.list("alice").entries[0].polarity, "negative");
    assert.equal(store.getEvents(updated.memoryId!, "alice").length, 2);
    assert.equal(
      store.getEmbeddingInfo(updated.memoryId!)?.contentHash,
      embeddings.contentHash("用户不喜欢咖啡类地点"),
      "an updated memory must replace its stale embedding"
    );
    assert.equal(
      store.upsertEmbedding(
        updated.memoryId!,
        embeddings.model,
        await embeddings.embed("用户喜欢咖啡类地点"),
        embeddings.contentHash("用户喜欢咖啡类地点"),
        "用户喜欢咖啡类地点"
      ),
      false,
      "a late embedding response must not overwrite a newer memory version"
    );

    assert.equal(store.list("bob").total, 0, "memories must be isolated by user");
    assert.equal(store.getById(updated.memoryId!, "bob"), undefined, "cross-user read must fail");

    await service.addExplicit("alice", {
      kind: "procedural",
      key: "planning:transport_mode",
      text: "规划时优先使用公共交通",
      data: { transportMode: "transit" },
      polarity: "neutral"
    });
    const context = await service.recall({
      task: "周末随便逛逛",
      city: "南京",
      userId: "alice",
      threadId: "thread-1"
    });
    assert.ok(context?.recalled.some((memory) => memory.key === "planning:transport_mode"));

    const defaults = service.applyDefaults(baseConstraints(), {
      task: "周末随便逛逛", userId: "alice"
    }, context);
    assert.equal(defaults.transportMode, "transit");
    assert.ok(!defaults.preferences.includes("咖啡"), "negative category memory should remove a default preference");

    const explicitRequest: PlanRequest = {
      task: "这次尽量步行，想喝咖啡",
      transportMode: "walk",
      preferences: ["咖啡"],
      userId: "alice"
    };
    const explicit = service.applyDefaults({
      ...baseConstraints(), transportMode: "walk", preferences: ["咖啡"]
    }, explicitRequest, context);
    assert.equal(explicit.transportMode, "walk", "current turn must override procedural memory");
    assert.deepEqual(explicit.preferences, ["咖啡"], "current explicit preference must override old negative memory");

    const threadExplicit = service.applyDefaults({
      ...baseConstraints(),
      transportMode: "walk",
      transportModeExplicit: true
    }, { task: "换一家", userId: "alice", threadId: "thread-1" }, context);
    assert.equal(threadExplicit.transportMode, "walk", "recent thread instructions must override long-term procedure memory");

    const normalizedAlias = await service.addExplicit("dora", {
      kind: "semantic",
      key: "preference:category:cafe",
      text: "用户喜欢咖啡类地点",
      data: { category: "cafe" },
      polarity: "positive"
    });
    const normalizedChinese = await service.addExplicit("dora", {
      kind: "semantic",
      key: "preference:category:咖啡",
      text: "用户喜欢咖啡类地点",
      data: { category: "咖啡" },
      polarity: "positive"
    });
    assert.equal(normalizedAlias.event, "ADD");
    assert.equal(normalizedChinese.event, "NONE", "category aliases must resolve to one stable key");
    assert.equal(store.list("dora").total, 1);

    await service.addExplicit("search-user", {
      kind: "episodic",
      key: "feedback:place:南京安静书店",
      text: "用户喜欢南京的安静书店",
      data: { placeName: "安静书店", sentiment: "like" },
      city: "南京",
      polarity: "positive"
    });
    await service.addExplicit("search-user", {
      kind: "episodic",
      key: "feedback:place:上海热闹夜市",
      text: "用户不喜欢上海的热闹夜市",
      data: { placeName: "热闹夜市", sentiment: "dislike" },
      city: "上海",
      polarity: "negative"
    });
    const searchResults = store.search("search-user", "南京想找一家安静书店", "南京", 5);
    assert.equal(searchResults[0]?.key, "feedback:place:南京安静书店", "lexical and city relevance should rank matching memory first");

    const semanticMemory = await service.addExplicit("vector-user", {
      kind: "semantic",
      key: "preference:environment:quiet",
      text: "用户不喜欢喧闹拥挤的地点",
      data: { environment: "quiet" },
      polarity: "negative"
    });
    assert.equal(store.getEmbeddingInfo(semanticMemory.memoryId!)?.dimensions, 8, "embedding must be persisted");
    const semanticRecall = await service.recall({
      task: "这次给我找一条清静一点的路线",
      userId: "vector-user",
      threadId: "vector-thread"
    });
    assert.equal(semanticRecall?.recalled[0]?.key, "preference:environment:quiet");
    assert.ok(["vector", "hybrid"].includes(semanticRecall?.recalled[0]?.retrieval ?? ""));
    assert.ok((semanticRecall?.recalled[0]?.vectorScore ?? 0) > 0.8, "semantic synonym should have a high vector score");

    const pendingEvent = store.upsert("backfill-user", {
      kind: "semantic",
      key: "preference:category:bookstore",
      text: "用户喜欢书店类地点",
      data: { category: "书店" },
      polarity: "positive",
      source: "user_explicit"
    }, { reason: "create an unindexed memory for backfill test" });
    assert.equal(service.getEmbeddingStatus("backfill-user").pending, 1);
    const backfill = await service.backfillEmbeddings("backfill-user", 10);
    assert.equal(backfill.indexedNow, 1);
    assert.equal(backfill.pending, 0);
    assert.equal(store.getEmbeddingInfo(pendingEvent.memoryId)?.model, embeddings.model);

    const feedback = await service.recordPlaceFeedback({
      userId: "alice", city: "南京", placeName: "测试咖啡馆", sentiment: "dislike", comment: "太吵"
    });
    assert.equal(feedback.event, "ADD");
    assert.equal(store.getById(feedback.memoryId!, "alice")?.kind, "episodic");

    const beforeOneOff = store.list("charlie").total;
    await service.learnFromPlanning({
      task: "南京从新街口出发，今天想喝咖啡，预算100元",
      userId: "charlie",
      threadId: "thread-one-off"
    }, {
      summary: "推荐测试咖啡馆",
      totalEstimatedCost: 40,
      totalEstimatedMinutes: 60,
      stops: [],
      decisionLog: []
    });
    assert.equal(store.list("charlie").total, beforeOneOff, "one-off requests must not become durable preferences");
    assert.equal(store.getRecentMessages("charlie", "thread-one-off").length, 2, "conversation turns should remain available as short-term memory");

    await service.learnFromPlanning({
      task: "一家三口带6岁孩子，从新街口出发，安排一条轻松、有休息点的亲子路线",
      userId: "charlie",
      threadId: "thread-one-off-family"
    }, {
      summary: "生成一条本次亲子路线",
      totalEstimatedCost: 100,
      totalEstimatedMinutes: 180,
      stops: [],
      decisionLog: []
    });
    assert.equal(store.list("charlie").total, beforeOneOff, "one-off family constraints must not become durable preferences");
    assert.equal(store.getRecentMessages("charlie", "thread-one-off-family").length, 2, "one-off family constraints should remain in conversation memory");

    await service.learnFromPlanning({
      task: "帮我生成一条路线\n<citywalk_ui_context>\n若本轮没有相反要求，可参考用户默认偏好：默认轻松慢走、亲子友好。\n</citywalk_ui_context>",
      userId: "charlie",
      threadId: "thread-ui-defaults"
    }, {
      summary: "按界面默认项生成路线",
      totalEstimatedCost: 100,
      totalEstimatedMinutes: 180,
      stops: [],
      decisionLog: []
    });
    assert.equal(store.list("charlie").total, beforeOneOff, "UI defaults must not become learned long-term memories");
    assert.equal(store.getRecentMessages("charlie", "thread-ui-defaults")[0]?.content, "帮我生成一条路线", "conversation memory must store only the user-authored message");

    const learned = await service.learnFromPlanning({
      task: "记住我以后喜欢逛书店",
      userId: "charlie",
      threadId: "thread-durable"
    }, {
      summary: "好的",
      totalEstimatedCost: 0,
      totalEstimatedMinutes: 0,
      stops: [],
      decisionLog: []
    });
    assert.ok(learned.events.some((event) => event.event === "ADD" && event.candidate?.key === "preference:category:书店"));

    const deleted = await service.addExplicit("alice", {
      kind: "semantic",
      key: "preference:category:cafe",
      text: "忘记咖啡偏好",
      actionHint: "DELETE"
    });
    assert.equal(deleted.event, "DELETE");
    assert.equal(store.list("alice").entries.some((memory) => memory.key === "preference:category:cafe"), false);
    assert.equal(store.getEmbeddingInfo(deleted.memoryId!), undefined, "deleting a memory must delete its embedding");

    console.log("PASS memory pipeline: mutations / hybrid recall / backfill / isolation / precedence / feedback");
  } finally {
    store.close();
  }

  const persistentDir = mkdtempSync(join(tmpdir(), "citywalk-memory-"));
  const persistentDb = join(persistentDir, "memory.sqlite");
  try {
    const firstStore = new MemoryStore(persistentDb);
    const firstService = new MemoryService(firstStore, new FakeEmbeddingProvider());
    await firstService.addExplicit("persistent-user", {
      kind: "procedural",
      key: "planning:transport_mode",
      text: "规划时优先步行",
      data: { transportMode: "walk" },
      polarity: "neutral"
    });
    firstStore.close();

    const reopenedStore = new MemoryStore(persistentDb);
    assert.equal(reopenedStore.list("persistent-user").total, 1, "memory must survive a database restart");
    assert.equal(reopenedStore.findByKey("persistent-user", "procedural", "planning:transport_mode")?.text, "规划时优先步行");
    assert.equal(reopenedStore.getEmbeddingInfo(
      reopenedStore.findByKey("persistent-user", "procedural", "planning:transport_mode")!.id
    )?.model, "test-embedding", "embedding must survive a database restart");
    reopenedStore.close();
    console.log("PASS memory persistence: SQLite close / reopen");
  } finally {
    rmSync(persistentDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
