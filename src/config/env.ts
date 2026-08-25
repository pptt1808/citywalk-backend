import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: ".env.local" });
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
  QWEATHER_API_HOST: z.string().trim().optional(),
  TAVILY_API_KEY: z.string().optional(),
  TAVILY_BASE_URL: z.string().url().default("https://api.tavily.com"),
  TAVILY_SEARCH_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
  ARK_API_KEY: z.string().optional(),
  ARK_BASE_URL: z.string().url().default("https://ark.cn-beijing.volces.com/api/v3"),
  ARK_VISION_MODEL: z.string().trim().min(1).default("doubao-seed-2-0-lite-260428"),
  ARK_VISION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(60000),
  ARK_IMAGE_MODEL: z.string().trim().min(1).default("doubao-seedream-5-0-260128"),
  ARK_IMAGE_SIZE: z.enum(["1K", "2K", "4K"]).default("2K"),
  ARK_IMAGE_TIMEOUT_MS: z.coerce.number().int().min(10000).max(300000).default(180000),
  ARK_IMAGE_WATERMARK: z.preprocess(
    (value) => value === true || value === "true" || value === "1",
    z.boolean().default(false)
  ),
  JOURNAL_ASSET_DB_PATH: z.string().default("data/journal-assets.sqlite"),
  JOURNAL_ASSET_DIR: z.string().default("data/journal-assets"),
  JOURNAL_MAX_GENERATED_IMAGE_BYTES: z.coerce.number().int().min(1_000_000).max(50_000_000).default(15_000_000),
  JOURNAL_IMAGE_DAILY_LIMIT: z.coerce.number().int().min(1).max(1000).default(20),
  DS_: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_FLASH_API_KEY: z.string().optional(),
  DEEPSEEK_FLASH_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  DEEPSEEK_FLASH_MODEL: z.string().default("deepseek-v4-flash"),
  DEEPSEEK_PRO_API_KEY: z.string().optional(),
  DEEPSEEK_PRO_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  DEEPSEEK_PRO_MODEL: z.string().default("deepseek-v4-pro"),
  DEEPSEEK_CHAT_COMPLETIONS_PATH: z.string().default("/chat/completions"),
  // Primary LLM slot provider. "dot" uses the OpenAI-compatible 点点 dots3
  // endpoint; anything else (default) uses the DeepSeek Flash integration.
  LLM_PRIMARY_PROVIDER: z.enum(["deepseek", "dot"]).default("deepseek"),
  DOT_API_KEY: z.string().optional(),
  DOT_BASE_URL: z.string().url().default("https://note3-prev-api.askdiandian.com"),
  DOT_MODEL: z.string().trim().min(1).default("dots3-note-prev"),
  DEEPSEEK_V3_API_KEY: z.string().optional(),
  DEEPSEEK_V3_BASE_URL: z.string().url().optional(),
  DEEPSEEK_V3_MODEL: z.string().optional(),
  DSV4PRO_API_KEY: z.string().optional(),
  DSV4PRO_BASE_URL: z.string().url().optional(),
  DSV4PRO_MODEL: z.string().optional(),
  LLM_AUTO_PRO_ENABLED: z.preprocess(
    (value) => value === true || value === "true" || value === "1",
    z.boolean().default(false)
  ),
  LLM_ADVANCED_RATIO: z.coerce.number().min(0).max(1).default(0.2),
  // A full constraint profile can take around 30s on v4-flash when reasoning
  // tokens are emitted; keep margin so valid JSON is not aborted at the edge.
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(45000),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  LLM_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(100).max(10000).default(750),
  EXTERNAL_API_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(12000),
  AGENT_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(10000).max(600000).default(150000),
  // Evaluation traces may run multi-stage social-copy generation. Keep a
  // separate bounded budget so a stalled provider cannot hang the evaluator.
  EVALUATION_AGENT_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(30000).max(900000).default(300000),
  SSE_HEARTBEAT_MS: z.coerce.number().int().min(3000).max(60000).default(12000),
  MAP_SEARCH_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).max(10000).default(120),
  /** Dedicated service credential for the evaluation adapter. Required in production. */
  EVALUATION_API_KEY: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().min(16).optional()
  ),
  CORS_ORIGINS: z.string().optional(),
  AUTH_DB_PATH: z.string().default("data/auth.sqlite"),
  SKILL_DB_PATH: z.string().default("data/skills.sqlite"),
  WALK_DB_PATH: z.string().default("data/walks.sqlite"),
  JOURNAL_SYNC_DB_PATH: z.string().default("data/journals.sqlite"),
  AUTH_COOKIE_SECURE: z.preprocess(
    (value) => value === true || value === "true" || value === "1",
    z.boolean().default(false)
  ),
  EMBEDDING_API_KEY: z.string().optional(),
  EMBEDDING_BASE_URL: z.string().url().default("https://dashscope.aliyuncs.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding"),
  EMBEDDING_MODEL: z.string().default("tongyi-embedding-vision-flash"),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(768),
  EMBEDDING_TIMEOUT_MS: z.coerce.number().int().positive().default(20000)
}).transform((value) => ({
  ...value,
  QWEATHER_KEY: value.QWEATHER_KEY || value.HEFENG_KEY,
  DEEPSEEK_API_KEY: value.DEEPSEEK_API_KEY || value.DS_,
  DEEPSEEK_FLASH_API_KEY: value.DEEPSEEK_FLASH_API_KEY || value.DEEPSEEK_V3_API_KEY || value.DEEPSEEK_API_KEY || value.DS_,
  DEEPSEEK_FLASH_BASE_URL: value.DEEPSEEK_V3_BASE_URL || value.DEEPSEEK_FLASH_BASE_URL,
  DEEPSEEK_FLASH_MODEL: normalizeFlashModel(value.DEEPSEEK_V3_MODEL || value.DEEPSEEK_FLASH_MODEL),
  // Pro is a distinct integration. A generic/Flash key must not make the
  // router believe that Pro is available.
  DEEPSEEK_PRO_API_KEY: value.DEEPSEEK_PRO_API_KEY || value.DSV4PRO_API_KEY,
  DEEPSEEK_PRO_BASE_URL: value.DSV4PRO_BASE_URL || value.DEEPSEEK_PRO_BASE_URL,
  DEEPSEEK_PRO_MODEL: normalizeProModel(value.DSV4PRO_MODEL || value.DEEPSEEK_PRO_MODEL)
}));

export const env = EnvSchema.parse(process.env);
