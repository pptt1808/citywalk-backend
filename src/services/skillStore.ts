import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "../config/env";
import { AgentIntent, AgentSkill, AgentSkillActivation, AgentSkillPriority } from "../types/plan";

interface SkillRow {
  id: string;
  user_id: string;
  name: string;
  description: string;
  instruction: string;
  enabled: number;
  applicable_intents: string;
  activation: AgentSkillActivation;
  priority: AgentSkillPriority;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface AgentSkillDraft {
  id?: string;
  name: string;
  description?: string;
  instruction: string;
  enabled?: boolean;
  applicableIntents?: AgentIntent[];
  activation?: AgentSkillActivation;
  priority?: AgentSkillPriority;
  version?: number;
}

const dbPath = path.resolve(process.cwd(), env.SKILL_DB_PATH);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_skills (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    instruction TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    applicable_intents TEXT NOT NULL DEFAULT '[]',
    activation TEXT NOT NULL DEFAULT 'manual',
    priority TEXT NOT NULL DEFAULT 'preference',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_agent_skills_user ON agent_skills(user_id, updated_at DESC);
`);

function intents(value: string): AgentIntent[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is AgentIntent => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function toSkill(row: SkillRow): AgentSkill {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    instruction: row.instruction,
    enabled: Boolean(row.enabled),
    applicableIntents: intents(row.applicable_intents),
    activation: row.activation,
    priority: row.priority,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export const skillStore = {
  list(userId: string): AgentSkill[] {
    return (db.prepare("SELECT * FROM agent_skills WHERE user_id = ? ORDER BY updated_at DESC")
      .all(userId) as SkillRow[]).map(toSkill);
  },

  getByIds(userId: string, ids: string[]): AgentSkill[] {
    const unique = [...new Set(ids)].slice(0, 5);
    if (!unique.length) return [];
    const placeholders = unique.map(() => "?").join(",");
    const rows = db.prepare(`SELECT * FROM agent_skills WHERE user_id = ? AND enabled = 1 AND id IN (${placeholders})`)
      .all(userId, ...unique) as SkillRow[];
    const byId = new Map(rows.map((row) => [row.id, toSkill(row)]));
    return unique.flatMap((id) => byId.get(id) ?? []);
  },

  create(userId: string, draft: AgentSkillDraft): AgentSkill {
    const now = new Date().toISOString();
    const id = draft.id?.trim() || `skill_${randomUUID()}`;
    db.prepare(`INSERT INTO agent_skills
      (id,user_id,name,description,instruction,enabled,applicable_intents,activation,priority,version,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, userId, draft.name.trim(), draft.description?.trim() ?? "", draft.instruction.trim(), draft.enabled === false ? 0 : 1,
        JSON.stringify(draft.applicableIntents ?? []), draft.activation ?? "manual", draft.priority ?? "preference",
        Math.max(1, draft.version ?? 1), now, now);
    return toSkill(db.prepare("SELECT * FROM agent_skills WHERE id = ? AND user_id = ?").get(id, userId) as SkillRow);
  },

  update(id: string, userId: string, draft: Partial<AgentSkillDraft>): AgentSkill | undefined {
    const existing = db.prepare("SELECT * FROM agent_skills WHERE id = ? AND user_id = ?").get(id, userId) as SkillRow | undefined;
    if (!existing) return undefined;
    const current = toSkill(existing);
    const now = new Date().toISOString();
    db.prepare(`UPDATE agent_skills SET name=?,description=?,instruction=?,enabled=?,applicable_intents=?,activation=?,priority=?,version=?,updated_at=? WHERE id=? AND user_id=?`)
      .run(
        draft.name?.trim() ?? current.name,
        draft.description?.trim() ?? current.description,
        draft.instruction?.trim() ?? current.instruction,
        draft.enabled == null ? Number(current.enabled) : Number(draft.enabled),
        JSON.stringify(draft.applicableIntents ?? current.applicableIntents),
        draft.activation ?? current.activation,
        draft.priority ?? current.priority,
        current.version + 1,
        now,
        id,
        userId
      );
    return toSkill(db.prepare("SELECT * FROM agent_skills WHERE id = ? AND user_id = ?").get(id, userId) as SkillRow);
  },

  delete(id: string, userId: string): boolean {
    return db.prepare("DELETE FROM agent_skills WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
  }
};
