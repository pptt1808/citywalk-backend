import { Request, Response } from "express";
import { z } from "zod";
import { favoriteStore } from "../services/favoriteStore";
import { historyStore } from "../services/historyStore";
import { authUserId } from "../middleware/auth";

const UserId = z.string().min(1).max(128);

function userIdFrom(req: Request): string | undefined {
  if (req.authUser) return req.authUser.id;
  const value = req.body?.userId ?? req.query.userId ?? req.header("x-user-id");
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function listFavoriteRoutesHandler(req: Request, res: Response) {
  const parsed = UserId.safeParse(userIdFrom(req));
  if (!parsed.success) return res.status(400).json({ message: "必须提供合法 userId" });
  const entries = favoriteStore.list(parsed.data);
  return res.status(200).json({ entries, total: entries.length });
}

export async function addFavoriteRouteHandler(req: Request, res: Response) {
  const parsedUser = UserId.safeParse(userIdFrom(req));
  const historyId = z.string().trim().min(1).max(128).safeParse(req.body?.historyId);
  if (!parsedUser.success || !historyId.success) {
    return res.status(400).json({ message: "收藏路线必须提供合法 userId 和 historyId" });
  }
  const history = historyStore.getById(historyId.data, parsedUser.data);
  if (!history || history.result.responseKind !== "route" || !Array.isArray(history.result.stops)) {
    return res.status(404).json({ message: "没有找到属于当前用户的路线历史" });
  }
  const favorite = favoriteStore.save(parsedUser.data, history.result, history.request);
  return res.status(201).json(favorite);
}

export async function deleteFavoriteRouteHandler(req: Request, res: Response) {
  const parsed = UserId.safeParse(userIdFrom(req));
  if (!parsed.success) return res.status(400).json({ message: "必须提供合法 userId" });
  if (!favoriteStore.delete(req.params.id, parsed.data)) return res.status(404).json({ message: "收藏路线不存在" });
  return res.status(200).json({ ok: true });
}
