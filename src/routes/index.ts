import { Router } from "express";
import { healthRouter } from "./health";
import { planRouter } from "./plan";

export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/plan", planRouter);
