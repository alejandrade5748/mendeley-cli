/**
 * Unit tests for the auth helpers.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AuthorizationCodeAuthenticator,
  ImplicitGrantAuthenticator,
  buildAuthorizationUrl,
  deriveCodeChallenge,
  generateCodeVerifier,
  isLocalhost,
  refreshToken,
  fetchAuthorizationCodeToken,
  fetchClientCredentialsToken,
} from '../../src/auth.js';

test('generateCodeVerifier returns a URL-safe string of the requested length', () => {
  for (const length of [43, 64, 128]) {
    const v = generateCodeVerifier(length);
    assert.equal(v.length, length);
    assert.match(v, /^[A-Za-z0-9\-._~]+$/);
  }
});

test('generateCodeVerifier yields different values on each call', () => {
  const a = generateCodeVerifier();
  const b = generateCodeVerifier();
  assert.notEqual(a, b);
});

test('deriveCodeChallenge is deterministic for the same verifier', async () => {
  const v = generateCodeVerifier();
  const c1 = await deriveCodeChallenge(v);
  const c2 = await deriveCodeChallenge(v);
  assert.equal(c1, c2);
  assert.match(c1, /^[A-Za-z0-9_\-]+$/);
});

test('buildAuthorizationUrl includes all required parameters', () => {
  const url = buildAuthorizationUrl({
    authorizeUrl: 'https://example.com/oauth/authorize',
    clientId: 'cid',
    redirectUri: 'https://example.com/cb',
    state: 'state123',
  });
  const u = new URL(url);
  assert.equal(u.searchParams.get('client_id'), 'cid');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://example.com/cb');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('state'), 'state123');
  assert.equal(u.searchParams.get('scope'), 'all');
});

test('buildAuthorizationUrl appends PKCE params when a challenge is given', () => {
  const url = buildAuthorizationUrl({
    authorizeUrl: 'https://example.com/oauth/authorize',
    clientId: 'cid',
    redirectUri: 'https://example.com/cb',
    state: 'state123',
    codeChallenge: 'chal',
  });
  const u = new URL(url);
  assert.equal(u.searchParams.get('code_challenge'), 'chal');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
});

test('isLocalhost detects http://localhost URLs', () => {
  assert.equal(isLocalhost('http://localhost:8080/cb'), true);
  assert.equal(isLocalhost('http://127.0.0.1:8080/cb'), true);
  assert.equal(isLocalhost('http://0.0.0.0/cb'), true);
  assert.equal(isLocalhost('https://example.com/cb'), false);
  assert.equal(isLocalhost(''), false);
  assert.equal(isLocalhost(null), false);
});

test('fetchClientCredentialsToken posts a token request and parses the response', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    assert.equal(url, 'https://example.com/oauth/token');
    assert.equal(opts.method, 'POST');
    const body = new URLSearchParams(opts.body);
    assert.equal(body.get('grant_type'), 'client_credentials');
    const auth = opts.headers.authorization;
    const decoded = Buffer.from(auth.replace('Basic ', ''), 'base64').toString();
    assert.equal(decoded, 'cid:secret');
    return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const tok = await fetchClientCredentialsToken({
      tokenUrl: 'https://example.com/oauth/token',
      clientId: 'cid',
      clientSecret: 'secret',
    });
    assert.equal(tok.access_token, 'tok');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchClientCredentialsToken normalises text/plain error responses', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response('invalid_client', { status: 401, headers: { 'content-type': 'text/plain' } });
  try {
    await assert.rejects(() =>
      fetchClientCredentialsToken({
        tokenUrl: 'https://example.com/oauth/token',
        clientId: 'cid',
        clientSecret: 'secret',
      }),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchAuthorizationCodeToken exchanges a code for a token', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const body = new URLSearchParams(opts.body);
    assert.equal(body.get('grant_type'), 'authorization_code');
    assert.equal(body.get('code'), 'the_code');
    assert.equal(body.get('code_verifier'), 'verifier');
    return new Response(JSON.stringify({ access_token: 'tok' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const tok = await fetchAuthorizationCodeToken({
      tokenUrl: 'https://example.com/oauth/token',
      code: 'the_code',
      redirectUri: 'https://example.com/cb',
      clientId: 'cid',
      codeVerifier: 'verifier',
    });
    assert.equal(tok.access_token, 'tok');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('refreshToken posts a refresh_token grant', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const body = new URLSearchParams(opts.body);
    assert.equal(body.get('grant_type'), 'refresh_token');
    assert.equal(body.get('refresh_token'), 'rt');
    return new Response(JSON.stringify({ access_token: 'new_tok' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const tok = await refreshToken({
      tokenUrl: 'https://example.com/oauth/token',
      refreshToken: 'rt',
      clientId: 'cid',
    });
    assert.equal(tok.access_token, 'new_tok');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('refreshToken includes redirect_uri when supplied (#129)', async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, opts) => {
    captured = new URLSearchParams(opts.body);
    return new Response(JSON.stringify({ access_token: 'new_tok' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    await refreshToken({
      tokenUrl: 'https://example.com/oauth/token',
      refreshToken: 'rt',
      clientId: 'cid',
      redirectUri: 'http://localhost:11595/callback',
    });
    assert.equal(captured.get('redirect_uri'), 'http://localhost:11595/callback');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('refreshToken omits redirect_uri when not supplied (backward compat)', async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, opts) => {
    captured = new URLSearchParams(opts.body);
    return new Response(JSON.stringify({ access_token: 'new_tok' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    await refreshToken({
      tokenUrl: 'https://example.com/oauth/token',
      refreshToken: 'rt',
      clientId: 'cid',
    });
    assert.equal(captured.get('redirect_uri'), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('refreshToken for confidential client sends client_secret + Basic auth (#129)', async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody;
  let capturedHeaders;
  globalThis.fetch = async (url, opts) => {
    capturedBody = new URLSearchParams(opts.body);
    capturedHeaders = opts.headers;
    return new Response(JSON.stringify({ access_token: 'new_tok' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    await refreshToken({
      tokenUrl: 'https://example.com/oauth/token',
      refreshToken: 'rt',
      clientId: 'cid',
      clientSecret: 'secret',
      redirectUri: 'http://localhost:11595/callback',
    });
    // Full documented auth-code refresh payload.
    assert.equal(capturedBody.get('grant_type'), 'refresh_token');
    assert.equal(capturedBody.get('refresh_token'), 'rt');
    assert.equal(capturedBody.get('client_id'), 'cid');
    assert.equal(capturedBody.get('client_secret'), 'secret');
    assert.equal(capturedBody.get('redirect_uri'), 'http://localhost:11595/callback');
    assert.match(
      capturedHeaders.authorization,
      /^Basic /,
      'confidential client must use Basic auth',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

/* ── OAuth state validation ───────────────────────────────────────── */

function makeMendeley() {
  // Minimal stub: the authenticators only read host/clientId/clientSecret
  // and don't call any methods on the Mendeley instance.
  return {
    host: 'https://example.com',
    clientId: 'cid',
    clientSecret: 'secret',
    redirectUri: 'https://example.com/cb',
  };
}

test('AuthorizationCodeAuthenticator validates state from a full redirect URL', async () => {
  const auth = new AuthorizationCodeAuthenticator(makeMendeley(), 'EXPECTED_STATE');
  const originalFetch = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = async () => {
    fetched = true;
    return new Response(JSON.stringify({ access_token: 'tok' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const url = 'https://example.com/cb?code=the_code&state=EXPECTED_STATE';
    const session = await auth.authenticate(url);
    assert.ok(session);
    assert.equal(fetched, true, 'token request should fire on state match');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('AuthorizationCodeAuthenticator rejects state mismatch before any token request', async () => {
  const auth = new AuthorizationCodeAuthenticator(makeMendeley(), 'EXPECTED_STATE');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('fetch must not be called on state mismatch');
  };
  try {
    const url = 'https://example.com/cb?code=the_code&state=ATTACKER_STATE';
    await assert.rejects(() => auth.authenticate(url), /OAuth state mismatch/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('AuthorizationCodeAuthenticator accepts a bare code as the documented escape hatch', async () => {
  const auth = new AuthorizationCodeAuthenticator(makeMendeley(), 'EXPECTED_STATE');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ access_token: 'tok' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  try {
    const session = await auth.authenticate('BARE_CODE_VALUE');
    assert.ok(session);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ImplicitGrantAuthenticator validates state from the redirect fragment', async () => {
  const auth = new ImplicitGrantAuthenticator(makeMendeley(), 'EXPECTED_STATE');
  const url = 'https://example.com/cb#access_token=tok&state=EXPECTED_STATE&token_type=bearer';
  const session = await auth.authenticate(url);
  assert.equal(session.token.access_token, 'tok');
  assert.equal(session.token.state, 'EXPECTED_STATE');
});

test('ImplicitGrantAuthenticator rejects state mismatch', async () => {
  const auth = new ImplicitGrantAuthenticator(makeMendeley(), 'EXPECTED_STATE');
  const url = 'https://example.com/cb#access_token=tok&state=ATTACKER_STATE';
  await assert.rejects(() => auth.authenticate(url), /OAuth state mismatch/);
});

test('ImplicitGrantAuthenticator accepts a redirect with no state (legacy behavior)', async () => {
  const auth = new ImplicitGrantAuthenticator(makeMendeley(), 'EXPECTED_STATE');
  const url = 'https://example.com/cb#access_token=tok';
  const session = await auth.authenticate(url);
  assert.equal(session.token.access_token, 'tok');
});
