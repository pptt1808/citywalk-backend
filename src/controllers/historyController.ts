import { Request, Response } from "express";
import { historyStore } from "../services/historyStore";

export async function listHistoryHandler(req: Request, res: Response) {
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const data = historyStore.list(limit, offset);
  return res.status(200).json(data);
}

export async function getHistoryHandler(req: Request, res: Response) {
  const entry = historyStore.getById(req.params.id);
  if (!entry) {
    return res.status(404).json({ message: "历史记录不存在" });
  }
  return res.status(200).json(entry);
}

export async function deleteHistoryHandler(req: Request, res: Response) {
  const ok = historyStore.deleteById(req.params.id);
  if (!ok) {
    return res.status(404).json({ message: "历史记录不存在" });
  }
  return res.status(200).json({ ok: true });
}

export async function clearHistoryHandler(_req: Request, res: Response) {
  // Reuse list to get everything, then delete all
  const all = historyStore.list(1000, 0).entries;
  for (const entry of all) {
    historyStore.deleteById(entry.id);
  }
  return res.status(200).json({ ok: true, cleared: all.length });
}
