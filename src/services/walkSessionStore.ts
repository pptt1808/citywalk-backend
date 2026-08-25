import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { env } from "../config/env";

export type WalkBehaviorEventType =
  | "walk_started"
  | "moment_added"
  | "stop_completed"
  | "stop_skipped"
  | "route_adjusted"
  | "route_adjustment_undone"
  | "walk_finished";

export interface WalkSessionRecord<T = unknown> {
  walk: T;
  version: number;
  updatedAt: string;
}

export interface WalkBehaviorEventRecord {
  eventId: string;
  walkId: string;
  eventType: WalkBehaviorEventType;
  payload: Record<string, unknown>;
  createdAt: string;
}

export class WalkVersionConflictError extends Error {
  constructor(readonly current: WalkSessionRecord) {
    super("WALK_VERSION_CONFLICT");
    this.name = "WalkVersionConflictError";
  }
}

type SessionRow = { walk_id: string; payload_json: string; version: number; updated_at: string };

const dbPath = path.resolve(process.cwd(), env.WALK_DB_PATH);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS active_walks (
    user_id TEXT PRIMARY KEY,
    walk_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    version INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_active_walk_id ON active_walks(walk_id);
  CREATE TABLE IF NOT EXISTS walk_behavior_events (
    event_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    walk_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_walk_events_user_time ON walk_behavior_events(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_walk_events_walk ON walk_behavior_events(walk_id, created_at);
  CREATE TABLE IF NOT EXISTS mobile_route_handoffs (
    user_id TEXT PRIMARY KEY,
    handoff_id TEXT NOT NULL,
    route_json TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL,
    claimed_at TEXT
  );
`);

function sessionFromRow<T>(row: SessionRow): WalkSessionRecord<T> {
  return { walk: JSON.parse(row.payload_json) as T, version: row.version, updatedAt: row.updated_at };
}

export const walkSessionStore = {
  getActive<T = unknown>(userId: string): WalkSessionRecord<T> | undefined {
    const row = db.prepare("SELECT walk_id, payload_json, version, updated_at FROM active_walks WHERE user_id = ?")
      .get(userId) as SessionRow | undefined;
    return row ? sessionFromRow<T>(row) : undefined;
  },

  saveActive<T extends { id: string; startedAt: string }>(userId: string, walk: T, baseVersion?: number): WalkSessionRecord<T> {
    const payload = JSON.stringify(walk);
    if (Buffer.byteLength(payload, "utf8") > 20_000_000) throw new Error("WALK_PAYLOAD_TOO_LARGE");
    const transaction = db.transaction(() => {
      const currentRow = db.prepare("SELECT walk_id, payload_json, version, updated_at FROM active_walks WHERE user_id = ?")
        .get(userId) as SessionRow | undefined;
      if (currentRow && baseVersion !== undefined && currentRow.version !== baseVersion) {
        throw new WalkVersionConflictError(sessionFromRow(currentRow));
      }
      const version = currentRow?.walk_id === walk.id ? currentRow.version + 1 : 1;
      const updatedAt = new Date().toISOString();
      db.prepare(`
        INSERT INTO active_walks(user_id, walk_id, payload_json, version, started_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          walk_id = excluded.walk_id,
          payload_json = excluded.payload_json,
          version = excluded.version,
          started_at = excluded.started_at,
          updated_at = excluded.updated_at
      `).run(userId, walk.id, payload, version, walk.startedAt, updatedAt);
      return { walk, version, updatedAt };
    });
    return transaction();
  },

  finish(userId: string, walkId: string): boolean {
    return db.prepare("DELETE FROM active_walks WHERE user_id = ? AND walk_id = ?").run(userId, walkId).changes > 0;
  },

  recordEvent(input: {
    eventId: string;
    userId: string;
    walkId: string;
    eventType: WalkBehaviorEventType;
    payload: Record<string, unknown>;
    createdAt: string;
  }): boolean {
    return db.prepare(`
      INSERT OR IGNORE INTO walk_behavior_events(event_id, user_id, walk_id, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(input.eventId, input.userId, input.walkId, input.eventType, JSON.stringify(input.payload), input.createdAt).changes > 0;
  },

  listEvents(userId: string, limit = 200): WalkBehaviorEventRecord[] {
    const rows = db.prepare(`
      SELECT event_id, walk_id, event_type, payload_json, created_at
      FROM walk_behavior_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(userId, Math.max(1, Math.min(1000, limit))) as Array<{
      event_id: string; walk_id: string; event_type: WalkBehaviorEventType; payload_json: string; created_at: string;
    }>;
    return rows.map((row) => ({
      eventId: row.event_id,
      walkId: row.walk_id,
      eventType: row.event_type,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
      createdAt: row.created_at
    }));
  },

  getHandoff<T = unknown>(userId: string): { id: string; route: T; source: string; createdAt: string; claimedAt?: string } | undefined {
    const row = db.prepare(`
      SELECT handoff_id, route_json, source, created_at, claimed_at
      FROM mobile_route_handoffs WHERE user_id = ?
    `).get(userId) as { handoff_id: string; route_json: string; source: string; created_at: string; claimed_at?: string } | undefined;
    return row ? {
      id: row.handoff_id,
      route: JSON.parse(row.route_json) as T,
      source: row.source,
      createdAt: row.created_at,
      claimedAt: row.claimed_at || undefined
    } : undefined;
  },

  saveHandoff<T>(userId: string, input: { id: string; route: T; source: string; createdAt: string }) {
    db.prepare(`
      INSERT INTO mobile_route_handoffs(user_id, handoff_id, route_json, source, created_at, claimed_at)
      VALUES (?, ?, ?, ?, ?, NULL)
      ON CONFLICT(user_id) DO UPDATE SET
        handoff_id = excluded.handoff_id,
        route_json = excluded.route_json,
        source = excluded.source,
        created_at = excluded.created_at,
        claimed_at = NULL
    `).run(userId, input.id, JSON.stringify(input.route), input.source, input.createdAt);
    return { ...input };
  },

  claimHandoff<T = unknown>(userId: string, handoffId: string): { id: string; route: T; source: string; createdAt: string; claimedAt: string } | undefined {
    const transaction = db.transaction(() => {
      const current = this.getHandoff<T>(userId);
      if (!current || current.id !== handoffId || current.claimedAt) return undefined;
      const claimedAt = new Date().toISOString();
      db.prepare("UPDATE mobile_route_handoffs SET claimed_at = ? WHERE user_id = ? AND handoff_id = ?")
        .run(claimedAt, userId, handoffId);
      return { ...current, claimedAt };
    });
    return transaction();
  },

  clearHandoff(userId: string, handoffId?: string): boolean {
    const result = handoffId
      ? db.prepare("DELETE FROM mobile_route_handoffs WHERE user_id = ? AND handoff_id = ?").run(userId, handoffId)
      : db.prepare("DELETE FROM mobile_route_handoffs WHERE user_id = ?").run(userId);
    return result.changes > 0;
  }
};
