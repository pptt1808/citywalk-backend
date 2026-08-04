import { createHash } from "node:crypto";
import { Request, Response } from "express";
import { z } from "zod";
import { plannerService } from "../services/plannerService";
import { historyStore } from "../services/historyStore";
import { memoryStore } from "../services/memoryStore";
import { PlanRequest } from "../types/plan";
import { env } from "../config/env";
import { buildEvaluationTrace } from "../services/evaluationTraceService";

const ConversationIdSchema = z.string().trim().min(1).max(160).regex(/^[a-zA-Z0-9._:-]+$/);

const EvaluationTraceSchema = z.object({
  task: z.string().trim().min(1).max(2000),
  conversation_id: ConversationIdSchema.optional(),
  conversationId: ConversationIdSchema.optional(),
  turn_index: z.number().int().min(0).max(99).optional(),
  turnIndex: z.number().int().min(0).max(99).optional(),
  reset: z.boolean().optional(),
  city: z.string().trim().min(1).max(100).optional(),
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
  const scope = evaluationScope(conversationId);
  const input: PlanRequest = {
    task: parsed.data.task,
    city: parsed.data.city,
    preferredModel: parsed.data.preferredModel,
    ...scope
  };
  const result = await plannerService.createPlan(input);
  if (!result.trace) throw new Error("Agent did not produce an evaluation trace");

  const trace = buildEvaluationTrace(result);
  trace.metadata = {
    ...trace.metadata,
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
    protocol: "citywalk-evaluation-v1",
    trace_endpoint: "/api/evaluation/trace",
    multi_turn: true,
    conversation_fields: ["conversation_id", "turn_index", "reset"],
    max_turns: 100,
    authentication: env.EVALUATION_API_KEY ? "x-evaluation-key-or-bearer" : "development-only"
  });
}
