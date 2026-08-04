import { timingSafeEqual } from "node:crypto";
import { RequestHandler } from "express";
import { env } from "../config/env";

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

/**
 * The evaluation runner is a service client, so it must not borrow a user's
 * browser cookie. Development remains frictionless; production fails closed.
 */
export const requireEvaluationAccess: RequestHandler = (req, res, next) => {
  const expected = env.EVALUATION_API_KEY?.trim();
  if (!expected) {
    if (env.NODE_ENV !== "production") {
      next();
      return;
    }
    res.status(503).json({
      code: "EVALUATION_API_DISABLED",
      message: "生产环境尚未配置评测服务密钥"
    });
    return;
  }

  const authorization = req.header("authorization")?.trim();
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const provided = req.header("x-evaluation-key")?.trim() || bearer;
  if (!provided || !safeEqual(provided, expected)) {
    res.status(401).json({ code: "EVALUATION_AUTH_REQUIRED", message: "评测服务凭据无效" });
    return;
  }
  next();
};
