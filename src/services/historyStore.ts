import * as fs from "fs";
import * as path from "path";
import { PlanningResult, PlanRequest } from "../types/plan";

export interface HistoryEntry {
  id: string;
  createdAt: string;
  request: PlanRequest;
  result: PlanningResult;
}

const MAX_ENTRIES_PER_USER = 50;
const HISTORY_DIR = path.resolve(process.cwd(), "data");
const HISTORY_FILE = path.join(HISTORY_DIR, "history.json");

function ensureDir(): void {
  if (!fs.existsSync(HISTORY_DIR)) {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
  }
}

function readAll(): HistoryEntry[] {
  ensureDir();
  try {
    const raw = fs.readFileSync(HISTORY_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is HistoryEntry => Boolean(entry?.id && entry?.request && entry?.result))
      .map((entry) => {
        // Older records predate the server-owned history identity.
        if (!entry.result.historyId) entry.result.historyId = entry.id;
        return entry;
      });
  } catch {
    return [];
  }
}

function writeAll(entries: HistoryEntry[]): void {
  ensureDir();
  const temporary = `${HISTORY_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(entries, null, 2), "utf-8");
  fs.renameSync(temporary, HISTORY_FILE);
}

function generateId(): string {
  return `hw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const historyStore = {
  save(request: PlanRequest, result: PlanningResult): HistoryEntry {
    const entries = readAll();
    const entry: HistoryEntry = {
      id: generateId(),
      createdAt: new Date().toISOString(),
      request,
      result
    };
    entry.result.historyId = entry.id;
    if (!request.userId) return entry;
    entries.unshift(entry);
    const userEntries = entries.filter((item) => item.request.userId === request.userId);
    const overflow = userEntries.slice(MAX_ENTRIES_PER_USER);
    if (overflow.length) {
      const removeIds = new Set(overflow.map((item) => item.id));
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        if (removeIds.has(entries[index].id)) entries.splice(index, 1);
      }
    }
    writeAll(entries);
    return entry;
  },

  list(userId: string, limit = 20, offset = 0): { entries: HistoryEntry[]; total: number } {
    const entries = readAll().filter((entry) => entry.request.userId === userId);
    return {
      entries: entries.slice(offset, offset + limit),
      total: entries.length
    };
  },

  getById(id: string, userId: string): HistoryEntry | undefined {
    return readAll().find((e) => e.id === id && e.request.userId === userId);
  },

  latestRoute(userId?: string, threadId?: string): HistoryEntry | undefined {
    // A thread id is only meaningful inside an authenticated/user scope.
    if (!userId) return undefined;
    return readAll().find((entry) => {
      const sameUser = userId ? entry.request.userId === userId : true;
      const sameThread = threadId ? entry.request.threadId === threadId : true;
      const isRoute = entry.result.responseKind
        ? entry.result.responseKind === "route"
        : entry.result.stops.length > 0;
      return sameUser && sameThread && isRoute;
    });
  },

  deleteById(id: string, userId: string): boolean {
    const entries = readAll();
    const idx = entries.findIndex((e) => e.id === id && e.request.userId === userId);
    if (idx === -1) return false;
    entries.splice(idx, 1);
    writeAll(entries);
    return true;
  },

  clear(userId: string): number {
    const entries = readAll();
    const kept = entries.filter((entry) => entry.request.userId !== userId);
    const cleared = entries.length - kept.length;
    if (cleared) writeAll(kept);
    return cleared;
  }
};
