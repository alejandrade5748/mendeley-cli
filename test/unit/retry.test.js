/**
 * Tests for issue #103: retry on transient errors.
 *
 * Covers:
 *  - isRetryableStatus: 408, 429, 5xx are retryable; other 4xx are not
 *  - isTransientError: network errors and retryable HTTP statuses
 *  - parseRetryAfter: delta-seconds, HTTP-date, missing
 *  - computeBackoff: exponential, capped, jittered, Retry-After honoured
 *  - retryWithBackoff: succeeds on first try, retries on 429, gives up
 *    after maxAttempts, throws non-retryable errors immediately, honours
 *    Retry-After, wraps the final error.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeBackoff,
  isRetryableStatus,
  isTransientError,
  parseRetryAfter,
  retryWithBackoff,
} from '../../src/retry.js';
import { MendeleyApiException, MendeleyException } from '../../src/exception.js';

describe('isRetryableStatus (#103)', () => {
  test('408 Request Timeout is retryable', () => {
    assert.equal(isRetryableStatus(408), true);
  });
  test('429 Too Many Requests is retryable', () => {
    assert.equal(isRetryableStatus(429), true);
  });
  test('500-599 are retryable', () => {
    for (const s of [500, 502, 503, 504, 599]) {
      assert.equal(isRetryableStatus(s), true, `expected ${s} retryable`);
    }
  });
  test('400/401/403/404/422 are NOT retryable', () => {
    for (const s of [400, 401, 403, 404, 422]) {
      assert.equal(isRetryableStatus(s), false, `expected ${s} non-retryable`);
    }
  });
});

describe('isTransientError (#103)', () => {
  test('MendeleyApiException with retryable status is transient', () => {
    const err = new MendeleyApiException('msg', 503, null);
    assert.equal(isTransientError(err), true);
  });
  test('MendeleyApiException with 404 is NOT transient', () => {
    const err = new MendeleyApiException('msg', 404, null);
    assert.equal(isTransientError(err), false);
  });
  test('undici fetch failed TypeError IS transient', () => {
    const err = new TypeError('fetch failed');
    assert.equal(isTransientError(err), true);
  });
  test('error with .code ECONNRESET is transient', () => {
    const err = new Error('read ECONNRESET');
    err.code = 'ECONNRESET';
    assert.equal(isTransientError(err), true);
  });
  test('error with .code ETIMEDOUT is transient', () => {
    const err = new Error('connect ETIMEDOUT');
    err.code = 'ETIMEDOUT';
    assert.equal(isTransientError(err), true);
  });
  test('error with .code ENOTFOUND is transient', () => {
    const err = new Error('getaddrinfo ENOTFOUND api.mendeley.com');
    err.code = 'ENOTFOUND';
    assert.equal(isTransientError(err), true);
  });
  test('error with .code EAI_AGAIN is transient', () => {
    const err = new Error('getaddrinfo EAI_AGAIN');
    err.code = 'EAI_AGAIN';
    assert.equal(isTransientError(err), true);
  });
  test('random TypeError is NOT transient', () => {
    const err = new TypeError('cannot read property foo of undefined');
    assert.equal(isTransientError(err), false);
  });
  test('null/undefined is not transient', () => {
    assert.equal(isTransientError(null), false);
    assert.equal(isTransientError(undefined), false);
  });
});

describe('parseRetryAfter (#103)', () => {
  function withHeader(value) {
    return {
      lastResponse: { headers: { get: (k) => (k.toLowerCase() === 'retry-after' ? value : null) } },
    };
  }
  test('returns null when no header', () => {
    assert.equal(parseRetryAfter({ lastResponse: { headers: { get: () => null } } }), null);
    assert.equal(parseRetryAfter({}), null);
    assert.equal(parseRetryAfter(null), null);
  });
  test('parses delta-seconds form', () => {
    assert.equal(parseRetryAfter(withHeader('5')), 5_000);
    assert.equal(parseRetryAfter(withHeader('0')), 0);
  });
  test('caps delta-seconds at 60s', () => {
    assert.equal(parseRetryAfter(withHeader('9999')), 60_000);
  });
  test('parses HTTP-date form', () => {
    const future = new Date(Date.now() + 5_000).toUTCString();
    const ms = parseRetryAfter(withHeader(future));
    assert.ok(ms !== null && ms > 0 && ms <= 5_500, `expected ~5000ms, got ${ms}`);
  });
  test('returns null for garbage', () => {
    assert.equal(parseRetryAfter(withHeader('not a number or date')), null);
  });
});

describe('computeBackoff (#103)', () => {
  test('exponential growth with default baseMs=500', () => {
    const opts = { baseMs: 500, maxMs: 12_000, jitter: 0 };
    assert.equal(computeBackoff({ attempt: 0, err: null, ...opts }), 500);
    assert.equal(computeBackoff({ attempt: 1, err: null, ...opts }), 1_000);
    assert.equal(computeBackoff({ attempt: 2, err: null, ...opts }), 2_000);
    assert.equal(computeBackoff({ attempt: 3, err: null, ...opts }), 4_000);
  });
  test('caps at maxMs', () => {
    const opts = { baseMs: 500, maxMs: 1_500, jitter: 0 };
    assert.equal(computeBackoff({ attempt: 5, err: null, ...opts }), 1_500);
  });
  test('honours Retry-After when present', () => {
    const err = {
      lastResponse: { headers: { get: (k) => (k === 'retry-after' ? '2' : null) } },
    };
    assert.equal(computeBackoff({ attempt: 0, err, baseMs: 500, maxMs: 12_000, jitter: 0 }), 2_000);
  });
  test('jitter adds random slack up to jitter*cap', () => {
    // Run many times; all values should be >= cap and <= cap*(1+jitter).
    const cap = 1_000;
    for (let i = 0; i < 20; i += 1) {
      const v = computeBackoff({ attempt: 0, err: null, baseMs: cap, maxMs: 12_000, jitter: 0.5 });
      assert.ok(v >= cap, `value ${v} < cap ${cap}`);
      assert.ok(v <= cap * 1.5, `value ${v} > cap*1.5 ${cap * 1.5}`);
    }
  });
});

describe('retryWithBackoff (#103)', () => {
  test('returns immediately on first success', async () => {
    let calls = 0;
    const result = await retryWithBackoff(
      async () => {
        calls += 1;
        return 'ok';
      },
      { sleep: async () => undefined },
    );
    assert.equal(result, 'ok');
    assert.equal(calls, 1);
  });

  test('retries on 429 then succeeds', async () => {
    let calls = 0;
    const result = await retryWithBackoff(
      async () => {
        calls += 1;
        if (calls < 3) {
          const err = new MendeleyApiException('rate-limited', 429, null);
          err.lastResponse = { headers: { get: () => null } };
          throw err;
        }
        return 'ok-after-retries';
      },
      { maxAttempts: 4, baseMs: 100, maxMs: 1_000, jitter: 0, sleep: async () => undefined },
    );
    assert.equal(result, 'ok-after-retries');
    assert.equal(calls, 3);
  });

  test('retries on 503 then succeeds', async () => {
    let calls = 0;
    const result = await retryWithBackoff(
      async () => {
        calls += 1;
        if (calls < 2) {
          const err = new MendeleyApiException('service unavailable', 503, null);
          err.lastResponse = { headers: { get: () => null } };
          throw err;
        }
        return 'ok';
      },
      { maxAttempts: 4, baseMs: 100, maxMs: 1_000, jitter: 0, sleep: async () => undefined },
    );
    assert.equal(result, 'ok');
    assert.equal(calls, 2);
  });

  test('retries on undici fetch failed then succeeds', async () => {
    let calls = 0;
    const result = await retryWithBackoff(
      async () => {
        calls += 1;
        if (calls < 2) throw new TypeError('fetch failed');
        return 'ok';
      },
      { maxAttempts: 4, baseMs: 100, maxMs: 1_000, jitter: 0, sleep: async () => undefined },
    );
    assert.equal(result, 'ok');
    assert.equal(calls, 2);
  });

  test('retries on ECONNRESET then succeeds', async () => {
    let calls = 0;
    const result = await retryWithBackoff(
      async () => {
        calls += 1;
        if (calls < 2) {
          const err = new Error('read ECONNRESET');
          err.code = 'ECONNRESET';
          throw err;
        }
        return 'ok';
      },
      { maxAttempts: 4, baseMs: 100, maxMs: 1_000, jitter: 0, sleep: async () => undefined },
    );
    assert.equal(result, 'ok');
    assert.equal(calls, 2);
  });

  test('gives up after maxAttempts and wraps the final error', async () => {
    let calls = 0;
    await assert.rejects(
      retryWithBackoff(
        async () => {
          calls += 1;
          throw new TypeError('fetch failed');
        },
        { maxAttempts: 3, baseMs: 100, maxMs: 1_000, jitter: 0, sleep: async () => undefined },
      ),
      (err) => {
        // Final error is a MendeleyException with actionable context.
        assert.ok(
          err instanceof MendeleyException,
          `expected MendeleyException, got ${err.constructor.name}`,
        );
        assert.match(err.message, /Network request failed/);
        assert.match(err.message, /Try again/);
        return true;
      },
    );
    assert.equal(calls, 3);
  });

  test('does NOT retry on 404 (non-retryable status)', async () => {
    let calls = 0;
    await assert.rejects(
      retryWithBackoff(
        async () => {
          calls += 1;
          const err = new MendeleyApiException('not found', 404, null);
          err.lastResponse = { headers: { get: () => null } };
          throw err;
        },
        { maxAttempts: 4, baseMs: 100, maxMs: 1_000, jitter: 0, sleep: async () => undefined },
      ),
      /not found/,
    );
    assert.equal(calls, 1, 'should not have retried on 404');
  });

  test('does NOT retry on 400 (non-retryable status)', async () => {
    let calls = 0;
    await assert.rejects(
      retryWithBackoff(
        async () => {
          calls += 1;
          const err = new MendeleyApiException('bad request', 400, null);
          err.lastResponse = { headers: { get: () => null } };
          throw err;
        },
        { maxAttempts: 4, baseMs: 100, maxMs: 1_000, jitter: 0, sleep: async () => undefined },
      ),
      /bad request/,
    );
    assert.equal(calls, 1, 'should not have retried on 400');
  });

  test('passes a non-retryable MendeleyApiException through unchanged', async () => {
    let calls = 0;
    try {
      await retryWithBackoff(
        async () => {
          calls += 1;
          throw new MendeleyApiException('forbidden', 403, { detail: 'nope' });
        },
        { maxAttempts: 4, baseMs: 100, maxMs: 1_000, jitter: 0, sleep: async () => undefined },
      );
      assert.fail('expected throw');
    } catch (err) {
      assert.ok(err instanceof MendeleyApiException);
      assert.equal(err.status, 403);
      assert.deepEqual(err.body, { detail: 'nope' });
    }
    assert.equal(calls, 1);
  });

  test('sleep is called between retries (not on the last attempt)', async () => {
    let calls = 0;
    const sleepCalls = [];
    await assert.rejects(
      retryWithBackoff(
        async () => {
          calls += 1;
          throw new TypeError('fetch failed');
        },
        {
          maxAttempts: 3,
          baseMs: 100,
          maxMs: 1_000,
          jitter: 0,
          sleep: async (ms) => {
            sleepCalls.push(ms);
          },
        },
      ),
    );
    // 3 attempts, 2 sleeps in between
    assert.equal(calls, 3);
    assert.equal(sleepCalls.length, 2);
    assert.ok(sleepCalls[0] > 0, `expected positive sleep[0], got ${sleepCalls[0]}`);
    assert.ok(sleepCalls[1] > 0, `expected positive sleep[1], got ${sleepCalls[1]}`);
  });

  test('honours Retry-After header for the backoff delay', async () => {
    let calls = 0;
    const sleepCalls = [];
    await retryWithBackoff(
      async () => {
        calls += 1;
        if (calls < 2) {
          const err = new MendeleyApiException('rate-limited', 429, null);
          err.lastResponse = { headers: { get: (k) => (k === 'retry-after' ? '2' : null) } };
          throw err;
        }
        return 'ok';
      },
      {
        maxAttempts: 4,
        baseMs: 500,
        maxMs: 12_000,
        jitter: 0,
        sleep: async (ms) => {
          sleepCalls.push(ms);
        },
      },
    );
    assert.equal(calls, 2);
    assert.equal(sleepCalls.length, 1);
    assert.equal(sleepCalls[0], 2_000, 'should have honoured Retry-After: 2');
  });

  test('does NOT retry a non-transient error and rethrows it unchanged (#103)', async () => {
    let calls = 0;
    // A plain Error whose message does not match any transient pattern
    // (e.g. a test setup error or a JS bug). The retry layer must
    // rethrow it immediately without wrapping or retrying.
    const original = new Error('No mock response for https://example.com');
    await assert.rejects(
      retryWithBackoff(
        async () => {
          calls += 1;
          throw original;
        },
        { maxAttempts: 4, baseMs: 100, maxMs: 1_000, jitter: 0, sleep: async () => undefined },
      ),
      (err) => {
        // Same object, same message — not wrapped.
        assert.equal(err, original, 'expected the original error object');
        return true;
      },
    );
    assert.equal(calls, 1, 'expected exactly 1 attempt (no retry on non-transient)');
  });
});
