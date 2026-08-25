import { Router, json } from "express";
import {
  adjustWalkRouteHandler,
  claimRouteHandoffHandler,
  deleteRouteHandoffHandler,
  finishActiveWalkHandler,
  getActiveWalkHandler,
  getRouteHandoffHandler,
  recordWalkEventHandler,
  saveActiveWalkHandler,
  saveRouteHandoffHandler
} from "../controllers/walkController";
import { asyncHandler } from "../middleware/http";

export const walkRouter = Router();

walkRouter.get("/active", getActiveWalkHandler);
walkRouter.put("/active", json({ limit: "20mb" }), saveActiveWalkHandler);
walkRouter.post("/active/:id/finish", finishActiveWalkHandler);
walkRouter.get("/handoff", getRouteHandoffHandler);
walkRouter.put("/handoff", saveRouteHandoffHandler);
walkRouter.post("/handoff/:id/claim", claimRouteHandoffHandler);
walkRouter.delete("/handoff/:id", deleteRouteHandoffHandler);
walkRouter.post("/events", recordWalkEventHandler);
walkRouter.post("/adjust", asyncHandler(adjustWalkRouteHandler));
