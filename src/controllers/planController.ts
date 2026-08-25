import { Request, Response } from "express";
import { z } from "zod";
import { plannerService } from "../services/plannerService";
import { PlanRequest } from "../types/plan";
import { compactStateEventsForWire } from "../utils/stateEventWire";
import { env } from "../config/env";
import { isAbortError } from "../utils/httpClient";
import { authUserId } from "../middleware/auth";

const PartySchema = z.object({
  total: z.number().int().min(1).max(50).optional(),
  adults: z.number().int().min(0).max(50).optional(),
  children: z.number().int().min(0).max(20).optional(),
  childAges: z.array(z.number().int().min(0).max(17)).max(20).optional(),
  seniors: z.number().int().min(0).max(20).optional(),
  stroller: z.boolean().optional(),
  mobilityNeeds: z.array(z.string().min(1).max(80)).max(20).optional()
});

const ExperienceSchema = z.object({
  familyFriendly: z.boolean().optional(),
  pace: z.enum(["relaxed", "normal", "intensive"]).optional(),
  restStopRequired: z.boolean().optional(),
  restroomPreferred: z.boolean().optional(),
  avoidCrowds: z.boolean().optional()
});

const AccessibilitySchema = z.object({
  wheelchairAccessRequired: z.boolean().optional(),
  stepFreeRequired: z.boolean().optional(),
  elevatorRequired: z.boolean().optional(),
  accessibleRestroomRequired: z.boolean().optional(),
  frequentRestRequired: z.boolean().optional()
});

const StyleSchema = z.object({
  rawText: z.string().min(1).max(500).optional(),
  summary: z.string().min(1).max(240).optional(),
  tags: z.array(z.object({
    name: z.string().min(1).max(60),
    weight: z.number().min(0).max(1).optional(),
    evidence: z.string().max(120).optional()
  })).max(16).optional(),
  desiredScenes: z.array(z.object({
    description: z.string().min(1).max(120),
    importance: z.number().min(0).max(1).optional(),
    searchHints: z.array(z.string().min(1).max(60)).max(6).optional()
  })).max(10).optional(),
  avoidances: z.array(z.string().min(1).max(100)).max(12).optional(),
  searchHints: z.array(z.string().min(1).max(60)).max(16).optional(),
  narrativeArc: z.array(z.string().min(1).max(100)).max(10).optional(),
  confidence: z.number().min(0).max(1).optional()
}).optional();

const DiscoveryPolicySchema = z.object({
  sourcePolicy: z.enum(["map_only", "web_when_relevant", "web_assisted"]).optional(),
  noveltyPreference: z.enum(["mainstream", "neutral", "long_tail"]).optional(),
  avoidOverexposed: z.boolean().optional(),
  exposureScopes: z.array(z.enum([
    "all", "bookstore", "cafe", "sight", "museum", "mall", "park", "restaurant",
    "shop", "market", "studio", "street_scene", "event"
  ])).max(13).optional(),
  exposureStrength: z.enum(["soft", "strict"]).optional()
}).optional();

const TemporalSchema = z.object({
  timezone: z.literal("Asia/Shanghai").optional(),
  visitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
  startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u).optional(),
  departureAt: z.string().datetime({ offset: true }).optional(),
  period: z.enum(["morning", "afternoon", "evening", "night"]).optional(),
  precision: z.enum(["exact", "period", "date_only", "unspecified"]).optional(),
  sourceText: z.string().max(100).optional()
}).optional();

const AgentIntentSchema = z.enum([
  "route_create", "route_modify", "route_compare", "route_review", "poi_discovery",
  "navigation_query", "info_query", "memory_query", "history_query", "preference_feedback",
  "social_copy", "general_chat"
]);
const ActiveSkillSchema = z.object({
  id: z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9._:-]+$/u),
  name: z.string().trim().min(1).max(40),
  description: z.string().trim().max(160).optional(),
  instruction: z.string().trim().min(1).max(1600),
  priority: z.enum(["preference", "requirement"]).optional(),
  applicableIntents: z.array(AgentIntentSchema).max(12).optional(),
  version: z.number().int().min(1).optional()
});

const PlanRequestSchema = z.object({
  task: z.string().trim().min(1).max(2000).optional(),
  attachments: z.array(z.string().trim().min(1).max(240)).max(20).optional(),
  activeSkillIds: z.array(z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9._:-]+$/u)).max(5).optional(),
  activeSkills: z.array(ActiveSkillSchema).max(5).optional(),
  city: z.string().trim().min(1).max(100).optional(),
  startPoint: z.string().trim().min(1).max(300).optional(),
  durationMinutes: z.number().int().positive().max(1440).optional(),
  budget: z.number().positive().max(1_000_000).optional(),
  preferences: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  peopleCount: z.number().int().positive().max(50).optional(),
  party: PartySchema.optional(),
  experience: ExperienceSchema.optional(),
  accessibility: AccessibilitySchema.optional(),
  style: StyleSchema,
  styleDescription: z.string().min(1).max(500).optional(),
  discoveryMode: z.enum(["reliable", "balanced", "hidden_gems"]).optional(),
  discoveryPolicy: DiscoveryPolicySchema,
  temporal: TemporalSchema,
  transportMode: z.enum(["walk", "transit", "mixed"]).optional(),
  weatherPreference: z.enum(["avoid_rain", "indoor_first", "outdoor_ok"]).optional(),
  weatherRisk: z.enum(["low", "medium", "high"]).optional(),
  preferredModel: z.enum(["flash", "pro"]).optional(),
  endPoint: z.string().trim().min(1).max(300).optional(),
  maxLegMinutes: z.number().int().positive().max(600).optional(),
  userId: z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9._:-]+$/).optional(),
  threadId: z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9._:-]+$/).optional()
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
  const discoveryMode = firstQuery(query.discoveryMode) as PlanRequest["discoveryMode"] | undefined;
  const bool = (key: string) => {
    const value = firstQuery(query[key]);
    return value === "true" ? true : value === "false" ? false : undefined;
  };
  const childAges = firstQuery(query.childAges)
    ?.split(/[,，]/)
    .map(Number)
    .filter((age) => Number.isInteger(age) && age >= 0 && age <= 17);
  const mobilityNeeds = firstQuery(query.mobilityNeeds)
    ?.split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const party: NonNullable<PlanRequest["party"]> = {
    total: n("partyTotal"),
    adults: n("adults"),
    children: n("children"),
    childAges,
    seniors: n("seniors"),
    stroller: bool("stroller"),
    mobilityNeeds
  };
  const experience: NonNullable<PlanRequest["experience"]> = {
    familyFriendly: bool("familyFriendly"),
    pace: firstQuery(query.pace) as NonNullable<PlanRequest["experience"]>["pace"],
    restStopRequired: bool("restStopRequired"),
    restroomPreferred: bool("restroomPreferred"),
    avoidCrowds: bool("avoidCrowds")
  };
  const accessibility: NonNullable<PlanRequest["accessibility"]> = {
    wheelchairAccessRequired: bool("wheelchairAccessRequired"),
    stepFreeRequired: bool("stepFreeRequired"),
    elevatorRequired: bool("elevatorRequired"),
    accessibleRestroomRequired: bool("accessibleRestroomRequired"),
    frequentRestRequired: bool("frequentRestRequired")
  };
  const styleDescription = firstQuery(query.styleDescription);
  const hasParty = Object.values(party).some((value) => value !== undefined);
  const hasExperience = Object.values(experience).some((value) => value !== undefined);
  const hasAccessibility = Object.values(accessibility).some((value) => value !== undefined);
  return {
    task: firstQuery(query.task),
    city: firstQuery(query.city),
    startPoint: firstQuery(query.startPoint),
    durationMinutes: n("durationMinutes") !== undefined ? Math.floor(n("durationMinutes")!) : undefined,
    budget: n("budget"),
    preferences: prefsRaw ? prefsRaw.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : undefined,
    peopleCount: n("peopleCount") !== undefined ? Math.floor(n("peopleCount")!) : undefined,
    party: hasParty ? party : undefined,
    experience: hasExperience ? experience : undefined,
    accessibility: hasAccessibility ? accessibility : undefined,
    styleDescription,
    discoveryMode,
    temporal: {
      timezone: "Asia/Shanghai",
      visitDate: firstQuery(query.visitDate),
      startTime: firstQuery(query.startTime),
      departureAt: firstQuery(query.departureAt),
      period: firstQuery(query.timePeriod) as NonNullable<PlanRequest["temporal"]>["period"]
    },
    transportMode: transport,
    weatherPreference: weatherPref,
    weatherRisk: weatherR,
    preferredModel: model,
    endPoint: firstQuery(query.endPoint),
    maxLegMinutes: n("maxLegMinutes") !== undefined ? Math.floor(n("maxLegMinutes")!) : undefined,
    activeSkillIds: firstQuery(query.activeSkillIds)?.split(/[,，]/u).map((item) => item.trim()).filter(Boolean),
    userId: firstQuery(query.userId),
    threadId: firstQuery(query.threadId)
  };
}

function authenticatedPlanRequest(req: Request, value: PlanRequest): PlanRequest {
  return { ...value, userId: authUserId(req) };
}

function initSse(res: Response) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  const resAny = res as Response & { flushHeaders?: () => void };
  resAny.flushHeaders?.();
  res.write("retry: 3000\n\n");
}

function sseWrite(res: Response, event: string, data: unknown): boolean {
  if (res.writableEnded || res.destroyed) return false;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  return true;
}

function requestLifecycle(req: Request, res: Response, heartbeat = false) {
  const controller = new AbortController();
  const abortClient = () => {
    if (!res.writableEnded && !controller.signal.aborted) controller.abort(new Error("Client disconnected"));
  };
  req.once("aborted", abortClient);
  res.once("close", abortClient);
  const requestTimeout = setTimeout(() => {
    if (!controller.signal.aborted) controller.abort(new Error("Agent request timed out"));
  }, env.AGENT_REQUEST_TIMEOUT_MS);
  requestTimeout.unref?.();
  const heartbeatTimer = heartbeat ? setInterval(() => {
    if (!res.writableEnded && !res.destroyed) res.write(`: heartbeat ${Date.now()}\n\n`);
  }, env.SSE_HEARTBEAT_MS) : undefined;
  heartbeatTimer?.unref?.();
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(requestTimeout);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      req.removeListener("aborted", abortClient);
      res.removeListener("close", abortClient);
    }
  };
}

function endSseWithError(req: Request, res: Response, error: unknown): void {
  const requestId = String(res.locals.requestId ?? "unknown");
  if (!isAbortError(error) || !res.destroyed) {
    console.error(`[${requestId}] ${req.method} ${req.originalUrl} SSE failed`, error);
  }
  if (!res.writableEnded && !res.destroyed) {
    sseWrite(res, "stream_error", {
      message: error instanceof Error && /timed out/i.test(error.message)
        ? "Agent 规划超时，请缩小任务范围后重试"
        : "Agent 规划过程中发生错误",
      requestId
    });
    res.end();
  }
}

export async function createPlanHandler(req: Request, res: Response) {
  const parsed = PlanRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: "请求参数不合法",
      errors: parsed.error.flatten()
    });
  }

  const lifecycle = requestLifecycle(req, res);
  try {
    const result = await plannerService.createPlan(authenticatedPlanRequest(req, parsed.data), lifecycle.signal);
    return res.status(200).json(result);
  } finally {
    lifecycle.cleanup();
  }
}

export async function createAgentTraceHandler(req: Request, res: Response) {
  const parsed = PlanRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: "请求参数不合法",
      errors: parsed.error.flatten()
    });
  }

  const lifecycle = requestLifecycle(req, res);
  try {
    const result = await plannerService.createTrace(authenticatedPlanRequest(req, parsed.data), lifecycle.signal);
    return res.status(200).json(result);
  } finally {
    lifecycle.cleanup();
  }
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
  const lifecycle = requestLifecycle(req, res, true);
  try {
    const result = await plannerService.streamPlanWithStateEvents(authenticatedPlanRequest(req, parsed.data), (events) => {
      sseWrite(res, "state", { events: compactStateEventsForWire(events) });
    }, lifecycle.signal);
    sseWrite(res, "done", { result });
    res.end();
  } catch (error) {
    endSseWithError(req, res, error);
  } finally {
    lifecycle.cleanup();
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
  const lifecycle = requestLifecycle(req, res, true);
  try {
    const result = await plannerService.streamPlanWithStateEvents(authenticatedPlanRequest(req, parsed.data), (events) => {
      sseWrite(res, "state", { events: compactStateEventsForWire(events) });
    }, lifecycle.signal);
    sseWrite(res, "done", { result });
    res.end();
  } catch (error) {
    endSseWithError(req, res, error);
  } finally {
    lifecycle.cleanup();
  }
}
