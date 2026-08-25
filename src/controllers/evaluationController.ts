import { createHash } from "node:crypto";
import { Request, Response } from "express";
import { z } from "zod";
import { plannerService } from "../services/plannerService";
import { historyStore } from "../services/historyStore";
import { memoryStore } from "../services/memoryStore";
import { PlanningResult, PlanRequest } from "../types/plan";
import { env } from "../config/env";
import { buildEvaluationTrace } from "../services/evaluationTraceService";
import { buildWalkAdjustmentEvaluationTrace, EvaluationCapability } from "../services/evaluationTraceService";
import { WalkAdjustmentService, walkAdjustmentService } from "../services/walkAdjustmentService";
import { RouteSchema } from "./walkController";
import { MapTool, Poi } from "../tools/mapTool";
import { RouteLeg } from "../types/plan";

const ConversationIdSchema = z.string().trim().min(1).max(160).regex(/^[a-zA-Z0-9._:-]+$/);

const EvaluationTraceSchema = z.object({
  task: z.string().trim().min(1).max(2000),
  capability: z.enum([
    "route_generation", "route_modification", "social_copy", "walk_adjustment",
    "route_compare", "route_review", "place_services", "memory_feedback", "general"
  ]).optional(),
  context: z.record(z.unknown()).optional(),
  conversation_id: ConversationIdSchema.optional(),
  conversationId: ConversationIdSchema.optional(),
  turn_index: z.number().int().min(0).max(99).optional(),
  turnIndex: z.number().int().min(0).max(99).optional(),
  reset: z.boolean().optional(),
  city: z.string().trim().min(1).max(100).optional(),
  activeSkills: z.array(z.object({
    id: z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9._:-]+$/u),
    name: z.string().trim().min(1).max(40),
    description: z.string().trim().max(160).optional(),
    instruction: z.string().trim().min(1).max(1600),
    priority: z.enum(["preference", "requirement"]).optional(),
    applicableIntents: z.array(z.string()).max(12).optional(),
    version: z.number().int().min(1).optional()
  })).max(5).optional(),
  activeSkillIds: z.array(z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9._:-]+$/u)).max(5).optional(),
  preferredModel: z.enum(["flash", "pro"]).optional()
}).transform((value) => ({
  ...value,
  conversationId: value.conversation_id ?? value.conversationId,
  turnIndex: value.turn_index ?? value.turnIndex ?? 0
}));

function evaluationScope(conversationId: string): { userId: string; threadId: string } {
  const digest = createHash("sha256").update(conversationId).digest("hex").slice(0, 32);
  return { userId: `eval:${digest}`, threadId: `eval-thread:${digest}` };
}

function resetScope(conversationId: string): { memories: number; messages: number; events: number; history: number } {
  const { userId } = evaluationScope(conversationId);
  const cleared = memoryStore.clearUser(userId);
  return { ...cleared, history: historyStore.clear(userId) };
}

export async function createEvaluationTraceHandler(req: Request, res: Response) {
  const parsed = EvaluationTraceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "评测请求参数不合法", errors: parsed.error.flatten() });
  }

  // Legacy single-turn runners can continue sending only { task }.
  const conversationId = parsed.data.conversationId ?? `single:${String(res.locals.requestId)}`;
  if (parsed.data.reset) resetScope(conversationId);
  if (parsed.data.capability === "walk_adjustment") {
    const context = WalkAdjustmentEvaluationContextSchema.safeParse(parsed.data.context);
    if (!context.success) {
      return res.status(400).json({ message: "行中改路评测上下文不合法", errors: context.error.flatten() });
    }
    const startedAt = Date.now();
    const { toolFixture, ...adjustmentContext } = context.data;
    const adjustmentService = toolFixture
      ? new WalkAdjustmentService(new EvaluationFixtureMapTool(toolFixture))
      : walkAdjustmentService;
    const adjustmentRequest = {
      ...adjustmentContext,
      route: context.data.route as unknown as PlanningResult
    };
    const adjustment = await adjustmentService.adjust(adjustmentRequest);
    const trace = buildWalkAdjustmentEvaluationTrace(
      parsed.data.task,
      adjustmentRequest,
      adjustment,
      Date.now() - startedAt
    );
    trace.metadata.requested_capability = parsed.data.capability;
    trace.metadata.conversation_id = conversationId;
    trace.metadata.turn_index = parsed.data.turnIndex;
    return res.status(200).json({ trace, conversation_id: conversationId, turn_index: parsed.data.turnIndex });
  }
  const scope = evaluationScope(conversationId);
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    if (!controller.signal.aborted) controller.abort(new Error("Evaluation agent request timed out"));
  }, env.EVALUATION_AGENT_REQUEST_TIMEOUT_MS);
  timeout.unref?.();
  const input: PlanRequest = {
    task: parsed.data.task,
    city: parsed.data.city,
    preferredModel: parsed.data.preferredModel,
    activeSkills: parsed.data.activeSkills as PlanRequest["activeSkills"],
    activeSkillIds: parsed.data.activeSkillIds,
    ...scope
  };
  let result: PlanningResult;
  try {
    result = await plannerService.createPlan(input, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
  if (!result.trace) throw new Error("Agent did not produce an evaluation trace");

  const trace = buildEvaluationTrace(result);
  trace.metadata = {
    ...trace.metadata,
    requested_capability: parsed.data.capability,
    conversation_id: conversationId,
    turn_index: parsed.data.turnIndex,
    multi_turn: Boolean(parsed.data.conversationId)
  };
  return res.status(200).json({
    trace,
    conversation_id: conversationId,
    turn_index: parsed.data.turnIndex
  });
}

export async function resetEvaluationConversationHandler(req: Request, res: Response) {
  const parsed = ConversationIdSchema.safeParse(req.params.conversationId);
  if (!parsed.success) return res.status(400).json({ message: "conversation_id 不合法" });
  return res.status(200).json({ ok: true, conversation_id: parsed.data, cleared: resetScope(parsed.data) });
}

export function evaluationCapabilitiesHandler(_req: Request, res: Response) {
  return res.status(200).json({
    protocol: "citywalk-evaluation-v2",
    trace_endpoint: "/api/evaluation/trace",
    multi_turn: true,
    conversation_fields: ["conversation_id", "turn_index", "reset"],
    execution_fields: ["capability", "context", "activeSkills"],
    skill_execution: {
      accepted: true,
      max_active: 5,
      statuses: ["applied", "partially_applied", "skipped"],
      trace_tool: "skill_execution"
    },
    walk_adjustment_context: {
      required: ["route", "reason", "visitedStopNames"],
      deterministic_fixture: "context.toolFixture controls nearby POIs and route-leg distance/duration"
    },
    capabilities: [
      "route_generation", "route_modification", "social_copy", "walk_adjustment",
      "route_compare", "route_review", "place_services", "memory_feedback", "general"
    ] satisfies EvaluationCapability[],
    max_turns: 100,
    authentication: env.EVALUATION_API_KEY ? "x-evaluation-key-or-bearer" : "development-only"
  });
}

const WalkAdjustmentEvaluationContextSchema = z.object({
  route: RouteSchema,
  reason: z.enum(["tired", "time_short", "rain", "crowded", "rest", "restroom", "custom", "deviation"]),
  visitedStopNames: z.array(z.string().min(1).max(200)).max(30).default([]),
  skippedStopNames: z.array(z.string().min(1).max(200)).max(30).default([]),
  currentLocation: z.object({
    lng: z.number().min(-180).max(180),
    lat: z.number().min(-90).max(90),
    accuracy: z.number().min(0).max(100_000).optional()
  }).optional(),
  remainingMinutes: z.number().int().min(0).max(240).optional(),
  customRequest: z.string().trim().max(500).optional(),
  toolFixture: z.object({
    nearbyPois: z.array(z.object({
      name: z.string().min(1).max(200),
      category: z.enum(["sight", "bookstore", "cafe", "museum", "market", "studio", "shop", "park", "restaurant", "street_scene", "event", "mall"]),
      averageCost: z.number().min(0).default(0),
      location: z.string().regex(/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/),
      address: z.string().optional(),
      city: z.string().optional(),
      rating: z.number().min(0).max(5).optional(),
      distanceMeters: z.number().min(0).optional(),
      indoor: z.boolean().optional()
    })).max(20).default([]),
    legDurationMinutes: z.number().int().min(1).max(180).default(6),
    legDistanceMeters: z.number().int().min(0).max(50_000).default(420)
  }).optional()
});

type EvaluationToolFixture = NonNullable<z.infer<typeof WalkAdjustmentEvaluationContextSchema>["toolFixture"]>;

/** Evaluation-only deterministic map adapter; never used by public planning endpoints. */
class EvaluationFixtureMapTool extends MapTool {
  constructor(private readonly fixture: EvaluationToolFixture) {
    super();
  }

  override async searchNearbyPoi(): Promise<Poi[]> {
    return this.fixture.nearbyPois as Poi[];
  }

  override async planRoute(
    origin: string,
    destinations: string[],
    mode: "walk" | "transit" | "mixed"
  ): Promise<RouteLeg[]> {
    let current = origin;
    return destinations.map((destination) => {
      const leg: RouteLeg = {
        origin: current,
        destination,
        distanceMeters: this.fixture.legDistanceMeters,
        durationMinutes: this.fixture.legDurationMinutes,
        mode: mode === "transit" ? "transit" : "walk",
        estimated: false
      };
      current = destination;
      return leg;
    });
  }
}
