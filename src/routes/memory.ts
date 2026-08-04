import { Router } from "express";
import {
  addMemoryHandler,
  addPlaceFeedbackHandler,
  backfillEmbeddingsHandler,
  deleteMemoryHandler,
  getEmbeddingStatusHandler,
  getMemoryEventsHandler,
  listMemoriesHandler
} from "../controllers/memoryController";
import { asyncHandler } from "../middleware/http";

export const memoryRouter = Router();

memoryRouter.get("/", asyncHandler(listMemoriesHandler));
memoryRouter.post("/", asyncHandler(addMemoryHandler));
memoryRouter.post("/feedback/place", asyncHandler(addPlaceFeedbackHandler));
memoryRouter.get("/vector/status", asyncHandler(getEmbeddingStatusHandler));
memoryRouter.post("/vector/backfill", asyncHandler(backfillEmbeddingsHandler));
memoryRouter.get("/:id/events", asyncHandler(getMemoryEventsHandler));
memoryRouter.delete("/:id", asyncHandler(deleteMemoryHandler));
