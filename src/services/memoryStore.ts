import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  ConversationMemoryMessage,
  MemoryCandidate,
  MemoryEvent,
  MemoryItem,
  MemoryKind,
  RecalledMemory
} from "../types/memory";

type MemoryRow = {
  id: string;
  user_id: string;
  kind: MemoryKind;
  memory_key: string;
  text: string;
  data_json: string;
  city: string | null;
  polarity: MemoryItem["polarity"];
  confidence: number;
  source: MemoryItem["source"];
  status: MemoryItem["status"];
  created_at: string;
  updated_at: string;
  last_accessed_at: string | null;
  access_count: number;
  expires_at: string | null;
};

type MessageRow = {
  id: string;
  user_id: string;
  thread_id: string;
  role: ConversationMemoryMessage["role"];
  content: string;
  created_at: string;
};

type VectorMemoryRow = MemoryRow & {
  embedding: Buffer;
  embedding_model: string;
  dimensions: number;
};

export interface StoredEmbeddingInfo {
  memoryId: string;
  model: string;
  dimensions: number;
  contentHash: string;
  updatedAt: string;
}

export interface EmbeddingRefreshCandidate {
  memory: MemoryItem;
  embedding?: StoredEmbeddingInfo;
}

export interface EmbeddingStats {
  totalActive: number;
  indexed: number;
  pending: number;
}

export interface ListMemoriesOptions {
  kind?: MemoryKind;
  city?: string;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
}

export interface UpsertMemoryOptions {
  threadId?: string;
  reason: string;
}

function safeJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function normalizeText(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, " ");
}

function recallTokens(value: string): Set<string> {
  const normalized = normalizeText(value);
  const tokens = new Set<string>();
  for (const word of normalized.match(/[a-z0-9]+/g) ?? []) {
    tokens.add(word);
  }
  const chinese = normalized.replace(/[^\u3400-\u9fff]/g, "");
  for (const char of chinese) tokens.add(char);
  for (let index = 0; index < chinese.length - 1; index += 1) {
    tokens.add(chinese.slice(index, index + 2));
  }
  return tokens;
}

function overlapScore(query: Set<string>, document: Set<string>): number {
  if (query.size === 0 || document.size === 0) return 0;
  let matches = 0;
  for (const token of query) {
    if (document.has(token)) matches += token.length > 1 ? 2 : 0.35;
  }
  return Math.min(1, matches / Math.max(2, query.size * 0.45));
}

function encodeEmbedding(vector: number[]): Buffer {
  const buffer = Buffer.allocUnsafe(vector.length * Float32Array.BYTES_PER_ELEMENT);
  for (let index = 0; index < vector.length; index += 1) {
    buffer.writeFloatLE(vector[index], index * Float32Array.BYTES_PER_ELEMENT);
  }
  return buffer;
}

function decodeEmbedding(buffer: Buffer, dimensions: number): Float32Array | undefined {
  if (buffer.length !== dimensions * Float32Array.BYTES_PER_ELEMENT) return undefined;
  const vector = new Float32Array(dimensions);
  for (let index = 0; index < dimensions; index += 1) {
    vector[index] = buffer.readFloatLE(index * Float32Array.BYTES_PER_ELEMENT);
  }
  return vector;
}

function cosineSimilarity(left: ArrayLike<number>, right: ArrayLike<number>): number {
  if (left.length !== right.length || left.length === 0) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export class MemoryStore {
  private readonly db: Database.Database;

  constructor(dbPath = path.resolve(process.cwd(), "data", "memory.sqlite")) {
    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.init();
  }

  close(): void {
    this.db.close();
  }

  getById(memoryId: string, userId?: string): MemoryItem | undefined {
    const row = userId
      ? this.db.prepare("SELECT * FROM memories WHERE id = ? AND user_id = ?").get(memoryId, userId) as MemoryRow | undefined
      : this.db.prepare("SELECT * FROM memories WHERE id = ?").get(memoryId) as MemoryRow | undefined;
    return row ? this.toMemory(row) : undefined;
  }

  findByKey(userId: string, kind: MemoryKind, key: string): MemoryItem | undefined {
    const row = this.db.prepare(
      "SELECT * FROM memories WHERE user_id = ? AND kind = ? AND memory_key = ?"
    ).get(userId, kind, key) as MemoryRow | undefined;
    return row ? this.toMemory(row) : undefined;
  }

  list(userId: string, options: ListMemoriesOptions = {}): { entries: MemoryItem[]; total: number } {
    const where = ["user_id = ?"];
    const params: Array<string | number> = [userId];
    if (!options.includeDeleted) where.push("status = 'active'");
    if (options.kind) {
      where.push("kind = ?");
      params.push(options.kind);
    }
    if (options.city) {
      where.push("(city = ? OR city IS NULL)");
      params.push(options.city);
    }
    const clause = where.join(" AND ");
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS count FROM memories WHERE ${clause}`).get(...params) as { count: number }).count);
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const offset = Math.max(options.offset ?? 0, 0);
    const rows = this.db.prepare(
      `SELECT * FROM memories WHERE ${clause} ORDER BY updated_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as MemoryRow[];
    return { entries: rows.map((row) => this.toMemory(row)), total };
  }

  search(userId: string, query: string, city?: string, limit = 8, touchResults = true): RecalledMemory[] {
    const now = new Date().toISOString();
    const rows = this.db.prepare(
      `SELECT * FROM memories
       WHERE user_id = ? AND status = 'active'
         AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY updated_at DESC LIMIT 500`
    ).all(userId, now) as MemoryRow[];
    const queryTokens = recallTokens(`${query} ${city ?? ""}`);

    const recalled = rows
      .map((row) => {
        const memory = this.toMemory(row);
        const lexical = overlapScore(queryTokens, recallTokens(`${memory.text} ${memory.key} ${memory.city ?? ""}`));
        const cityScore = !memory.city ? 0.05 : memory.city === city ? 0.2 : -0.2;
        const kindScore = memory.kind === "procedural" ? 0.15 : memory.kind === "semantic" ? 0.08 : 0;
        const sourceScore = ["user_explicit", "user_feedback"].includes(memory.source) ? 0.08 : 0;
        const score = Math.max(0, Math.min(1, lexical * 0.55 + memory.confidence * 0.25 + cityScore + kindScore + sourceScore));
        return { ...memory, score };
      })
      .filter((memory) => memory.score >= 0.28)
      .sort((left, right) => right.score - left.score || right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, Math.min(Math.max(limit, 1), 20))
      .map<RecalledMemory>((memory) => ({
        id: memory.id,
        kind: memory.kind,
        key: memory.key,
        text: memory.text,
        data: memory.data,
        city: memory.city,
        polarity: memory.polarity,
        confidence: memory.confidence,
        source: memory.source,
        score: Number(memory.score.toFixed(4)),
        retrieval: "lexical",
        lexicalScore: Number(memory.score.toFixed(4))
      }));

    if (touchResults) this.markAccessed(recalled.map((memory) => memory.id), now);
    return recalled;
  }

  upsertEmbedding(
    memoryId: string,
    model: string,
    vector: number[],
    contentHash: string,
    expectedText: string
  ): boolean {
    const now = new Date().toISOString();
    const result = this.db.prepare(
      `INSERT INTO memory_embeddings (memory_id, model, dimensions, embedding, content_hash, created_at, updated_at)
       SELECT id, ?, ?, ?, ?, ?, ? FROM memories
       WHERE id = ? AND text = ? AND status = 'active'
       ON CONFLICT(memory_id) DO UPDATE SET model = excluded.model, dimensions = excluded.dimensions,
         embedding = excluded.embedding, content_hash = excluded.content_hash, updated_at = excluded.updated_at`
    ).run(model, vector.length, encodeEmbedding(vector), contentHash, now, now, memoryId, expectedText);
    return result.changes > 0;
  }

  getEmbeddingInfo(memoryId: string): StoredEmbeddingInfo | undefined {
    const row = this.db.prepare(
      "SELECT memory_id, model, dimensions, content_hash, updated_at FROM memory_embeddings WHERE memory_id = ?"
    ).get(memoryId) as {
      memory_id: string; model: string; dimensions: number; content_hash: string; updated_at: string;
    } | undefined;
    return row ? {
      memoryId: row.memory_id,
      model: row.model,
      dimensions: row.dimensions,
      contentHash: row.content_hash,
      updatedAt: row.updated_at
    } : undefined;
  }

  deleteEmbedding(memoryId: string): void {
    this.db.prepare("DELETE FROM memory_embeddings WHERE memory_id = ?").run(memoryId);
  }

  listEmbeddingRefreshCandidates(
    userId: string,
    model: string,
    dimensions: number,
    limit = 32
  ): EmbeddingRefreshCandidate[] {
    const rows = this.db.prepare(
      `SELECT m.*, e.memory_id AS embedding_memory_id, e.model AS embedding_model,
         e.dimensions AS embedding_dimensions, e.content_hash AS embedding_content_hash,
         e.updated_at AS embedding_updated_at
       FROM memories m
       LEFT JOIN memory_embeddings e ON e.memory_id = m.id
       WHERE m.user_id = ? AND m.status = 'active'
         AND (m.expires_at IS NULL OR m.expires_at > ?)
         AND (e.memory_id IS NULL OR e.model != ? OR e.dimensions != ? OR e.updated_at < m.updated_at)
       ORDER BY m.updated_at DESC LIMIT ?`
    ).all(userId, new Date().toISOString(), model, dimensions, Math.min(Math.max(limit, 1), 500)) as Array<MemoryRow & {
      embedding_memory_id: string | null;
      embedding_model: string | null;
      embedding_dimensions: number | null;
      embedding_content_hash: string | null;
      embedding_updated_at: string | null;
    }>;
    return rows.map((row) => ({
      memory: this.toMemory(row),
      embedding: row.embedding_memory_id && row.embedding_model && row.embedding_dimensions
        && row.embedding_content_hash && row.embedding_updated_at
        ? {
            memoryId: row.embedding_memory_id,
            model: row.embedding_model,
            dimensions: row.embedding_dimensions,
            contentHash: row.embedding_content_hash,
            updatedAt: row.embedding_updated_at
          }
        : undefined
    }));
  }

  getEmbeddingStats(userId: string, model: string, dimensions: number): EmbeddingStats {
    const now = new Date().toISOString();
    const row = this.db.prepare(
      `SELECT COUNT(*) AS total_active,
         COALESCE(SUM(CASE WHEN e.model = ? AND e.dimensions = ? AND e.updated_at >= m.updated_at THEN 1 ELSE 0 END), 0) AS indexed
       FROM memories m LEFT JOIN memory_embeddings e ON e.memory_id = m.id
       WHERE m.user_id = ? AND m.status = 'active'
         AND (m.expires_at IS NULL OR m.expires_at > ?)`
    ).get(model, dimensions, userId, now) as { total_active: number; indexed: number };
    const totalActive = Number(row.total_active);
    const indexed = Number(row.indexed);
    return { totalActive, indexed, pending: Math.max(0, totalActive - indexed) };
  }

  searchVector(
    userId: string,
    queryVector: number[],
    model: string,
    city?: string,
    limit = 32
  ): RecalledMemory[] {
    const rows = this.db.prepare(
      `SELECT m.*, e.embedding, e.model AS embedding_model, e.dimensions
       FROM memories m JOIN memory_embeddings e ON e.memory_id = m.id
       WHERE m.user_id = ? AND m.status = 'active' AND e.model = ? AND e.dimensions = ?
         AND (m.expires_at IS NULL OR m.expires_at > ?)
       ORDER BY m.updated_at DESC LIMIT 2000`
    ).all(userId, model, queryVector.length, new Date().toISOString()) as VectorMemoryRow[];

    return rows.flatMap((row): RecalledMemory[] => {
      const storedVector = decodeEmbedding(row.embedding, row.dimensions);
      if (!storedVector) return [];
      const cosine = cosineSimilarity(queryVector, storedVector);
      if (!Number.isFinite(cosine)) return [];
      const memory = this.toMemory(row);
      const cityAdjustment = !memory.city ? 0.02 : memory.city === city ? 0.05 : -0.08;
      const score = Math.max(0, Math.min(1, cosine + cityAdjustment));
      return [{
        id: memory.id,
        kind: memory.kind,
        key: memory.key,
        text: memory.text,
        data: memory.data,
        city: memory.city,
        polarity: memory.polarity,
        confidence: memory.confidence,
        source: memory.source,
        score: Number(score.toFixed(4)),
        retrieval: "vector",
        vectorScore: Number(cosine.toFixed(4))
      }];
    }).filter((memory) => memory.score >= 0.2)
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.min(Math.max(limit, 1), 100));
  }

  markAccessed(memoryIds: string[], at = new Date().toISOString()): void {
    const uniqueIds = [...new Set(memoryIds)];
    if (uniqueIds.length === 0) return;
    const statement = this.db.prepare(
      "UPDATE memories SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?"
    );
    const transaction = this.db.transaction(() => {
      for (const memoryId of uniqueIds) statement.run(at, memoryId);
    });
    transaction();
  }

  upsert(userId: string, candidate: MemoryCandidate, options: UpsertMemoryOptions): MemoryEvent {
    const existing = this.findByKey(userId, candidate.kind, candidate.key);
    const now = new Date().toISOString();
    const next: MemoryItem = {
      id: existing?.id ?? randomUUID(),
      userId,
      kind: candidate.kind,
      key: candidate.key,
      text: candidate.text,
      data: candidate.data ?? {},
      city: candidate.city,
      polarity: candidate.polarity ?? "neutral",
      confidence: Math.max(0, Math.min(1, candidate.confidence ?? 0.8)),
      source: candidate.source ?? "inferred",
      status: "active",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastAccessedAt: existing?.lastAccessedAt,
      accessCount: existing?.accessCount ?? 0,
      expiresAt: existing?.expiresAt
    };
    const action = existing && existing.status === "active" ? "UPDATE" as const : "ADD" as const;
    const event = this.buildEvent(userId, next.id, action, existing, next, options);

    const transaction = this.db.transaction(() => {
      this.db.prepare(
        `INSERT INTO memories (
          id, user_id, kind, memory_key, text, data_json, city, polarity, confidence,
          source, status, created_at, updated_at, last_accessed_at, access_count, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, kind, memory_key) DO UPDATE SET
          text = excluded.text, data_json = excluded.data_json, city = excluded.city,
          polarity = excluded.polarity, confidence = excluded.confidence, source = excluded.source,
          status = 'active', updated_at = excluded.updated_at, expires_at = excluded.expires_at`
      ).run(
        next.id, next.userId, next.kind, next.key, next.text, JSON.stringify(next.data), next.city ?? null,
        next.polarity, next.confidence, next.source, next.status, next.createdAt, next.updatedAt,
        next.lastAccessedAt ?? null, next.accessCount, next.expiresAt ?? null
      );
      if (existing) this.db.prepare("DELETE FROM memory_embeddings WHERE memory_id = ?").run(next.id);
      this.insertEvent(event);
    });
    transaction();
    return event;
  }

  updateById(memoryId: string, userId: string, candidate: MemoryCandidate, options: UpsertMemoryOptions): MemoryEvent {
    const existing = this.getById(memoryId, userId);
    if (!existing) throw new Error("Memory to update does not exist");
    if (existing.kind !== candidate.kind || existing.key !== candidate.key) {
      throw new Error("Memory identity cannot be changed during update");
    }
    const now = new Date().toISOString();
    const next: MemoryItem = {
      ...existing,
      text: candidate.text,
      data: candidate.data ?? {},
      city: candidate.city,
      polarity: candidate.polarity ?? "neutral",
      confidence: Math.max(0, Math.min(1, candidate.confidence ?? 0.8)),
      source: candidate.source ?? "inferred",
      status: "active",
      updatedAt: now
    };
    const action = existing.status === "active" ? "UPDATE" as const : "ADD" as const;
    const event = this.buildEvent(userId, memoryId, action, existing, next, options);
    const transaction = this.db.transaction(() => {
      this.db.prepare(
        `UPDATE memories SET text = ?, data_json = ?, city = ?, polarity = ?, confidence = ?,
         source = ?, status = 'active', updated_at = ? WHERE id = ? AND user_id = ?`
      ).run(
        next.text, JSON.stringify(next.data), next.city ?? null, next.polarity,
        next.confidence, next.source, next.updatedAt, memoryId, userId
      );
      this.db.prepare("DELETE FROM memory_embeddings WHERE memory_id = ?").run(memoryId);
      this.insertEvent(event);
    });
    transaction();
    return event;
  }

  delete(memoryId: string, userId: string, reason: string, threadId?: string): MemoryEvent | undefined {
    const existing = this.getById(memoryId, userId);
    if (!existing || existing.status === "deleted") return undefined;
    const now = new Date().toISOString();
    const deleted: MemoryItem = { ...existing, status: "deleted", updatedAt: now };
    const event = this.buildEvent(userId, memoryId, "DELETE", existing, deleted, { reason, threadId });
    const transaction = this.db.transaction(() => {
      this.db.prepare("UPDATE memories SET status = 'deleted', updated_at = ? WHERE id = ? AND user_id = ?")
        .run(now, memoryId, userId);
      this.db.prepare("DELETE FROM memory_embeddings WHERE memory_id = ?").run(memoryId);
      this.insertEvent(event);
    });
    transaction();
    return event;
  }

  saveMessages(
    userId: string,
    threadId: string,
    messages: Array<{ role: ConversationMemoryMessage["role"]; content: string }>
  ): void {
    if (messages.length === 0) return;
    const insert = this.db.prepare(
      "INSERT INTO memory_messages (id, user_id, thread_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const evict = this.db.prepare(
      `DELETE FROM memory_messages WHERE user_id = ? AND thread_id = ? AND id NOT IN (
        SELECT id FROM (
          SELECT id FROM memory_messages WHERE user_id = ? AND thread_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 20
        )
      )`
    );
    const transaction = this.db.transaction(() => {
      for (const message of messages) {
        insert.run(randomUUID(), userId, threadId, message.role, message.content, new Date().toISOString());
      }
      evict.run(userId, threadId, userId, threadId);
    });
    transaction();
  }

  getRecentMessages(userId: string, threadId: string, limit = 10): ConversationMemoryMessage[] {
    const rows = this.db.prepare(
      `SELECT * FROM (
         SELECT *, rowid AS message_order FROM memory_messages WHERE user_id = ? AND thread_id = ?
         ORDER BY created_at DESC, rowid DESC LIMIT ?
       ) ORDER BY created_at ASC, message_order ASC`
    ).all(userId, threadId, Math.min(Math.max(limit, 1), 20)) as MessageRow[];
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      threadId: row.thread_id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at
    }));
  }

  /** Removes an isolated evaluation identity and all of its short/long-term memory. */
  clearUser(userId: string): { memories: number; messages: number; events: number } {
    const transaction = this.db.transaction(() => {
      const memories = Number((this.db.prepare(
        "SELECT COUNT(*) AS count FROM memories WHERE user_id = ?"
      ).get(userId) as { count: number }).count);
      const messages = Number((this.db.prepare(
        "SELECT COUNT(*) AS count FROM memory_messages WHERE user_id = ?"
      ).get(userId) as { count: number }).count);
      const events = Number((this.db.prepare(
        "SELECT COUNT(*) AS count FROM memory_events WHERE user_id = ?"
      ).get(userId) as { count: number }).count);
      this.db.prepare("DELETE FROM memory_events WHERE user_id = ?").run(userId);
      this.db.prepare("DELETE FROM memory_messages WHERE user_id = ?").run(userId);
      // memory_embeddings is deleted by its ON DELETE CASCADE foreign key.
      this.db.prepare("DELETE FROM memories WHERE user_id = ?").run(userId);
      return { memories, messages, events };
    });
    return transaction();
  }

  getEvents(memoryId: string, userId: string): MemoryEvent[] {
    const rows = this.db.prepare(
      "SELECT * FROM memory_events WHERE memory_id = ? AND user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 100"
    ).all(memoryId, userId) as Array<{
      id: string; memory_id: string; user_id: string; thread_id: string | null;
      action: MemoryEvent["action"]; previous_value_json: string | null; new_value_json: string | null;
      reason: string; created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      memoryId: row.memory_id,
      userId: row.user_id,
      threadId: row.thread_id ?? undefined,
      action: row.action,
      previousValue: row.previous_value_json ? JSON.parse(row.previous_value_json) as MemoryItem : undefined,
      newValue: row.new_value_json ? JSON.parse(row.new_value_json) as MemoryItem : undefined,
      reason: row.reason,
      createdAt: row.created_at
    }));
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('semantic', 'episodic', 'procedural')),
        memory_key TEXT NOT NULL,
        text TEXT NOT NULL,
        data_json TEXT NOT NULL DEFAULT '{}',
        city TEXT,
        polarity TEXT NOT NULL DEFAULT 'neutral',
        confidence REAL NOT NULL DEFAULT 0.8,
        source TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_accessed_at TEXT,
        access_count INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT,
        UNIQUE(user_id, kind, memory_key)
      );
      CREATE INDEX IF NOT EXISTS idx_memories_user_status ON memories(user_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(user_id, kind, city);

      CREATE TABLE IF NOT EXISTS memory_events (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        thread_id TEXT,
        action TEXT NOT NULL CHECK(action IN ('ADD', 'UPDATE', 'DELETE')),
        previous_value_json TEXT,
        new_value_json TEXT,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_events_memory ON memory_events(memory_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS memory_messages (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_messages_thread
        ON memory_messages(user_id, thread_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS memory_embeddings (
        memory_id TEXT PRIMARY KEY,
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        embedding BLOB NOT NULL,
        content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_memory_embeddings_model ON memory_embeddings(model, dimensions);
    `);
  }

  private toMemory(row: MemoryRow): MemoryItem {
    return {
      id: row.id,
      userId: row.user_id,
      kind: row.kind,
      key: row.memory_key,
      text: row.text,
      data: safeJsonObject(row.data_json),
      city: row.city ?? undefined,
      polarity: row.polarity,
      confidence: row.confidence,
      source: row.source,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastAccessedAt: row.last_accessed_at ?? undefined,
      accessCount: row.access_count,
      expiresAt: row.expires_at ?? undefined
    };
  }

  private buildEvent(
    userId: string,
    memoryId: string,
    action: MemoryEvent["action"],
    previousValue: MemoryItem | undefined,
    newValue: MemoryItem | undefined,
    options: UpsertMemoryOptions
  ): MemoryEvent {
    return {
      id: randomUUID(), memoryId, userId, threadId: options.threadId, action,
      previousValue, newValue, reason: options.reason, createdAt: new Date().toISOString()
    };
  }

  private insertEvent(event: MemoryEvent): void {
    this.db.prepare(
      `INSERT INTO memory_events
       (id, memory_id, user_id, thread_id, action, previous_value_json, new_value_json, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      event.id, event.memoryId, event.userId, event.threadId ?? null, event.action,
      event.previousValue ? JSON.stringify(event.previousValue) : null,
      event.newValue ? JSON.stringify(event.newValue) : null,
      event.reason, event.createdAt
    );
  }
}

export const memoryStore = new MemoryStore(
  process.env.MEMORY_DB_PATH ?? path.resolve(process.cwd(), "data", "memory.sqlite")
);
