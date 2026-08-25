import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { env } from "../config/env";

const dbPath = path.resolve(process.cwd(), env.JOURNAL_SYNC_DB_PATH);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS synced_journals (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_synced_journals_user_updated
    ON synced_journals(user_id, updated_at DESC);
`);

type JournalRow = { payload_json: string };

export const journalSyncStore = {
  list<T = unknown>(userId: string): T[] {
    const rows = db.prepare("SELECT payload_json FROM synced_journals WHERE user_id = ? ORDER BY updated_at DESC")
      .all(userId) as JournalRow[];
    return rows.map((row) => JSON.parse(row.payload_json) as T);
  },

  save<T extends { id: string; createdAt: string; updatedAt: string }>(userId: string, entry: T): T {
    const payload = JSON.stringify(entry);
    if (Buffer.byteLength(payload, "utf8") > 25_000_000) throw new Error("JOURNAL_PAYLOAD_TOO_LARGE");
    db.prepare(`
      INSERT INTO synced_journals(id, user_id, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id, user_id) DO UPDATE SET
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `).run(entry.id, userId, payload, entry.createdAt, entry.updatedAt);
    return entry;
  },

  delete(userId: string, id: string): boolean {
    return db.prepare("DELETE FROM synced_journals WHERE user_id = ? AND id = ?").run(userId, id).changes > 0;
  }
};
