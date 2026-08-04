import { Request, Response } from "express";
import { historyStore } from "../services/historyStore";
import { z } from "zod";
import { authUserId } from "../middleware/auth";

const UserId = z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9._:-]+$/);

function userIdFrom(req: Request): string | undefined {
  const value = req.query.userId ?? req.header("x-user-id");
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === "string" ? candidate : undefined;
}

function requireUserId(req: Request, res: Response): string | undefined {
  if (req.authUser) return req.authUser.id;
  const parsed = UserId.safeParse(userIdFrom(req));
  if (!parsed.success) {
    res.status(400).json({ message: "必须提供合法 userId" });
    return undefined;
  }
  return parsed.data;
}

export async function listHistoryHandler(req: Request, res: Response) {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const data = historyStore.list(userId, limit, offset);
  return res.status(200).json(data);
}

export async function getHistoryHandler(req: Request, res: Response) {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const entry = historyStore.getById(req.params.id, userId);
  if (!entry) {
    return res.status(404).json({ message: "历史记录不存在" });
  }
  return res.status(200).json(entry);
}

export async function deleteHistoryHandler(req: Request, res: Response) {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const ok = historyStore.deleteById(req.params.id, userId);
  if (!ok) {
    return res.status(404).json({ message: "历史记录不存在" });
  }
  return res.status(200).json({ ok: true });
}

export async function clearHistoryHandler(req: Request, res: Response) {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const cleared = historyStore.clear(userId);
  return res.status(200).json({ ok: true, cleared });
}
