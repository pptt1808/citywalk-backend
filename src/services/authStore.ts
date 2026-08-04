import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from "node:crypto";
import { env } from "../config/env";

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

export interface AuthUser {
  id: string;
  username: string;
  createdAt: string;
}

type UserRow = { id: string; username: string; password_hash: string; created_at: string };
type SessionRow = { user_id: string; expires_at: string };

function deriveKey(password: string, salt: Buffer, keyLength: number, options: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived as Buffer);
    });
  });
}

const dbPath = path.resolve(process.cwd(), env.AUTH_DB_PATH);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
`);

function publicUser(row: Pick<UserRow, "id" | "username" | "created_at">): AuthUser {
  return { id: row.id, username: row.username, createdAt: row.created_at };
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await deriveKey(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (![n, r, p].every(Number.isInteger) || n < 1024 || r < 1 || p < 1) return false;
  try {
    const salt = Buffer.from(parts[4], "base64url");
    const expected = Buffer.from(parts[5], "base64url");
    const actual = await deriveKey(password, salt, expected.length, { N: n, r, p });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cleanupExpired(): void {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());
}

export const authStore = {
  async register(username: string, password: string): Promise<AuthUser> {
    const id = `usr_${randomUUID()}`;
    const createdAt = new Date().toISOString();
    const passwordHash = await hashPassword(password);
    try {
      db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
        .run(id, username, passwordHash, createdAt);
    } catch (error) {
      if (error instanceof Error && /unique/i.test(error.message)) throw new Error("USERNAME_TAKEN");
      throw error;
    }
    return { id, username, createdAt };
  },

  async authenticate(username: string, password: string): Promise<AuthUser | undefined> {
    const row = db.prepare("SELECT id, username, password_hash, created_at FROM users WHERE username = ? COLLATE NOCASE")
      .get(username) as UserRow | undefined;
    if (!row || !(await verifyPassword(password, row.password_hash))) return undefined;
    return publicUser(row);
  },

  createSession(userId: string, maxAgeSeconds: number): string {
    cleanupExpired();
    const token = randomBytes(32).toString("base64url");
    const now = Date.now();
    const expiresAt = new Date(now + maxAgeSeconds * 1000).toISOString();
    db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(tokenHash(token), userId, expiresAt, new Date(now).toISOString());
    return token;
  },

  getUserBySession(token: string): AuthUser | undefined {
    cleanupExpired();
    const row = db.prepare(`
      SELECT u.id, u.username, u.created_at
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `).get(tokenHash(token), new Date().toISOString()) as Pick<UserRow, "id" | "username" | "created_at"> | undefined;
    return row ? publicUser(row) : undefined;
  },

  deleteSession(token: string): void {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
  }
};
