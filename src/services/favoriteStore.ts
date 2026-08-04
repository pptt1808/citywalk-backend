import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { PlanRequest, PlanningResult } from "../types/plan";

export interface FavoriteRoute {
  id: string;
  userId: string;
  createdAt: string;
  request?: PlanRequest;
  result: PlanningResult;
}

const MAX_FAVORITES = 100;
const DATA_DIR = path.resolve(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "favorite-routes.json");

function readAll(): FavoriteRoute[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf-8"));
    return Array.isArray(parsed) ? parsed.filter((item): item is FavoriteRoute => Boolean(item?.id && item?.userId && item?.result)) : [];
  } catch {
    return [];
  }
}

function writeAll(items: FavoriteRoute[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporary = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(items, null, 2), "utf-8");
  fs.renameSync(temporary, FILE);
}

function routeKey(result: PlanningResult): string {
  return JSON.stringify({
    title: result.title,
    start: result.routeOverview?.startPoint ?? result.constraints.startPoint,
    stops: result.stops.map((stop) => stop.name),
    legs: result.routeLegs?.map((leg) => [leg.origin, leg.destination, leg.originName, leg.destinationName, leg.mode])
  });
}

export const favoriteStore = {
  list(userId: string, limit = 50): FavoriteRoute[] {
    return readAll().filter((item) => item.userId === userId).slice(0, Math.min(Math.max(limit, 1), MAX_FAVORITES));
  },

  getById(id: string, userId: string): FavoriteRoute | undefined {
    return readAll().find((item) => item.id === id && item.userId === userId);
  },

  save(userId: string, result: PlanningResult, request?: PlanRequest): FavoriteRoute {
    const entries = readAll();
    const key = routeKey(result);
    const existing = entries.find((item) => item.userId === userId && routeKey(item.result) === key);
    if (existing) return existing;
    const { events: _events, trace: _trace, decisionLog: _decisionLog, planSteps: _planSteps, ...compactResult } = result;
    const favorite: FavoriteRoute = {
      id: `fav_${randomUUID()}`,
      userId,
      createdAt: new Date().toISOString(),
      request,
      result: { ...compactResult, events: undefined, trace: undefined, decisionLog: [], planSteps: undefined }
    };
    entries.unshift(favorite);
    const userIds = entries.filter((item) => item.userId === userId).slice(MAX_FAVORITES).map((item) => item.id);
    if (userIds.length) {
      const removeIds = new Set(userIds);
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        if (removeIds.has(entries[index].id)) entries.splice(index, 1);
      }
    }
    writeAll(entries);
    return favorite;
  },

  delete(id: string, userId: string): boolean {
    const entries = readAll();
    const next = entries.filter((item) => !(item.id === id && item.userId === userId));
    if (next.length === entries.length) return false;
    writeAll(next);
    return true;
  }
};
