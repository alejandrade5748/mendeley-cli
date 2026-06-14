/**
 * Integration tests that exercise the session against a mocked fetch
 * implementation.  These tests mimic the live API but don't talk to it.
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { Mendeley } from '../../src/client.js';
import { MendeleySession } from '../../src/session.js';

/**
 * Install a mock fetch that records every call and returns a queue of
 * canned responses.  Each call consumes one response from the queue.
 */
function mockFetch(responses) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, opts });
    const next = responses.shift();
    if (!next) throw new Error('No mock response for ' + url);
    return next();
  };
  fn.calls = calls;
  return fn;
}

let originalFetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('session.get returns a parsed response object', async () => {
  globalThis.fetch = mockFetch([() => new Response(JSON.stringify({ ok: 1 }), { status: 200 })]);
  const m = new Mendeley({ clientId: 'cid' });
  const session = new MendeleySession(m, { access_token: 'tok' });
  const rsp = await session.get('/foo');
  assert.equal(rsp.status, 200);
  assert.deepEqual(await rsp.json(), { ok: 1 });
  const { url, opts } = globalThis.fetch.calls[0];
  assert.equal(url, 'https://api.mendeley.com/foo');
  assert.equal(opts.headers.authorization, 'Bearer tok');
});

test('session.post sends a JSON body with correct content type', async () => {
  globalThis.fetch = mockFetch([() => new Response('{}', { status: 200 })]);
  const m = new Mendeley({ clientId: 'cid' });
  const session = new MendeleySession(m, { access_token: 'tok' });
  await session.post('/foo', {
    data: JSON.stringify({ a: 1 }),
    headers: { 'content-type': 'application/json' },
  });
  const { opts } = globalThis.fetch.calls[0];
  assert.equal(opts.method, 'POST');
  assert.equal(opts.headers['content-type'], 'application/json');
  assert.equal(opts.body, '{"a":1}');
});

test('session.request refreshes the token on a 401 response', async () => {
  const responses = [
    () => new Response('unauthorized', { status: 401 }),
    () => new Response('ok', { status: 200 }),
  ];
  globalThis.fetch = async (url, opts) => {
    return responses.shift()();
  };
  const m = new Mendeley({ clientId: 'cid', clientSecret: 'sec' });
  const refresher = {
    async refresh(session) {
      session.token = { access_token: 'new_tok' };
    },
  };
  const session = new MendeleySession(m, { access_token: 'old' }, null, refresher);
  const rsp = await session.get('/foo');
  assert.equal(rsp.status, 200);
  // The second call should now carry the refreshed token.
  const calls = (await import('../../src/index.js')).USER_AGENT;
  assert.ok(calls);
  // We can verify the second call's headers by mocking fetch to capture them.
  // Re-run with capture.
  let captured;
  const responses2 = [
    () => new Response('unauthorized', { status: 401 }),
    () => new Response('ok', { status: 200 }),
  ];
  globalThis.fetch = async (url, opts) => {
    if (!captured) captured = opts;
    return responses2.shift()();
  };
  const session2 = new MendeleySession(m, { access_token: 'old' }, null, refresher);
  await session2.get('/foo');
  assert.equal(captured.headers.authorization, 'Bearer new_tok');
});

test('documents.iter yields items across pages', async () => {
  let page = 0;
  globalThis.fetch = async (url) => {
    if (url.includes('/documents')) {
      page += 1;
      if (page === 1) {
        return new Response(JSON.stringify([{ id: 'a' }, { id: 'b' }]), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            link: '</documents?page=2>; rel="next"',
          },
        });
      }
      return new Response(JSON.stringify([{ id: 'c' }]), { status: 200 });
    }
    throw new Error('unexpected ' + url);
  };
  const m = new Mendeley({ clientId: 'cid' });
  const session = new MendeleySession(m, { access_token: 'tok' });
  const out = [];
  for await (const doc of session.documents.iter()) {
    out.push(doc.id);
  }
  assert.deepEqual(out, ['a', 'b', 'c']);
});

/* ── token-refresh regression coverage (issue #52) ───────────────────────── */

/**
 * Build a fetch mock that records every call and serves a queue of
 * canned responses.  Each call consumes one response from the queue.
 *
 * The recorded `opts` is a shallow snapshot (with its own `headers`
 * object) so later mutations of the live `opts` by `session.request()`
 * — e.g. updating `Authorization` between the first 401 and the
 * refresh retry — do not bleed into earlier recorded calls.
 */
function recordingFetch(responses) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, opts: { ...opts, headers: { ...opts.headers } } });
    const next = responses.shift();
    if (!next) throw new Error('No mock response for ' + url);
    return next();
  };
  fn.calls = calls;
  return fn;
}

test('refresh coverage: first request uses the original access token', async () => {
  globalThis.fetch = recordingFetch([() => new Response('{}', { status: 200 })]);
  const m = new Mendeley({ clientId: 'cid' });
  const session = new MendeleySession(m, { access_token: 'orig_tok' });
  await session.get('/foo');
  assert.equal(globalThis.fetch.calls.length, 1);
  assert.equal(globalThis.fetch.calls[0].opts.headers.authorization, 'Bearer orig_tok');
});

test('refresh coverage: a 401 triggers exactly one refresh when a refresher is present', async () => {
  let refreshCount = 0;
  globalThis.fetch = recordingFetch([
    () => new Response('expired', { status: 401 }),
    () => new Response('{}', { status: 200 }),
  ]);
  const m = new Mendeley({ clientId: 'cid' });
  const refresher = {
    async refresh(s) {
      refreshCount += 1;
      s.token = { access_token: 'refreshed_tok' };
    },
  };
  const session = new MendeleySession(m, { access_token: 'orig_tok' }, null, refresher);
  await session.get('/foo');
  assert.equal(refreshCount, 1, 'refresher.refresh must be called exactly once');
  assert.equal(globalThis.fetch.calls.length, 2, 'fetch must be called exactly twice');
});

test('refresh coverage: the retried request uses the refreshed access token', async () => {
  globalThis.fetch = recordingFetch([
    () => new Response('expired', { status: 401 }),
    () => new Response('{}', { status: 200 }),
  ]);
  const m = new Mendeley({ clientId: 'cid' });
  const refresher = {
    async refresh(s) {
      s.token = { access_token: 'refreshed_tok' };
    },
  };
  const session = new MendeleySession(m, { access_token: 'orig_tok' }, null, refresher);
  await session.get('/foo');
  assert.equal(globalThis.fetch.calls[0].opts.headers.authorization, 'Bearer orig_tok');
  assert.equal(globalThis.fetch.calls[1].opts.headers.authorization, 'Bearer refreshed_tok');
});

test('refresh coverage: a second 401 raises an API error instead of looping', async () => {
  let refreshCount = 0;
  globalThis.fetch = recordingFetch([
    () => new Response('expired', { status: 401 }),
    () => new Response('still expired', { status: 401 }),
  ]);
  const m = new Mendeley({ clientId: 'cid' });
  const refresher = {
    async refresh(s) {
      refreshCount += 1;
      s.token = { access_token: 'refreshed_tok' };
    },
  };
  const session = new MendeleySession(m, { access_token: 'orig_tok' }, null, refresher);
  await assert.rejects(() => session.get('/foo'), /401/);
  assert.equal(refreshCount, 1, 'refresher is called once, not in a loop');
  assert.equal(
    globalThis.fetch.calls.length,
    2,
    'fetch is called exactly twice, then the session gives up',
  );
});

test('refresh coverage: no refresh happens if there is no refresher', async () => {
  globalThis.fetch = recordingFetch([() => new Response('expired', { status: 401 })]);
  const m = new Mendeley({ clientId: 'cid' });
  const session = new MendeleySession(m, { access_token: 'orig_tok' }); // no refresher
  await assert.rejects(() => session.get('/foo'), /401/);
  assert.equal(globalThis.fetch.calls.length, 1, 'no retry without a refresher');
});

test('refresh coverage: refresh failures propagate to the caller', async () => {
  globalThis.fetch = recordingFetch([() => new Response('expired', { status: 401 })]);
  const m = new Mendeley({ clientId: 'cid' });
  const refresher = {
    async refresh() {
      throw new Error('refresh endpoint offline');
    },
  };
  const session = new MendeleySession(m, { access_token: 'orig_tok' }, null, refresher);
  await assert.rejects(() => session.get('/foo'), /refresh endpoint offline/);
});

test('refresh coverage: stream:true raises on a non-OK response (no refresh path runs)', async () => {
  globalThis.fetch = recordingFetch([() => new Response('forbidden', { status: 403 })]);
  const m = new Mendeley({ clientId: 'cid' });
  const session = new MendeleySession(m, { access_token: 'tok' });
  await assert.rejects(() => session.get('/foo', { stream: true }), /403/);
  assert.equal(globalThis.fetch.calls.length, 1, 'stream:true does not retry a 403');
});

test('refresh coverage: stream:true with refresh — first 401 triggers refresh, retried 200 is returned', async () => {
  globalThis.fetch = recordingFetch([
    () => new Response('expired', { status: 401 }),
    () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }),
  ]);
  const m = new Mendeley({ clientId: 'cid' });
  const refresher = {
    async refresh(s) {
      s.token = { access_token: 'refreshed_tok' };
    },
  };
  const session = new MendeleySession(m, { access_token: 'orig_tok' }, null, refresher);
  const rsp = await session.get('/foo', { stream: true });
  assert.equal(rsp.status, 200);
  assert.equal(globalThis.fetch.calls.length, 2);
  // The retried response is returned to the caller untouched.
  assert.deepEqual(await rsp.json(), { ok: 1 });
});

test('refresh coverage: stream:true with a non-OK response after refresh raises', async () => {
  // The post-refresh retry is still 401. With stream:true, the !rsp.ok
  // check at the end of the request method calls raiseApiError.
  globalThis.fetch = recordingFetch([
    () => new Response('expired', { status: 401 }),
    () => new Response('still expired', { status: 401 }),
  ]);
  const m = new Mendeley({ clientId: 'cid' });
  const refresher = {
    async refresh(s) {
      s.token = { access_token: 'refreshed_tok' };
    },
  };
  const session = new MendeleySession(m, { access_token: 'orig_tok' }, null, refresher);
  await assert.rejects(() => session.get('/foo', { stream: true }), /401/);
});

/* ── raiseApiError body-read regression (issue #5) ───────────────────────── */

/**
 * Build a Response that records how many times its body is read.
 * Returns the Response plus a function to read the counts.
 */
function bodyTrackingResponse(body, { status = 200, headers = {} } = {}) {
  let jsonReads = 0;
  let textReads = 0;
  const rsp = new Response(body, { status, headers });
  const originalJson = rsp.json.bind(rsp);
  const originalText = rsp.text.bind(rsp);
  rsp.json = async () => {
    jsonReads += 1;
    return originalJson();
  };
  rsp.text = async () => {
    textReads += 1;
    return originalText();
  };
  return { rsp, counts: () => ({ jsonReads, textReads, bodyReads: jsonReads + textReads }) };
}

test('raiseApiError regression: reads the body exactly once for a JSON error', async () => {
  const { rsp, counts } = bodyTrackingResponse(
    JSON.stringify({ message: 'Catalog document not found' }),
    { status: 404, headers: { 'content-type': 'application/json' } },
  );
  globalThis.fetch = recordingFetch([() => rsp]);
  const m = new Mendeley({ clientId: 'cid' });
  const session = new MendeleySession(m, { access_token: 'tok' });
  await assert.rejects(() => session.get('/nonexistent'), /Catalog document not found/);
  // The fix is that the body is read exactly once. The old code would
  // call .json() then (on failure) .text(), reading twice.
  assert.equal(
    counts().bodyReads,
    1,
    `body must be read exactly once, got ${JSON.stringify(counts())}`,
  );
});

test('raiseApiError regression: reads the body exactly once for a non-JSON error', async () => {
  const { rsp, counts } = bodyTrackingResponse('plain text error body', {
    status: 500,
    headers: { 'content-type': 'text/plain' },
  });
  globalThis.fetch = recordingFetch([() => rsp]);
  const m = new Mendeley({ clientId: 'cid' });
  const session = new MendeleySession(m, { access_token: 'tok' });
  // Disable retry (#103) so this test exercises the original
  // raiseApiError body-read path on a 500, not the retry layer.
  await assert.rejects(
    () => session.get('/foo', { retry: { maxAttempts: 1 } }),
    /plain text error body/,
  );
  assert.equal(
    counts().bodyReads,
    1,
    `body must be read exactly once, got ${JSON.stringify(counts())}`,
  );
});

test('raiseApiError regression: reads the body exactly once for an empty body', async () => {
  const { rsp, counts } = bodyTrackingResponse('', { status: 502 });
  globalThis.fetch = recordingFetch([() => rsp]);
  const m = new Mendeley({ clientId: 'cid' });
  const session = new MendeleySession(m, { access_token: 'tok' });
  // Disable retry (#103) — see comment in the previous test.
  await assert.rejects(() => session.get('/foo', { retry: { maxAttempts: 1 } }), /status: 502/);
  assert.equal(
    counts().bodyReads,
    1,
    `body must be read exactly once even when empty, got ${JSON.stringify(counts())}`,
  );
});

test('raiseApiError regression: prefers structured error fields over the raw body', async () => {
  globalThis.fetch = recordingFetch([
    () =>
      new Response(
        JSON.stringify({
          error: 'invalid_grant',
          error_description: 'The authorization code is invalid',
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
  ]);
  const m = new Mendeley({ clientId: 'cid' });
  const session = new MendeleySession(m, { access_token: 'tok' });
  await assert.rejects(() => session.get('/foo'), /The authorization code is invalid/);
});

test('raiseApiError regression: 404 from a stream:true request reads the body once', async () => {
  // Issue #5 was first observed on the catalog lookup path, which goes
  // through the stream:false code path, but the stream:true branch also
  // calls raiseApiError and must not regress.
  const { rsp, counts } = bodyTrackingResponse(JSON.stringify({ message: 'Not found' }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });
  globalThis.fetch = recordingFetch([() => rsp]);
  const m = new Mendeley({ clientId: 'cid' });
  const session = new MendeleySession(m, { access_token: 'tok' });
  await assert.rejects(() => session.get('/foo', { stream: true }), /Not found/);
  assert.equal(counts().bodyReads, 1);
});

// ---- #103: retry on transient errors ----

function fastRetry() {
  // Override the retry layer so tests don't actually sleep.
  return { maxAttempts: 4, baseMs: 1, maxMs: 5, jitter: 0 };
}

test('session retries on 429 and succeeds on the next try (#103)', async () => {
  globalThis.fetch = mockFetch([
    () => new Response(JSON.stringify({ message: 'rate-limited' }), { status: 429 }),
    () => new Response('{}', { status: 200 }),
  ]);
  const m = new Mendeley({ clientId: 'cid' });
  const session = new MendeleySession(m, { access_token: 'tok' });
  const rsp = await session.get('/foo', { retry: fastRetry() });
  assert.equal(rsp.status, 200);
  assert.equal(globalThis.fetch.calls.length, 2, 'expected two fetch calls (1 retry)');
});

test('session retries on 503 and gives up after maxAttempts (#103)', async () => {
  globalThis.fetch = mockFetch([
    () => new Response('{}', { status: 503 }),
    () => new Response('{}', { status: 503 }),
    () => new Response('{}', { status: 503 }),
    () => new Response('{}', { status: 503 }),
  ]);
  const m = new Mendeley({ clientId: 'cid' });
  const session = new MendeleySession(m, { access_token: 'tok' });
  await assert.rejects(() => session.get('/foo', { retry: fastRetry() }), /status: 503/);
  assert.equal(globalThis.fetch.calls.length, 4, 'expected 4 attempts');
});

test('session does NOT retry on 404 (#103)', async () => {
  globalThis.fetch = mockFetch([() => new Response('{"message":"nope"}', { status: 404 })]);
  const m = new Mendeley({ clientId: 'cid' });
  const session = new MendeleySession(m, { access_token: 'tok' });
  await assert.rejects(() => session.get('/foo', { retry: fastRetry() }), /status: 404/);
  assert.equal(globalThis.fetch.calls.length, 1, 'expected exactly 1 fetch call (no retry)');
});

test('session retries on undici fetch failed TypeError (#103)', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls < 2) throw new TypeError('fetch failed');
    return new Response('{}', { status: 200 });
  };
  globalThis.fetch.calls = [];
  const m = new Mendeley({ clientId: 'cid' });
  const session = new MendeleySession(m, { access_token: 'tok' });
  const rsp = await session.get('/foo', { retry: fastRetry() });
  assert.equal(rsp.status, 200);
  assert.equal(calls, 2, 'expected 1 retry');
});

test('session gives up after retries on persistent network failure and wraps error (#103)', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };
  const m = new Mendeley({ clientId: 'cid' });
  const session = new MendeleySession(m, { access_token: 'tok' });
  await assert.rejects(
    () => session.get('/foo', { retry: fastRetry() }),
    /Network request failed.*Try again/s,
  );
});
