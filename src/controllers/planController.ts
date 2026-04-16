import { Request, Response } from "express";
import { z } from "zod";
import { plannerService } from "../services/plannerService";

const PlanRequestSchema = z.object({
  city: z.string().min(1).default("南京"),
  startPoint: z.string().min(1),
  durationMinutes: z.number().int().positive(),
  budget: z.number().positive(),
  preferences: z.array(z.string()).default([]),
  weatherRisk: z.enum(["low", "medium", "high"]).optional()
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
