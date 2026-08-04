import { Router } from "express";
import { createAgentTraceHandler, createPlanHandler } from "../controllers/planController";
import { asyncHandler } from "../middleware/http";

export const planRouter = Router();

planRouter.post("/", asyncHandler(createPlanHandler));
planRouter.post("/trace", asyncHandler(createAgentTraceHandler));
