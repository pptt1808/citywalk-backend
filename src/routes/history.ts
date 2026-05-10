import { Router } from "express";
import {
  listHistoryHandler,
  getHistoryHandler,
  deleteHistoryHandler,
  clearHistoryHandler
} from "../controllers/historyController";

export const historyRouter = Router();

historyRouter.get("/", listHistoryHandler);
historyRouter.get("/:id", getHistoryHandler);
historyRouter.delete("/:id", deleteHistoryHandler);
historyRouter.delete("/", clearHistoryHandler);
