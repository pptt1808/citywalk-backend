import { Request, Response } from "express";
import { z } from "zod";
import { memoryService } from "../services/memoryService";
import { memoryStore } from "../services/memoryStore";
import { authUserId } from "../middleware/auth";

const UserIdSchema = z.string().min(1).max(128);
const MemoryKindSchema = z.enum(["semantic", "episodic", "procedural"]);
const MemoryCandidateSchema = z.object({
  kind: MemoryKindSchema,
  key: z.string().min(1).max(160),
  text: z.string().min(1).max(500),
  data: z.record(z.unknown()).optional(),
  city: z.string().min(1).max(40).optional(),
  polarity: z.enum(["positive", "negative", "neutral"]).optional(),
  confidence: z.number().min(0).max(1).optional(),
  actionHint: z.enum(["UPSERT", "DELETE"]).optional(),
  existingMemoryId: z.string().uuid().optional()
});

const AddMemorySchema = z.object({
  userId: UserIdSchema,
  threadId: z.string().min(1).max(128).optional(),
  memory: MemoryCandidateSchema
});

const FeedbackSchema = z.object({
  userId: UserIdSchema,
  threadId: z.string().min(1).max(128).optional(),
  placeName: z.string().min(1).max(160),
  poiId: z.string().min(1).max(160).optional(),
  city: z.string().min(1).max(40).optional(),
  sentiment: z.enum(["like", "dislike"]),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  comment: z.string().max(500).optional()
});

const EmbeddingBackfillSchema = z.object({
  userId: UserIdSchema,
  limit: z.number().int().min(1).max(500).optional()
});

function queryString(value: unknown): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first.trim() ? first.trim() : undefined;
}

function parseUserId(req: Request): string | undefined {
  if (req.authUser) return req.authUser.id;
  return queryString(req.query.userId) ?? queryString(req.header("x-user-id"));
}

export async function listMemoriesHandler(req: Request, res: Response) {
  const userId = parseUserId(req);
  const parsedUserId = UserIdSchema.safeParse(userId);
  const parsedKind = req.query.kind ? MemoryKindSchema.safeParse(queryString(req.query.kind)) : undefined;
  if (!parsedUserId.success || (parsedKind && !parsedKind.success)) {
    return res.status(400).json({ message: "userId 或 kind 不合法" });
  }
  return res.status(200).json(memoryStore.list(parsedUserId.data, {
    kind: parsedKind?.success ? parsedKind.data : undefined,
    city: queryString(req.query.city),
    includeDeleted: queryString(req.query.includeDeleted) === "true",
    limit: Number(queryString(req.query.limit) ?? 50),
    offset: Number(queryString(req.query.offset) ?? 0)
  }));
}

export async function addMemoryHandler(req: Request, res: Response) {
  const parsed = AddMemorySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "记忆参数不合法", errors: parsed.error.flatten() });
  const userId = req.authUser?.id ?? parsed.data.userId;
  const decision = await memoryService.addExplicit(userId, {
    ...parsed.data.memory,
    source: "user_explicit"
  }, parsed.data.threadId);
  return res.status(decision.event === "ADD" ? 201 : 200).json(decision);
}

export async function deleteMemoryHandler(req: Request, res: Response) {
  const userId = parseUserId(req);
  const parsedUserId = UserIdSchema.safeParse(userId);
  if (!parsedUserId.success) return res.status(400).json({ message: "必须提供合法 userId" });
  const event = memoryStore.delete(req.params.id, parsedUserId.data, "用户通过记忆管理接口删除");
  if (!event) return res.status(404).json({ message: "记忆不存在" });
  return res.status(200).json({ ok: true, event });
}

export async function getMemoryEventsHandler(req: Request, res: Response) {
  const userId = parseUserId(req);
  const parsedUserId = UserIdSchema.safeParse(userId);
  if (!parsedUserId.success) return res.status(400).json({ message: "必须提供合法 userId" });
  const memory = memoryStore.getById(req.params.id, parsedUserId.data);
  if (!memory) return res.status(404).json({ message: "记忆不存在" });
  return res.status(200).json({ entries: memoryStore.getEvents(req.params.id, parsedUserId.data) });
}

export async function addPlaceFeedbackHandler(req: Request, res: Response) {
  const parsed = FeedbackSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "反馈参数不合法", errors: parsed.error.flatten() });
  const decision = await memoryService.recordPlaceFeedback({ ...parsed.data, userId: req.authUser?.id ?? parsed.data.userId });
  return res.status(decision.event === "ADD" ? 201 : 200).json(decision);
}

export async function getEmbeddingStatusHandler(req: Request, res: Response) {
  const parsedUserId = UserIdSchema.safeParse(parseUserId(req));
  if (!parsedUserId.success) return res.status(400).json({ message: "必须提供合法 userId" });
  return res.status(200).json(memoryService.getEmbeddingStatus(parsedUserId.data));
}

export async function backfillEmbeddingsHandler(req: Request, res: Response) {
  const parsed = EmbeddingBackfillSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "向量回填参数不合法", errors: parsed.error.flatten() });
  try {
  return res.status(200).json(await memoryService.backfillEmbeddings(req.authUser?.id ?? parsed.data.userId, parsed.data.limit));
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 500) : "unknown embedding provider error";
    return res.status(502).json({ message: "向量回填失败", detail });
  }
}
