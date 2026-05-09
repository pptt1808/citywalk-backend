import { Request, Response } from "express";
import { z } from "zod";
import { plannerService } from "../services/plannerService";
import { PlanRequest } from "../types/plan";
import { compactStateEventsForWire } from "../utils/stateEventWire";

const PlanRequestSchema = z.object({
  task: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  startPoint: z.string().min(1).optional(),
  durationMinutes: z.number().int().positive().optional(),
  budget: z.number().positive().optional(),
  preferences: z.array(z.string()).default([]),
  peopleCount: z.number().int().positive().optional(),
  transportMode: z.enum(["walk", "transit", "mixed"]).optional(),
  weatherPreference: z.enum(["avoid_rain", "indoor_first", "outdoor_ok"]).optional(),
  weatherRisk: z.enum(["low", "medium", "high"]).optional(),
  preferredModel: z.enum(["flash", "pro"]).optional()
}).refine((data) => data.task || data.startPoint, {
  message: "必须提供 task 自然语言任务，或至少提供 startPoint 结构化起点",
  path: ["task"]
});

function firstQuery(value: unknown): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" ? v : undefined;
}

function planRequestFromQuery(query: Request["query"]): PlanRequest {
  const n = (key: string) => {
    const raw = firstQuery(query[key]);
    if (raw === undefined) return undefined;
    const num = Number(raw);
    return Number.isFinite(num) ? num : undefined;
  };
  const prefsRaw = firstQuery(query.preferences);
  const transport = firstQuery(query.transportMode) as PlanRequest["transportMode"] | undefined;
  const weatherPref = firstQuery(query.weatherPreference) as PlanRequest["weatherPreference"] | undefined;
  const weatherR = firstQuery(query.weatherRisk) as PlanRequest["weatherRisk"] | undefined;
  const model = firstQuery(query.preferredModel) as PlanRequest["preferredModel"] | undefined;
  return {
    task: firstQuery(query.task),
    city: firstQuery(query.city),
    startPoint: firstQuery(query.startPoint),
    durationMinutes: n("durationMinutes") !== undefined ? Math.floor(n("durationMinutes")!) : undefined,
    budget: n("budget"),
    preferences: prefsRaw ? prefsRaw.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : undefined,
    peopleCount: n("peopleCount") !== undefined ? Math.floor(n("peopleCount")!) : undefined,
    transportMode: transport,
    weatherPreference: weatherPref,
    weatherRisk: weatherR,
    preferredModel: model
  };
}

function initSse(res: Response) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  const resAny = res as Response & { flushHeaders?: () => void };
  resAny.flushHeaders?.();
}

function sseWrite(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export async function createPlanHandler(req: Request, res: Response) {
  const parsed = PlanRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: "请求参数不合法",
      errors: parsed.error.flatten()
    });
  }

  const result = await plannerService.createPlan(parsed.data);
  return res.status(200).json(result);
}

export async function createAgentTraceHandler(req: Request, res: Response) {
  const parsed = PlanRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: "请求参数不合法",
      errors: parsed.error.flatten()
    });
  }

  const result = await plannerService.createTrace(parsed.data);
  return res.status(200).json(result);
}

/** POST body 与 `/plan` 相同，响应为 SSE：`state` 事件推送 StateEvent 批次，`done` 含完整 PlanningResult。 */
export async function createAgentTraceStreamPostHandler(req: Request, res: Response) {
  const parsed = PlanRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: "请求参数不合法",
      errors: parsed.error.flatten()
    });
  }
  initSse(res);
  try {
    const result = await plannerService.streamPlanWithStateEvents(parsed.data, (events) => {
      sseWrite(res, "state", { events: compactStateEventsForWire(events) });
    });
    sseWrite(res, "done", { result });
    res.end();
  } catch (err) {
    sseWrite(res, "stream_error", { message: err instanceof Error ? err.message : String(err) });
    res.end();
  }
}

/**
 * 供 `EventSource` 使用的 GET 流（query 与结构化字段对应，如 `?city=南京&startPoint=新街口&preferences=书店,咖啡`）。
 */
export async function createAgentTraceStreamGetHandler(req: Request, res: Response) {
  const input = planRequestFromQuery(req.query);
  const parsed = PlanRequestSchema.safeParse({ ...input, preferences: input.preferences ?? [] });
  if (!parsed.success) {
    return res.status(400).json({
      message: "请求参数不合法",
      errors: parsed.error.flatten()
    });
  }
  initSse(res);
  try {
    const result = await plannerService.streamPlanWithStateEvents(parsed.data, (events) => {
      sseWrite(res, "state", { events: compactStateEventsForWire(events) });
    });
    sseWrite(res, "done", { result });
    res.end();
  } catch (err) {
    sseWrite(res, "stream_error", { message: err instanceof Error ? err.message : String(err) });
    res.end();
  }
}
