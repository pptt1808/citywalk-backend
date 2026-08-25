import { Request, Response } from "express";
import { z } from "zod";
import { authUserId } from "../middleware/auth";
import { RouteSchema } from "./walkController";
import { journalSyncStore } from "../services/journalSyncStore";

const Id = z.string().min(1).max(128);
const IsoDate = z.string().datetime();
const JournalEntrySchema = z.object({
  id: Id,
  title: z.string().min(1).max(300),
  city: z.string().max(100),
  route: RouteSchema,
  journey: z.object({
    walkId: Id,
    startedAt: IsoDate,
    completedAt: IsoDate,
    durationMs: z.number().min(0).max(31_536_000_000),
    originalStopNames: z.array(z.string().max(200)).max(50),
    visitedStopNames: z.array(z.string().max(200)).max(50),
    skippedStopNames: z.array(z.string().max(200)).max(50),
    routeRevisions: z.array(z.record(z.unknown())).max(100),
    locationTrail: z.array(z.record(z.unknown())).max(5000)
  }).passthrough(),
  note: z.string().max(50_000),
  photos: z.array(z.object({
    id: Id,
    url: z.string().max(8_000_000).refine((value) => /^data:image\/(?:jpeg|jpg|png|webp);base64,/u.test(value) || value.startsWith("/api/"), "照片地址格式不正确"),
    caption: z.string().max(500),
    createdAt: IsoDate
  }).passthrough()).max(200),
  blocks: z.array(z.record(z.unknown())).max(300),
  spreads: z.array(z.record(z.unknown())).max(150),
  moments: z.array(z.record(z.unknown())).max(200),
  selectedStops: z.array(z.string().max(200)).max(100),
  aiCaption: z.string().max(10_000),
  createdAt: IsoDate,
  updatedAt: IsoDate
}).passthrough();

export function listSyncedJournalsHandler(req: Request, res: Response) {
  const entries = journalSyncStore.list(authUserId(req));
  return res.status(200).json({ entries, total: entries.length });
}

export function saveSyncedJournalHandler(req: Request, res: Response) {
  const id = Id.safeParse(req.params.id);
  const parsed = JournalEntrySchema.safeParse(req.body);
  if (!id.success || !parsed.success || id.data !== parsed.data?.id) {
    return res.status(400).json({ message: "路线手账同步数据不合法", errors: parsed.success ? undefined : parsed.error.flatten() });
  }
  try {
    const entry = journalSyncStore.save(authUserId(req), parsed.data);
    return res.status(200).json({ entry });
  } catch (error) {
    if (error instanceof Error && error.message === "JOURNAL_PAYLOAD_TOO_LARGE") {
      return res.status(413).json({ message: "本次手账照片容量过大，请减少照片后重试" });
    }
    throw error;
  }
}

export function deleteSyncedJournalHandler(req: Request, res: Response) {
  const id = Id.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ message: "手账编号不合法" });
  if (!journalSyncStore.delete(authUserId(req), id.data)) return res.status(404).json({ message: "手账不存在" });
  return res.status(200).json({ ok: true });
}
