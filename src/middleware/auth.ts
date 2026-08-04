import { NextFunction, Request, RequestHandler, Response } from "express";
import { AuthUser, authStore } from "../services/authStore";
import { env } from "../config/env";

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

const SESSION_COOKIE = "citywalk_session";
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const item of (header ?? "").split(";")) {
    const separator = item.indexOf("=");
    if (separator <= 0) continue;
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (key) {
      try { result[key] = decodeURIComponent(value); } catch { /* ignore malformed cookie */ }
    }
  }
  return result;
}

export function sessionToken(req: Request): string | undefined {
  const token = parseCookies(req.header("cookie"))[SESSION_COOKIE];
  return token && /^[A-Za-z0-9_-]{32,128}$/.test(token) ? token : undefined;
}

export const optionalAuth: RequestHandler = (req, _res, next) => {
  const token = sessionToken(req);
  if (token) req.authUser = authStore.getUserBySession(token);
  next();
};

export const requireAuth: RequestHandler = (req, res, next) => {
  optionalAuth(req, res, () => {
    if (!req.authUser) {
      res.status(401).json({ code: "AUTH_REQUIRED", message: "请先登录" });
      return;
    }
    next();
  });
};

export function setSessionCookie(res: Response, token: string): void {
  const secure = env.AUTH_COOKIE_SECURE || env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; Max-Age=${SESSION_MAX_AGE_SECONDS}; Path=/; HttpOnly; SameSite=Lax${secure}`);
}

export function clearSessionCookie(res: Response): void {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
}

export function authUserId(req: Request): string {
  if (!req.authUser) throw new Error("AUTH_REQUIRED");
  return req.authUser.id;
}
