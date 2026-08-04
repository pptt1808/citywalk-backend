import cors from "cors";
import express from "express";
import path from "path";
import { apiNotFoundHandler, apiRateLimit, errorHandler, requestContext } from "./middleware/http";
import { apiRouter } from "./routes";
import { env } from "./config/env";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  const allowedOrigins = env.CORS_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean);
  app.use(cors({
    origin: allowedOrigins?.length
      ? (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin))
      : env.NODE_ENV === "production" ? false : true,
    credentials: true
  }));
  app.use(requestContext);
  const defaultJsonParser = express.json({ limit: "100kb" });
  const hasJournalBodyParser = (requestPath: string) => requestPath === "/api/journal/layout" || requestPath === "/api/journal/illustrations";
  app.use((req, res, next) => hasJournalBodyParser(req.path) ? next() : defaultJsonParser(req, res, next));
  app.use("/api", apiRateLimit);
  app.use("/api", apiRouter);
  app.use("/api", apiNotFoundHandler);
  app.use("/static", express.static(path.resolve(process.cwd(), "public")));

  // In production (CI/CD), the built frontend dist is served by Nginx at /var/www/citywalk/.
  // When running locally with NODE_ENV=production (optional), Express can also serve it.
  if (process.env.NODE_ENV === "production" && process.env.SERVE_FRONTEND === "true") {
    const frontendDist = path.resolve(process.cwd(), "frontend/dist");
    app.use(express.static(frontendDist));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(frontendDist, "index.html"));
    });
  }

  app.use(errorHandler);

  return app;
}
