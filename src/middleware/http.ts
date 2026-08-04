import { randomUUID } from "node:crypto";
import { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from "express";
import { env } from "../config/env";

type AsyncRouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<unknown>;

/** Express 4 does not forward rejected async handlers to error middleware. */
export function asyncHandler(handler: AsyncRouteHandler): RequestHandler {
  return (req, res, next) => {
    void handler(req, res, next).catch(next);
  };
}

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header("x-request-id")?.trim();
  const requestId = incoming && /^[a-zA-Z0-9._:-]{1,128}$/.test(incoming)
    ? incoming
    : randomUUID();

  res.locals.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  next();
}

const rateBuckets = new Map<string, { startedAt: number; count: number }>();

/** Small in-process guard for the public API; production can add a gateway limit too. */
export function apiRateLimit(req: Request, res: Response, next: NextFunction): void {
  if (req.path === "/health") {
    next();
    return;
  }
  const now = Date.now();
  const key = req.socket.remoteAddress ?? "unknown";
  const current = rateBuckets.get(key);
  const bucket = !current || now - current.startedAt >= 60_000
    ? { startedAt: now, count: 0 }
    : current;
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  if (bucket.count > env.RATE_LIMIT_PER_MINUTE) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({
      code: "RATE_LIMITED",
      message: "请求过于频繁，请稍后再试",
      requestId: res.locals.requestId
    });
    return;
  }
  if (rateBuckets.size > 10_000) {
    for (const [address, item] of rateBuckets) {
      if (now - item.startedAt >= 60_000) rateBuckets.delete(address);
    }
  }
  next();
}

export function apiNotFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    code: "NOT_FOUND",
    message: "接口不存在",
    requestId: res.locals.requestId
  });
}

export const errorHandler: ErrorRequestHandler = (error, req, res, next): void => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const requestId = String(res.locals.requestId ?? "unknown");
  console.error(`[${requestId}] ${req.method} ${req.originalUrl}`, error);

  const status = getHttpStatus(error);
  const response: Record<string, unknown> = {
    code: status === 400
      ? "INVALID_JSON"
      : status === 413
        ? "PAYLOAD_TOO_LARGE"
        : "INTERNAL_ERROR",
    message: status === 400
      ? "请求内容不是合法 JSON"
      : status === 413
        ? "请求内容过大"
        : "服务暂时不可用",
    requestId
  };

  if (env.NODE_ENV === "development") {
    response.detail = error instanceof Error ? error.message : String(error);
  }

  res.status(status).json(response);
};

function getHttpStatus(error: unknown): 400 | 413 | 500 {
  if (!error || typeof error !== "object") return 500;
  const status = "status" in error ? Number(error.status) : undefined;
  if (status === 400 || status === 413) return status;
  return 500;
}
