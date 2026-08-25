import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { journalSyncStore } from "../src/services/journalSyncStore";
import { walkSessionStore } from "../src/services/walkSessionStore";

const userId = `test_mobile_${randomUUID()}`;
const now = new Date().toISOString();
const route = {
  title: "移动端契约测试路线",
  summary: "route handoff contract",
  responseKind: "route" as const,
  totalEstimatedCost: 0,
  totalEstimatedMinutes: 60,
  stops: [{ name: "测试地点", category: "sight", estimatedCost: 0, estimatedStayMinutes: 30, reason: "contract", location: "118.7,32.0" }],
  constraints: { city: "南京", startPoint: "测试起点" },
  decisionLog: []
};

const handoffId = `handoff_${randomUUID()}`;
const journalId = `journal_${randomUUID()}`;

try {
  const saved = walkSessionStore.saveHandoff(userId, { id: handoffId, route, source: "web", createdAt: now });
  assert.equal(saved.id, handoffId);
  assert.equal(walkSessionStore.getHandoff<typeof route>(userId)?.route.title, route.title);
  const claimed = walkSessionStore.claimHandoff<typeof route>(userId, handoffId);
  assert.ok(claimed?.claimedAt);
  assert.equal(walkSessionStore.claimHandoff(userId, handoffId), undefined, "同一接力不可重复领取");

  const journal = {
    id: journalId,
    title: route.title,
    city: "南京",
    route,
    journey: { walkId: "walk_contract", startedAt: now, completedAt: now, durationMs: 1 },
    note: "first",
    photos: [], blocks: [], spreads: [], moments: [], selectedStops: ["测试地点"], aiCaption: "",
    createdAt: now, updatedAt: now
  };
  journalSyncStore.save(userId, journal);
  assert.equal(journalSyncStore.list<typeof journal>(userId).length, 1);
  journalSyncStore.save(userId, { ...journal, note: "updated", updatedAt: new Date(Date.now() + 1000).toISOString() });
  assert.equal(journalSyncStore.list<typeof journal>(userId)[0].note, "updated", "同一手账应使用更新版本覆盖");
  assert.equal(journalSyncStore.delete(userId, journalId), true);
  assert.equal(journalSyncStore.list(userId).length, 0);

  console.log("PASS mobile sync: route handoff / single claim / journal upsert / delete");
} finally {
  walkSessionStore.clearHandoff(userId);
  journalSyncStore.delete(userId, journalId);
}
