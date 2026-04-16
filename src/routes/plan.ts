import { Router } from "express";
import { createPlanHandler } from "../controllers/planController";

export const planRouter = Router();

planRouter.post("/", createPlanHandler);
