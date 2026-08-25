import { Router, json } from "express";
import {
  deleteSyncedJournalHandler,
  listSyncedJournalsHandler,
  saveSyncedJournalHandler
} from "../controllers/journalSyncController";

export const journalsRouter = Router();

journalsRouter.get("/", listSyncedJournalsHandler);
journalsRouter.put("/:id", json({ limit: "25mb" }), saveSyncedJournalHandler);
journalsRouter.delete("/:id", deleteSyncedJournalHandler);
