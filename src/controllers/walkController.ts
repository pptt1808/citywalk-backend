import { Request, Response } from "express";
import { z } from "zod";
import { walkAdjustmentService } from "../services/walkAdjustmentService";
import { authUserId } from "../middleware/auth";
import {
  WalkVersionConflictError,
  walkSessionStore
} from "../services/walkSessionStore";
import { memoryService } from "../services/memoryService";
import { PlanningResult } from "../types/plan";
import { isAbortError } from "../utils/httpClient";
import { randomUUID } from "node:crypto";

export const RouteSchema = z.object({
  title: z.string().min(1).max(300),
  summary: z.string().max(3000).default(""),
  responseKind: z.literal("route"),
  totalEstimatedCost: z.number().min(0).max(1_000_000),
  totalEstimatedMinutes: z.number().min(0).max(10_000),
  stops: z.array(z.object({
    name: z.string().min(1).max(200),
    category: z.enum([
      "bookstore", "cafe", "sight", "museum", "mall", "park", "restaurant",
      "shop", "market", "studio", "street_scene", "event"
    ]),
    estimatedCost: z.number().min(0).max(1_000_000),
    estimatedStayMinutes: z.number().min(0).max(1440),
    reason: z.string().max(1000),
    location: z.string().regex(/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/u).optional()
  }).passthrough()).min(1).max(30),
  constraints: z.object({
    city: z.string().min(1).max(100),
    startPoint: z.string().min(1).max(300)
  }).passthrough(),
  routeLegs: z.array(z.object({
    origin: z.string(),
    destination: z.string(),
    distanceMeters: z.number().min(0),
    durationMinutes: z.number().min(0),
    mode: z.enum(["walk", "transit", "bicycling"])
  }).passthrough()).max(40).optional(),
  decisionLog: z.array(z.string().max(1000)).max(100).default([])
}).passthrough();

const StopProgressSchema = z.object({
  name: z.string().min(1).max(200),
  status: z.enum(["planned", "arrived", "visited", "skipped"]),
  updatedAt: z.string().datetime().optional(),
  source: z.enum(["location", "moment", "manual"]).optional()
});

const WalkPhotoSchema = z.object({
  id: z.string().min(1).max(128),
  url: z.string().max(8_000_000).refine((value) => /^data:image\/(?:jpeg|jpg|png|webp);base64,/u.test(value) || value.startsWith("/api/"), "照片地址格式不正确"),
  caption: z.string().max(300),
  createdAt: z.string().datetime()
}).passthrough();

const WalkRevisionSchema = z.object({
  id: z.string().min(1).max(128),
  reason: z.enum(["tired", "time_short", "rain", "crowded", "rest", "restroom", "custom", "deviation"]),
  reasonLabel: z.string().max(100),
  summary: z.string().max(2000),
  adjustedAt: z.string().datetime(),
  completedStopNames: z.array(z.string().max(200)).max(30),
  retainedStopNames: z.array(z.string().max(200)).max(30),
  removedStopNames: z.array(z.string().max(200)).max(30),
  addedStopNames: z.array(z.string().max(200)).max(30),
  remainingMinutes: z.number().min(0).max(10_000),
  warnings: z.array(z.string().max(1000)).max(20)
});

const ActiveWalkSchema = z.object({
  id: z.string().min(1).max(128),
  route: RouteSchema,
  originalStopNames: z.array(z.string().min(1).max(200)).max(30),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  pausedAt: z.string().datetime().optional(),
  pausedMs: z.number().min(0).max(31_536_000_000),
  currentLocation: z.object({
    lng: z.number().min(-180).max(180),
    lat: z.number().min(-90).max(90),
    accuracy: z.number().min(0).max(100_000).optional()
  }).optional(),
  locationTrail: z.array(z.object({
    lng: z.number().min(-180).max(180),
    lat: z.number().min(-90).max(90),
    accuracy: z.number().min(0).max(100_000).optional(),
    recordedAt: z.string().datetime()
  })).max(5000),
  moments: z.array(z.object({
    id: z.string().min(1).max(128),
    note: z.string().max(5000),
    photos: z.array(WalkPhotoSchema).max(20),
    createdAt: z.string().datetime(),
    location: z.object({ lng: z.number(), lat: z.number(), accuracy: z.number().optional() }).optional(),
    stopName: z.string().max(200).optional(),
    stopIndex: z.number().int().min(0).max(100).optional()
  })).max(200),
  stopProgress: z.array(StopProgressSchema).max(50),
  skippedStopNames: z.array(z.string().max(200)).max(50),
  routeRevisions: z.array(WalkRevisionSchema).max(100),
  routeSnapshots: z.array(z.object({
    revisionId: z.string().min(1).max(128),
    route: RouteSchema,
    stopProgress: z.array(StopProgressSchema).max(50),
    savedAt: z.string().datetime()
  })).max(10).default([]),
  deviation: z.object({
    distanceMeters: z.number().min(0).max(1_000_000),
    detectedAt: z.string().datetime(),
    confirmedAt: z.string().datetime().optional(),
    dismissedAt: z.string().datetime().optional()
  }).optional()
});

const SaveActiveWalkSchema = z.object({
  walk: ActiveWalkSchema,
  baseVersion: z.number().int().min(0).optional()
});

const HandoffSchema = z.object({
  route: RouteSchema,
  source: z.enum(["web", "mobile", "demo"]).default("web")
});

const WalkEventSchema = z.object({
  eventId: z.string().min(1).max(128),
  walkId: z.string().min(1).max(128),
  eventType: z.enum([
    "walk_started", "moment_added", "stop_completed", "stop_skipped",
    "route_adjusted", "route_adjustment_undone", "walk_finished"
  ]),
  payload: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime()
});

const WalkAdjustmentSchema = z.object({
  route: RouteSchema,
  reason: z.enum(["tired", "time_short", "rain", "crowded", "rest", "restroom", "custom", "deviation"]),
  visitedStopNames: z.array(z.string().min(1).max(200)).max(30).default([]),
  skippedStopNames: z.array(z.string().min(1).max(200)).max(30).default([]),
  currentLocation: z.object({
    lng: z.number().min(-180).max(180),
    lat: z.number().min(-90).max(90),
    accuracy: z.number().min(0).max(100_000).optional()
  }).optional(),
  remainingMinutes: z.number().int().min(20).max(240).optional(),
  customRequest: z.string().trim().max(500).optional()
});

export function getActiveWalkHandler(req: Request, res: Response) {
  const session = walkSessionStore.getActive(authUserId(req));
  return res.status(200).json({ session: session ?? null });
}

export function getRouteHandoffHandler(req: Request, res: Response) {
  const handoff = walkSessionStore.getHandoff(authUserId(req));
  return res.status(200).json({ handoff: handoff?.claimedAt ? null : handoff ?? null });
}

export function saveRouteHandoffHandler(req: Request, res: Response) {
  const parsed = HandoffSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "发送到手机的路线不合法", errors: parsed.error.flatten() });
  const handoff = walkSessionStore.saveHandoff(authUserId(req), {
    id: `handoff_${randomUUID().replace(/-/gu, "").slice(0, 20)}`,
    route: parsed.data.route,
    source: parsed.data.source,
    createdAt: new Date().toISOString()
  });
  return res.status(201).json({ handoff });
}

export function claimRouteHandoffHandler(req: Request, res: Response) {
  const handoffId = z.string().min(1).max(128).safeParse(req.params.id);
  if (!handoffId.success) return res.status(400).json({ message: "路线接力编号不合法" });
  const handoff = walkSessionStore.claimHandoff(authUserId(req), handoffId.data);
  if (!handoff) return res.status(404).json({ message: "路线接力不存在或已被接收" });
  return res.status(200).json({ handoff });
}

export function deleteRouteHandoffHandler(req: Request, res: Response) {
  const handoffId = z.string().min(1).max(128).safeParse(req.params.id);
  if (!handoffId.success) return res.status(400).json({ message: "路线接力编号不合法" });
  if (!walkSessionStore.clearHandoff(authUserId(req), handoffId.data)) return res.status(404).json({ message: "路线接力不存在" });
  return res.status(200).json({ ok: true });
}

export function saveActiveWalkHandler(req: Request, res: Response) {
  const parsed = SaveActiveWalkSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "随身记录同步数据不合法", errors: parsed.error.flatten() });
  }
  try {
    const session = walkSessionStore.saveActive(authUserId(req), parsed.data.walk, parsed.data.baseVersion);
    return res.status(200).json({ session });
  } catch (error) {
    if (error instanceof WalkVersionConflictError) {
      return res.status(409).json({ code: "WALK_VERSION_CONFLICT", message: "其他设备已更新这段漫步", session: error.current });
    }
    if (error instanceof Error && error.message === "WALK_PAYLOAD_TOO_LARGE") {
      return res.status(413).json({ code: "WALK_PAYLOAD_TOO_LARGE", message: "沿途照片过多，本轮暂时只保存在当前设备" });
    }
    throw error;
  }
}

export function finishActiveWalkHandler(req: Request, res: Response) {
  const walkId = z.string().min(1).max(128).safeParse(req.params.id);
  if (!walkId.success) return res.status(400).json({ message: "漫步编号不合法" });
  walkSessionStore.finish(authUserId(req), walkId.data);
  return res.status(200).json({ ok: true });
}

export async function recordWalkEventHandler(req: Request, res: Response) {
  const parsed = WalkEventSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "漫步行为事件不合法", errors: parsed.error.flatten() });
  const userId = authUserId(req);
  const inserted = walkSessionStore.recordEvent({ ...parsed.data, userId });
  const learned = inserted && parsed.data.eventType === "walk_finished"
    ? await memoryService.learnFromWalkBehavior(userId)
    : undefined;
  return res.status(inserted ? 201 : 200).json({ ok: true, duplicate: !inserted, learned: learned?.events ?? [] });
}

export async function adjustWalkRouteHandler(req: Request, res: Response) {
  const parsed = WalkAdjustmentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "行中调整参数不合法", errors: parsed.error.flatten() });
  }
  const controller = new AbortController();
  const abort = () => controller.abort(new Error("Client disconnected"));
  req.once("aborted", abort);
  try {
    const result = await walkAdjustmentService.adjust({
      ...parsed.data,
      route: parsed.data.route as unknown as PlanningResult
    }, controller.signal);
    return res.status(200).json(result);
  } catch (error) {
    if (!isAbortError(error)) {
      console.error(`[WalkAdjustment] ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!res.headersSent) return res.status(502).json({ message: "行中路线调整失败，原路线已保留" });
  } finally {
    req.removeListener("aborted", abort);
  }
}
