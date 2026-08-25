import assert from "node:assert/strict";
import { walkSessionStore, WalkVersionConflictError } from "../src/services/walkSessionStore";

const userId = `test_walk_user_${Date.now()}`;
const base = {
  id: `walk_test_${Date.now()}`,
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  marker: "v1"
};
const replacementId = `${base.id}_replacement`;

try {
  const first = walkSessionStore.saveActive(userId, base, 0);
  assert.equal(first.version, 1);
  assert.equal(walkSessionStore.getActive<typeof base>(userId)?.walk.marker, "v1");

  const second = walkSessionStore.saveActive(userId, { ...base, marker: "v2", updatedAt: new Date().toISOString() }, 1);
  assert.equal(second.version, 2);

  assert.throws(
    () => walkSessionStore.saveActive(userId, { ...base, marker: "stale" }, 1),
    (error) => error instanceof WalkVersionConflictError && error.current.version === 2
  );

  const replacement = walkSessionStore.saveActive(userId, { ...base, id: replacementId, marker: "new-device-walk" }, 2);
  assert.equal(replacement.version, 1, "确认云端版本后应允许用更新的离线行程替换旧活动行程");
  assert.equal(walkSessionStore.getActive<typeof base>(userId)?.walk.id, replacementId);

  assert.equal(walkSessionStore.finish(userId, replacementId), true);
  assert.equal(walkSessionStore.getActive(userId), undefined);
  console.log("PASS walk session: create / version increment / stale-write conflict / offline replacement / finish cleanup");
} finally {
  walkSessionStore.finish(userId, base.id);
  walkSessionStore.finish(userId, replacementId);
}
