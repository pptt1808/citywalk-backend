import { Router } from "express";
import {
  createAgentTraceHandler,
  createAgentTraceStreamGetHandler,
  createAgentTraceStreamPostHandler
} from "../controllers/planController";

export const agentRouter = Router();

agentRouter.post("/trace", createAgentTraceHandler);
agentRouter.get("/trace/stream", createAgentTraceStreamGetHandler);
agentRouter.post("/trace/stream", createAgentTraceStreamPostHandler);
