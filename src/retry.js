/**
 * Retry helpers for transient network / API errors (#103).
 *
 * The Mendeley API rate-limits (HTTP 429) and returns 5xx responses
 * for transient server issues. The CLI's previous behaviour was to
 * surface the raw `undici` `TypeError: fetch failed` to the user
 * with no retry, no context, and no actionable error message.
 *
 * This module adds an exponential-backoff retry layer that:
 *  - retries on HTTP 429 (honouring `Retry-After` if present),
 *  - retries on HTTP 5xx (502, 503, 504),
 *  - retries on common transient network errors (`fetch failed`,
 *    `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `EAI_AGAIN`),
 *  - does **not** retry on 4xx (except 408, 429) — those are
 *    client errors,
 *  - uses exponential backoff (0.5 s, 1.5 s, 4 s, 12 s by default,
 *    capped at the configured max),
 *  - surfaces the final error with HTTP status + body context.
 *
 * It is consumed by `src/session.js` to wrap the per-attempt
 * fetch+refresh cycle.
 */

import { MendeleyException, MendeleyApiException } from './exception.js';

const DEFAULT_OPTIONS = {
  maxAttempts: 4,
  baseMs: 500,
  maxMs: 12_000,
  jitter: 0.25, // 0-25% random jitter to avoid thundering-herd
};

/**
 * @typedef {object} RetryResult
 * @property {Response} response the final response
 * @property {number} attempts how many attempts were made (>=1)
 */

/**
 * Retry an async function with exponential backoff. The function
 * should:
 *  - return a `Response` on success, **or**
 *  - throw a `MendeleyApiException` on a non-retryable HTTP error,
 *  - throw a `MendeleyException` on a transient error that *should*
 *    be retried (the retry layer adds a `lastStatus` property if any
 *    status was seen), **or**
 *  - throw any other error (treated as transient network error).
 *
 * @template T
 * @param {() => Promise<T>} attempt  the function to attempt
 * @param {object} [opts]
 * @param {number} [opts.maxAttempts=4]  including the first try
 * @param {number} [opts.baseMs=500]     base delay for backoff
 * @param {number} [opts.maxMs=12000]    cap on the per-attempt delay
 * @param {(attempt:number, err:Error) => number} [opts.sleep]  injectable sleep (ms)
 * @param {number} [opts.startDelayMs=0] initial delay before first attempt (for tests)
 * @returns {Promise<T>}
 */
export async function retryWithBackoff(attempt, opts = {}) {
  const {
    maxAttempts,
    baseMs,
    maxMs,
    jitter,
    sleep,
    startDelayMs = 0,
  } = {
    ...DEFAULT_OPTIONS,
    ...opts,
  };
  const actualSleep = sleep || defaultSleep;
  let lastErr;
  for (let i = 0; i < maxAttempts; i += 1) {
    if (startDelayMs > 0 && i === 0) {
      await actualSleep(startDelayMs);
    }
    try {
      return await attempt();
    } catch (err) {
      lastErr = err;
      // Non-retryable: explicit API exception with a status we don't retry.
      if (err instanceof MendeleyApiException && !isRetryableStatus(err.status)) {
        throw err;
      }
      // Non-retryable: explicit MendeleyException whose .status is set
      // and is non-retryable.
      if (
        err instanceof MendeleyException &&
        typeof err.status === 'number' &&
        !isRetryableStatus(err.status)
      ) {
        throw err;
      }
      // Non-retryable: error is not a known transient shape (e.g. a JS
      // bug, a non-retryable network error, or a test setup failure).
      // Rethrow immediately, do not wrap, do not retry.
      if (!isTransientError(err)) {
        throw err;
      }
      // Last attempt: re-throw the original error (or a wrapped version).
      if (i === maxAttempts - 1) {
        throw wrapTransientError(err);
      }
      // Compute the backoff for this attempt.
      const delay = computeBackoff({
        attempt: i,
        err,
        baseMs,
        maxMs,
        jitter,
      });
      await actualSleep(delay);
    }
  }
  // Unreachable: the loop either returns or throws.
  /* c8 ignore next */
  throw wrapTransientError(lastErr);
}

/**
 * HTTP status codes that are worth retrying. 408 (Request Timeout)
 * is retryable per RFC 9110; 429 (Too Many Requests) is the canonical
 * rate-limit signal; 5xx is server-side transient.
 */
export function isRetryableStatus(status) {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

/**
 * Network error codes that are transient. `fetch failed` is the
 * undici / node-fetch TypeError; the `ECONN*`/`ETIMEDOUT`/`ENOTFOUND`/
 * `EAI_AGAIN` codes are surfaced by the underlying socket layer.
 */
const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
]);

/**
 * Decide whether a thrown error is transient (worth retrying).
 *  - `MendeleyApiException` with retryable status: yes
 *  - `MendeleyException` with retryable status: yes
 *  - `TypeError: fetch failed` (undici): yes
 *  - any Error whose `code` is a transient network code: yes
 *  - anything else: no
 */
export function isTransientError(err) {
  if (!err) return false;
  if (err instanceof MendeleyApiException) return isRetryableStatus(err.status);
  if (err instanceof MendeleyException) {
    if (typeof err.status === 'number') return isRetryableStatus(err.status);
    // The error from raiseApiError() before #103 was a generic
    // MendeleyException with no .status; treat it as non-retryable.
    return false;
  }
  if (err.name === 'TypeError' && /fetch failed/i.test(err.message)) return true;
  if (typeof err.code === 'string' && TRANSIENT_NETWORK_CODES.has(err.code)) return true;
  return false;
}

/**
 * Compute the backoff delay for the (i+1)-th retry.
 *
 * Honours `Retry-After` if the error carries a `lastResponse` with
 * the header, then falls back to exponential: `baseMs * 2^attempt`
 * with up to `jitter` fraction of random slack. Capped at `maxMs`.
 */
export function computeBackoff({ attempt, err, baseMs, maxMs, jitter }) {
  const retryAfter = parseRetryAfter(err);
  if (retryAfter !== null) {
    return Math.min(retryAfter, maxMs);
  }
  const exp = baseMs * 2 ** attempt;
  const cap = Math.min(exp, maxMs);
  if (jitter > 0) {
    const slack = cap * jitter * Math.random();
    return Math.round(cap + slack);
  }
  return cap;
}

/**
 * Extract a `Retry-After` value (in ms) from an error whose
 * `.lastResponse` (a `Response`) has the header. Returns null if no
 * header is present. Supports both the delta-seconds form and the
 * HTTP-date form.
 */
export function parseRetryAfter(err) {
  if (!err || !err.lastResponse) return null;
  const h = err.lastResponse.headers;
  const raw = h && (typeof h.get === 'function' ? h.get('retry-after') : h['retry-after']);
  if (!raw) return null;
  const asInt = Number.parseInt(raw, 10);
  if (!Number.isNaN(asInt) && asInt >= 0) {
    return Math.min(asInt * 1000, 60_000);
  }
  const asDate = Date.parse(raw);
  if (!Number.isNaN(asDate)) {
    return Math.min(asDate - Date.now(), 60_000);
  }
  return null;
}

/**
 * Wrap the final transient error so the user sees actionable context.
 * If the error was a `MendeleyException` already, we leave its message
 * alone and just attach `lastStatus` for the caller. If it was a raw
 * `TypeError: fetch failed`, we wrap it in a `MendeleyException` with
 * a friendlier message.
 */
export function wrapTransientError(err) {
  if (err instanceof MendeleyApiException) return err;
  if (err instanceof MendeleyException) {
    // Add a hint that the operation was retried.
    if (!err.message.includes('after retries')) {
      err.message = `${err.message} (after retries)`;
    }
    return err;
  }
  // Raw network error (e.g. undici TypeError).
  const detail = err && err.code ? ` (${err.code})` : '';
  return new MendeleyException(
    `Network request failed${detail}: ${err && err.message ? err.message : String(err)}. ` +
      `The Mendeley API may be rate-limiting, temporarily unavailable, or unreachable. ` +
      `Try again, or pass --retry 0 to disable retries on bulk commands.`,
  );
}

function defaultSleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
