import { Router } from "express";
import {
  listHistoryHandler,
  getHistoryHandler,
  deleteHistoryHandler,
  clearHistoryHandler
} from "../controllers/historyController";
import { asyncHandler } from "../middleware/http";

export const historyRouter = Router();

historyRouter.get("/", asyncHandler(listHistoryHandler));
historyRouter.get("/:id", asyncHandler(getHistoryHandler));
historyRouter.delete("/:id", asyncHandler(deleteHistoryHandler));
historyRouter.delete("/", asyncHandler(clearHistoryHandler));
