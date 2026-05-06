import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

function normalizeFlashModel(model?: string): string {
  return !model || model === "deepseek-chat" ? "deepseek-v4-flash" : model;
}

function normalizeProModel(model?: string): string {
  return !model || model === "deepseek-reasoner" ? "deepseek-v4-pro" : model;
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  AMAP_KEY: z.string().optional(),
  QWEATHER_KEY: z.string().optional(),
  HEFENG_KEY: z.string().optional(),
  DS_: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_FLASH_API_KEY: z.string().optional(),
  DEEPSEEK_FLASH_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  DEEPSEEK_FLASH_MODEL: z.string().default("deepseek-v4-flash"),
  DEEPSEEK_PRO_API_KEY: z.string().optional(),
  DEEPSEEK_PRO_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  DEEPSEEK_PRO_MODEL: z.string().default("deepseek-v4-pro"),
  DEEPSEEK_CHAT_COMPLETIONS_PATH: z.string().default("/chat/completions"),
  DEEPSEEK_V3_API_KEY: z.string().optional(),
  DEEPSEEK_V3_BASE_URL: z.string().url().optional(),
  DEEPSEEK_V3_MODEL: z.string().optional(),
  DSV4PRO_API_KEY: z.string().optional(),
  DSV4PRO_BASE_URL: z.string().url().optional(),
  DSV4PRO_MODEL: z.string().optional(),
  LLM_ADVANCED_RATIO: z.coerce.number().min(0).max(1).default(0.2),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(30000)
}).transform((value) => ({
  ...value,
  QWEATHER_KEY: value.QWEATHER_KEY || value.HEFENG_KEY,
  DEEPSEEK_API_KEY: value.DEEPSEEK_API_KEY || value.DS_,
  DEEPSEEK_FLASH_API_KEY: value.DEEPSEEK_FLASH_API_KEY || value.DEEPSEEK_V3_API_KEY || value.DEEPSEEK_API_KEY || value.DS_,
  DEEPSEEK_FLASH_BASE_URL: value.DEEPSEEK_V3_BASE_URL || value.DEEPSEEK_FLASH_BASE_URL,
  DEEPSEEK_FLASH_MODEL: normalizeFlashModel(value.DEEPSEEK_V3_MODEL || value.DEEPSEEK_FLASH_MODEL),
  DEEPSEEK_PRO_API_KEY: value.DEEPSEEK_PRO_API_KEY || value.DSV4PRO_API_KEY || value.DEEPSEEK_API_KEY || value.DS_,
  DEEPSEEK_PRO_BASE_URL: value.DSV4PRO_BASE_URL || value.DEEPSEEK_PRO_BASE_URL,
  DEEPSEEK_PRO_MODEL: normalizeProModel(value.DSV4PRO_MODEL || value.DEEPSEEK_PRO_MODEL)
}));

export const env = EnvSchema.parse(process.env);
