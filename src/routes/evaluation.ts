import { Router } from "express";
import {
  createEvaluationTraceHandler,
  evaluationCapabilitiesHandler,
  resetEvaluationConversationHandler
} from "../controllers/evaluationController";
import { requireEvaluationAccess } from "../middleware/evaluationAuth";
import { asyncHandler } from "../middleware/http";

export const evaluationRouter = Router();

evaluationRouter.use(requireEvaluationAccess);
evaluationRouter.get("/capabilities", evaluationCapabilitiesHandler);
evaluationRouter.post("/trace", asyncHandler(createEvaluationTraceHandler));
evaluationRouter.delete("/conversations/:conversationId", asyncHandler(resetEvaluationConversationHandler));
