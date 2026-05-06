import { Router } from "express";
import { createAgentTraceHandler, createPlanHandler } from "../controllers/planController";

export const planRouter = Router();

planRouter.post("/", createPlanHandler);
planRouter.post("/trace", createAgentTraceHandler);
