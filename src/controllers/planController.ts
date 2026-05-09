import { Request, Response } from "express";
import { z } from "zod";
import { plannerService } from "../services/plannerService";

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
