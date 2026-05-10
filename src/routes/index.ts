import { Router } from "express";
import { agentRouter } from "./agent";
import { healthRouter } from "./health";
import { mapRouter } from "./map";
import { planRouter } from "./plan";

export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/map", mapRouter);
apiRouter.use("/plan", planRouter);
apiRouter.use("/agent", agentRouter);
