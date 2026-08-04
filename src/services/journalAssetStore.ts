import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { env } from "../config/env";

export interface JournalIllustrationAsset {
  id: string;
  userId: string;
  cacheKey: string;
  model: string;
  prompt: string;
  styleDescription: string;
  mimeType: string;
  filePath: string;
  createdAt: string;
}

type AssetRow = {
  id: string;
  user_id: string;
  cache_key: string;
  model: string;
  prompt: string;
  style_description: string;
  mime_type: string;
  file_name: string;
  created_at: string;
};

const rootDir = path.resolve(process.cwd(), env.JOURNAL_ASSET_DIR);
const dbPath = path.resolve(process.cwd(), env.JOURNAL_ASSET_DB_PATH);
fs.mkdirSync(rootDir, { recursive: true });
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS journal_illustration_assets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    cache_key TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt TEXT NOT NULL,
    style_description TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, cache_key)
  );
  CREATE INDEX IF NOT EXISTS idx_journal_asset_user_created
    ON journal_illustration_assets(user_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS journal_illustration_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_journal_usage_user_created
    ON journal_illustration_usage(user_id, created_at DESC);
`);

function fileExtension(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

function absoluteAssetPath(fileName: string): string | undefined {
  const resolved = path.resolve(rootDir, fileName);
  return resolved === rootDir || resolved.startsWith(`${rootDir}${path.sep}`) ? resolved : undefined;
}

function fromRow(row: AssetRow): JournalIllustrationAsset | undefined {
  const filePath = absoluteAssetPath(row.file_name);
  if (!filePath || !fs.existsSync(filePath)) return undefined;
  return {
    id: row.id,
    userId: row.user_id,
    cacheKey: row.cache_key,
    model: row.model,
    prompt: row.prompt,
    styleDescription: row.style_description,
    mimeType: row.mime_type,
    filePath,
    createdAt: row.created_at
  };
}

function userDirectory(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").slice(0, 20);
}

export const journalAssetStore = {
  getByCacheKey(userId: string, cacheKey: string): JournalIllustrationAsset | undefined {
    const row = db.prepare(`
      SELECT * FROM journal_illustration_assets WHERE user_id = ? AND cache_key = ?
    `).get(userId, cacheKey) as AssetRow | undefined;
    const asset = row ? fromRow(row) : undefined;
    if (row && !asset) db.prepare("DELETE FROM journal_illustration_assets WHERE id = ?").run(row.id);
    return asset;
  },

  getById(userId: string, id: string): JournalIllustrationAsset | undefined {
    const row = db.prepare(`
      SELECT * FROM journal_illustration_assets WHERE id = ? AND user_id = ?
    `).get(id, userId) as AssetRow | undefined;
    const asset = row ? fromRow(row) : undefined;
    if (row && !asset) db.prepare("DELETE FROM journal_illustration_assets WHERE id = ?").run(row.id);
    return asset;
  },

  countUsageSince(userId: string, since: string): number {
    const row = db.prepare(`
      SELECT COUNT(*) AS count FROM journal_illustration_usage
      WHERE user_id = ? AND created_at >= ?
    `).get(userId, since) as { count: number };
    return Number(row.count) || 0;
  },

  save(input: {
    userId: string;
    cacheKey: string;
    model: string;
    prompt: string;
    styleDescription: string;
    mimeType: string;
    bytes: Buffer;
  }): JournalIllustrationAsset {
    const existing = this.getByCacheKey(input.userId, input.cacheKey);
    if (existing) return existing;

    const id = `ill_${randomUUID()}`;
    const directory = userDirectory(input.userId);
    const fileName = path.join(directory, `${id}.${fileExtension(input.mimeType)}`);
    const filePath = absoluteAssetPath(fileName);
    if (!filePath) throw new Error("Invalid journal asset path");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, input.bytes, { flag: "wx" });
    fs.renameSync(temporary, filePath);

    const createdAt = new Date().toISOString();
    try {
      db.transaction(() => {
        db.prepare(`
          INSERT INTO journal_illustration_assets
            (id, user_id, cache_key, model, prompt, style_description, mime_type, file_name, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          input.userId,
          input.cacheKey,
          input.model,
          input.prompt,
          input.styleDescription,
          input.mimeType,
          fileName,
          createdAt
        );
        db.prepare(`
          INSERT INTO journal_illustration_usage (user_id, model, created_at) VALUES (?, ?, ?)
        `).run(input.userId, input.model, createdAt);
      })();
    } catch (error) {
      fs.rmSync(filePath, { force: true });
      const concurrent = this.getByCacheKey(input.userId, input.cacheKey);
      if (concurrent) return concurrent;
      throw error;
    }

    return {
      id,
      userId: input.userId,
      cacheKey: input.cacheKey,
      model: input.model,
      prompt: input.prompt,
      styleDescription: input.styleDescription,
      mimeType: input.mimeType,
      filePath,
      createdAt
    };
  },

  delete(userId: string, id: string): boolean {
    const row = db.prepare(`
      SELECT * FROM journal_illustration_assets WHERE id = ? AND user_id = ?
    `).get(id, userId) as AssetRow | undefined;
    if (!row) return false;
    db.prepare("DELETE FROM journal_illustration_assets WHERE id = ? AND user_id = ?").run(id, userId);
    const filePath = absoluteAssetPath(row.file_name);
    if (filePath) fs.rmSync(filePath, { force: true });
    return true;
  }
};
