import * as fs from "fs";
import * as path from "path";
import { PlanningResult, PlanRequest } from "../types/plan";

export interface HistoryEntry {
  id: string;
  createdAt: string;
  request: PlanRequest;
  result: PlanningResult;
}

const MAX_ENTRIES = 50;
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
    return JSON.parse(raw) as HistoryEntry[];
  } catch {
    return [];
  }
}

function writeAll(entries: HistoryEntry[]): void {
  ensureDir();
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(entries, null, 2), "utf-8");
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
    entries.unshift(entry);
    if (entries.length > MAX_ENTRIES) {
      entries.length = MAX_ENTRIES;
    }
    writeAll(entries);
    return entry;
  },

  list(limit = 20, offset = 0): { entries: HistoryEntry[]; total: number } {
    const entries = readAll();
    return {
      entries: entries.slice(offset, offset + limit),
      total: entries.length
    };
  },

  getById(id: string): HistoryEntry | undefined {
    return readAll().find((e) => e.id === id);
  },

  deleteById(id: string): boolean {
    const entries = readAll();
    const idx = entries.findIndex((e) => e.id === id);
    if (idx === -1) return false;
    entries.splice(idx, 1);
    writeAll(entries);
    return true;
  }
};
