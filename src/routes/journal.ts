import { Router, json } from "express";
import {
  deleteJournalIllustrationHandler,
  generateJournalIllustrationHandler,
  generateJournalLayoutHandler,
  getJournalIllustrationHandler
} from "../controllers/journalController";
import { asyncHandler } from "../middleware/http";

export const journalRouter = Router();

journalRouter.post("/layout", json({ limit: "8mb" }), asyncHandler(generateJournalLayoutHandler));
journalRouter.post("/illustrations", json({ limit: "11mb" }), asyncHandler(generateJournalIllustrationHandler));
journalRouter.get("/illustrations/:id", asyncHandler(getJournalIllustrationHandler));
journalRouter.delete("/illustrations/:id", asyncHandler(deleteJournalIllustrationHandler));
