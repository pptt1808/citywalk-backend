import cors from "cors";
import express from "express";
import path from "path";
import { apiRouter } from "./routes";

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use("/api", apiRouter);

  // In production (CI/CD), the built frontend dist is served by Nginx at /var/www/citywalk/.
  // When running locally with NODE_ENV=production (optional), Express can also serve it.
  if (process.env.NODE_ENV === "production" && process.env.SERVE_FRONTEND === "true") {
    const frontendDist = path.resolve(process.cwd(), "frontend/dist");
    app.use(express.static(frontendDist));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(frontendDist, "index.html"));
    });
  }

  return app;
}
