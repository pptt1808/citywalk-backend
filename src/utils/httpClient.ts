export class HttpStatusError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "HttpStatusError";
  }
}

export interface FetchJsonOptions {
  timeoutMs: number;
  retries?: number;
  signal?: AbortSignal;
  retryDelayMs?: number;
}

/** Fetches JSON with a per-attempt timeout and retries only transient failures. */
export async function fetchJsonWithRetry<T>(
  url: string,
  init: RequestInit,
  options: FetchJsonOptions
): Promise<T> {
  const retries = Math.max(0, options.retries ?? 0);
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    throwIfAborted(options.signal);
    const controller = new AbortController();
    const abortFromParent = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abortFromParent, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new Error(`Request timed out after ${options.timeoutMs}ms`)),
      options.timeoutMs
    );

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        throw new HttpStatusError(response.status, `HTTP ${response.status}`);
      }
      return await response.json() as T;
    } catch (error) {
      if (options.signal?.aborted) throw abortError(options.signal.reason);
      lastError = error;
      if (attempt >= retries || !isRetryable(error)) break;
      await delay((options.retryDelayMs ?? 300) * 2 ** attempt, options.signal);
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortFromParent);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "Request failed"));
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal.reason);
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || /aborted|abort/i.test(error.message));
}

function isRetryable(error: unknown): boolean {
  if (error instanceof HttpStatusError) {
    return error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
  }
  return !isAbortError(error);
}

function abortError(reason?: unknown): Error {
  const error = reason instanceof Error ? reason : new Error("Request aborted");
  error.name = "AbortError";
  return error;
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  let onAbort: (() => void) | undefined;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal?.reason));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    timer.unref?.();
  }).finally(() => {
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  });
}
