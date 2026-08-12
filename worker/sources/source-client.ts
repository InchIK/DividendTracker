/**
 * HTTP fetch client with timeout, retries, and size limits.
 */
import { SourceFetchError } from './types';

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5MB
const USER_AGENT = 'dividend-tracker/1.0';

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  accept?: string;
  fetchImpl?: typeof fetch;
}

export interface FetchResult {
  ok: boolean;
  status: number;
  headers: Headers;
  arrayBuffer: ArrayBuffer;
  text: string;
  json: <T>() => T;
}

/**
 * Fetch with timeout, retries on network errors and 5xx, and response size limit.
 * 4xx responses are NOT retried.
 */
export async function fetchWithRetry(
  url: string,
  opts: FetchOptions = {},
): Promise<FetchResult> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoff = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
      await new Promise((r) => setTimeout(r, backoff));
    }

    try {
      const controller = new AbortController();
      const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const timer = setTimeout(() => controller.abort(), timeout);

      const headers: Record<string, string> = {
        'User-Agent': USER_AGENT,
        ...(opts.headers ?? {}),
      };
      if (opts.accept) headers.Accept = opts.accept;

      const response = await (opts.fetchImpl ?? fetch)(url, {
        method: opts.method ?? 'GET',
        headers,
        signal: controller.signal,
      });
      clearTimeout(timer);

      // Check response size from content-length header
      const contentLength = parseInt(response.headers.get('content-length') ?? '', 10);
      if (!isNaN(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
        throw new SourceFetchError(
          `Response too large: ${contentLength} bytes`,
          response.status,
        );
      }

      const buf = await response.arrayBuffer();

      // Double-check actual size
      if (buf.byteLength > MAX_RESPONSE_BYTES) {
        throw new SourceFetchError(
          `Response too large: ${buf.byteLength} bytes`,
          response.status,
        );
      }

      // 5xx → retry
      if (response.status >= 500 && attempt < MAX_RETRIES) {
        lastError = new SourceFetchError(
          `Server error: ${response.status}`,
          response.status,
        );
        continue;
      }

      const text = new TextDecoder('utf-8').decode(buf);
      return {
        ok: response.ok,
        status: response.status,
        headers: response.headers,
        arrayBuffer: buf,
        text,
        json: <T>(): T => JSON.parse(text) as T,
      };
    } catch (err) {
      if (err instanceof SourceFetchError && err.httpStatus && err.httpStatus < 500) {
        // 4xx — no retry
        throw err;
      }
      lastError = err instanceof Error ? err : new Error(String(err));

      // Network errors (not SourceFetchError) → retry
      if (attempt < MAX_RETRIES) continue;

      // Final attempt failed
      const message =
        err instanceof Error
          ? err.name === 'AbortError'
            ? `Request timed out after ${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`
            : err.message
          : String(err);
      throw new SourceFetchError(message);
    }
  }

  throw lastError ?? new Error('Unreachable');
}
