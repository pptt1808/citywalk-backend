import { Request, Response } from "express";
import { z } from "zod";
import { authUserId } from "../middleware/auth";
import { skillStore } from "../services/skillStore";

const IntentSchema = z.enum([
  "route_create", "route_modify", "route_compare", "route_review", "poi_discovery",
  "navigation_query", "info_query", "memory_query", "history_query", "preference_feedback",
  "social_copy", "general_chat"
]);
const DraftSchema = z.object({
  id: z.string().min(1).max(128).regex(/^[a-zA-Z0-9._:-]+$/u).optional(),
  name: z.string().trim().min(1).max(40),
  description: z.string().trim().max(160).default(""),
  instruction: z.string().trim().min(1).max(1600),
  enabled: z.boolean().default(true),
  applicableIntents: z.array(IntentSchema).max(12).default([]),
  activation: z.enum(["manual", "recommended"]).default("manual"),
  priority: z.enum(["preference", "requirement"]).default("preference"),
  version: z.number().int().min(1).optional()
});
const PatchSchema = DraftSchema.partial().refine((value) => Object.keys(value).length > 0, "必须提供至少一个修改字段");

export async function listSkillsHandler(req: Request, res: Response) {
  const entries = skillStore.list(authUserId(req));
  return res.status(200).json({ entries, total: entries.length });
}

export async function createSkillHandler(req: Request, res: Response) {
  const parsed = DraftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Skill 参数不合法", errors: parsed.error.flatten() });
  try {
    return res.status(201).json(skillStore.create(authUserId(req), parsed.data));
  } catch (error) {
    if (error instanceof Error && /unique/i.test(error.message)) return res.status(409).json({ message: "Skill 标识已存在" });
    throw error;
  }
}

export async function updateSkillHandler(req: Request, res: Response) {
  const parsed = PatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Skill 参数不合法", errors: parsed.error.flatten() });
  const skill = skillStore.update(req.params.id, authUserId(req), parsed.data);
  if (!skill) return res.status(404).json({ message: "Skill 不存在" });
  return res.status(200).json(skill);
}

export async function deleteSkillHandler(req: Request, res: Response) {
  if (!skillStore.delete(req.params.id, authUserId(req))) return res.status(404).json({ message: "Skill 不存在" });
  return res.status(200).json({ ok: true });
}
