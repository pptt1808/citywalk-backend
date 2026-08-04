import { Request, Response } from "express";
import { z } from "zod";
import { authStore } from "../services/authStore";
import { clearSessionCookie, sessionToken, setSessionCookie, SESSION_MAX_AGE_SECONDS } from "../middleware/auth";

const CredentialsSchema = z.object({
  username: z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{2,63}$/, "用户名只能包含字母、数字、下划线、点和短横线"),
  password: z.string().min(8).max(128)
});

export async function registerHandler(req: Request, res: Response) {
  const parsed = CredentialsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "用户名或密码不符合要求", errors: parsed.error.flatten() });
  try {
    const user = await authStore.register(parsed.data.username, parsed.data.password);
    setSessionCookie(res, authStore.createSession(user.id, SESSION_MAX_AGE_SECONDS));
    return res.status(201).json({ user });
  } catch (error) {
    if (error instanceof Error && error.message === "USERNAME_TAKEN") return res.status(409).json({ message: "用户名已存在" });
    throw error;
  }
}

export async function loginHandler(req: Request, res: Response) {
  const parsed = CredentialsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "用户名或密码不符合要求" });
  const user = await authStore.authenticate(parsed.data.username, parsed.data.password);
  if (!user) return res.status(401).json({ message: "用户名或密码错误" });
  setSessionCookie(res, authStore.createSession(user.id, SESSION_MAX_AGE_SECONDS));
  return res.status(200).json({ user });
}

export function meHandler(req: Request, res: Response) {
  if (!req.authUser) return res.status(401).json({ code: "AUTH_REQUIRED", message: "请先登录" });
  return res.status(200).json({ user: req.authUser });
}

export function logoutHandler(req: Request, res: Response) {
  const token = sessionToken(req);
  if (token) authStore.deleteSession(token);
  clearSessionCookie(res);
  return res.status(200).json({ ok: true });
}
