import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { env } from "../config/env";

export interface EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  isConfigured(): boolean;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  contentHash(text: string): string;
}

type DashScopeEmbeddingResponse = {
  output?: {
    embeddings?: Array<{
      index?: number;
      embedding?: number[];
      type?: string;
    }>;
  };
  code?: string;
  message?: string;
  request_id?: string;
};

export class EmbeddingProviderError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message);
    this.name = "EmbeddingProviderError";
  }
}

function normalizeEmbeddingText(text: string): string {
  const trimmed = text.trim();
  const characters = Array.from(trimmed);
  if (characters.length <= 800) return trimmed;
  return `${characters.slice(0, 600).join("")}\n…\n${characters.slice(-200).join("")}`;
}

/** Alibaba Cloud Model Studio multimodal embedding HTTP provider. */
export class DashScopeEmbeddingProvider implements EmbeddingProvider {
  readonly model = env.EMBEDDING_MODEL;
  readonly dimensions = env.EMBEDDING_DIMENSIONS;
  private readonly batchSize = 10;

  isConfigured(): boolean {
    return Boolean(env.EMBEDDING_API_KEY);
  }

  contentHash(text: string): string {
    return createHash("sha256").update(`${this.model}\0${text.trim()}`).digest("hex");
  }

  async embed(text: string): Promise<number[]> {
    const [embedding] = await this.embedBatch([text]);
    return embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (!this.isConfigured()) throw new EmbeddingProviderError("Embedding API key is not configured");
    const normalized = texts.map(normalizeEmbeddingText);
    if (normalized.some((text) => !text)) throw new EmbeddingProviderError("Embedding text cannot be empty");

    const all: number[][] = [];
    for (let offset = 0; offset < normalized.length; offset += this.batchSize) {
      const batch = normalized.slice(offset, offset + this.batchSize);
      all.push(...await this.requestBatch(batch));
    }
    return all;
  }

  private async requestBatch(texts: string[]): Promise<number[][]> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await this.postJson({
          model: this.model,
          input: { contents: texts.map((text) => ({ text })) },
          parameters: { output_type: "dense" }
        });
        let payload: DashScopeEmbeddingResponse = {};
        try {
          payload = response.body ? JSON.parse(response.body) as DashScopeEmbeddingResponse : {};
        } catch {
          // Preserve the HTTP status handling below even if a gateway returns non-JSON text.
        }
        if (response.status < 200 || response.status >= 300) {
          const retryable = response.status === 429 || response.status >= 500;
          throw new EmbeddingProviderError(
            `Embedding API ${response.status}${payload.code ? ` ${payload.code}` : ""}: ${payload.message ?? "request failed"}`,
            retryable
          );
        }
        return this.validateResponse(payload, texts.length);
      } catch (error) {
        lastError = error;
        const retryable = error instanceof EmbeddingProviderError
          ? error.retryable
          : false;
        if (!retryable || attempt === 2) break;
        await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
      }
    }
    if (lastError instanceof Error) throw lastError;
    throw new EmbeddingProviderError("Embedding API request failed");
  }

  private postJson(payload: unknown): Promise<{ status: number; body: string }> {
    const url = new URL(env.EMBEDDING_BASE_URL);
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
    const body = JSON.stringify(payload);
    return new Promise((resolve, reject) => {
      const request = transport(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.EMBEDDING_API_KEY}`,
          Accept: "application/json; charset=utf-8",
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": Buffer.byteLength(body)
        },
        timeout: env.EMBEDDING_TIMEOUT_MS
      }, (response) => {
        const chunks: Buffer[] = [];
        let receivedBytes = 0;
        response.on("data", (chunk: Buffer) => {
          receivedBytes += chunk.length;
          if (receivedBytes > 10 * 1024 * 1024) {
            request.destroy(new EmbeddingProviderError("Embedding API response exceeds 10 MB", false));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8")
        }));
        response.on("error", (error) => reject(new EmbeddingProviderError(
          `Embedding API response error: ${error.message}`,
          true
        )));
      });
      request.on("timeout", () => request.destroy(new EmbeddingProviderError("Embedding API request timed out", true)));
      request.on("error", (error) => reject(error instanceof EmbeddingProviderError
        ? error
        : new EmbeddingProviderError(`Embedding API network error: ${error.message}`, true)));
      request.end(body);
    });
  }

  private validateResponse(payload: DashScopeEmbeddingResponse, expected: number): number[][] {
    const embeddings = payload.output?.embeddings;
    if (!Array.isArray(embeddings) || embeddings.length !== expected) {
      throw new EmbeddingProviderError(`Embedding API returned ${embeddings?.length ?? 0}/${expected} vectors`);
    }
    const ordered = [...embeddings].sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
    return ordered.map((item, index) => {
      const vector = item.embedding;
      if (!Array.isArray(vector) || vector.length !== this.dimensions) {
        throw new EmbeddingProviderError(
          `Embedding ${index} has ${vector?.length ?? 0} dimensions; expected ${this.dimensions}`
        );
      }
      if (vector.some((value) => !Number.isFinite(value))) {
        throw new EmbeddingProviderError(`Embedding ${index} contains non-finite values`);
      }
      return vector;
    });
  }
}

export const embeddingProvider = new DashScopeEmbeddingProvider();
