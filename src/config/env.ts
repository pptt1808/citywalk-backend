import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  AMAP_KEY: z.string().optional(),
  QWEATHER_KEY: z.string().optional()
});

export const env = EnvSchema.parse(process.env);
