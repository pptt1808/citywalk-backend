import { Router } from "express";
import { createAgentTraceHandler } from "../controllers/planController";

export const agentRouter = Router();

agentRouter.post("/trace", createAgentTraceHandler);
