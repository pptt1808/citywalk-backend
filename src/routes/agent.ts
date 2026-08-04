import { Router } from "express";
import {
  createAgentTraceHandler,
  createAgentTraceStreamGetHandler,
  createAgentTraceStreamPostHandler
} from "../controllers/planController";
import { asyncHandler } from "../middleware/http";

export const agentRouter = Router();

agentRouter.post("/trace", asyncHandler(createAgentTraceHandler));
agentRouter.get("/trace/stream", asyncHandler(createAgentTraceStreamGetHandler));
agentRouter.post("/trace/stream", asyncHandler(createAgentTraceStreamPostHandler));
