/**
 * OAuth2 authentication flows for the Mendeley API.
 *
 * The SDK supports three flows:
 *
 * 1. **Client credentials** (server-to-server, no user).  Only provides
 *    read-only access to the public Mendeley catalog.
 * 2. **Authorization code** (user logs in once, then the SDK can act as
 *    that user).  Supports PKCE for public clients (e.g. a CLI).
 * 3. **Implicit grant** (legacy, kept for completeness).  The user's
 *    browser returns the access token directly in the URL fragment.
 *
 * The token endpoint lives at `${host}/oauth/token` and the authorisation
 * endpoint at `${host}/oauth/authorize`.
 */

import { MendeleySession } from './session.js';

/**
 * Some Mendeley error responses come back as `text/plain` with a body that
 * is not valid JSON.  Normalise them to look like a regular JSON error
 * response so downstream code can handle them uniformly.
 *
 * @param {Response} rsp
 * @returns {Promise<Response>}
 */
async function normaliseTokenResponse(rsp) {
  const ct = rsp.headers.get('content-type') || '';
  if (ct.startsWith('application/json')) {
    return rsp;
  }
  const text = await rsp.text();
  return new Response(
    JSON.stringify({
      error: 'invalid_client',
      error_description: text,
    }),
    {
      status: rsp.status,
      headers: { 'content-type': 'application/json' },
    },
  );
}

/**
 * Perform a `client_credentials` token request.
 *
 * @param {object} options
 * @param {string} options.tokenUrl
 * @param {string} options.clientId
 * @param {string} options.clientSecret
 * @param {string[]} [options.scope]
 * @returns {Promise<object>} the token response
 */
export async function fetchClientCredentialsToken({
  tokenUrl,
  clientId,
  clientSecret,
  scope = ['all'],
}) {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: scope.join(' '),
  });
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const rsp = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${auth}`,
      accept: 'application/json',
    },
    body,
  });
  const norm = await normaliseTokenResponse(rsp);
  if (!norm.ok) {
    throw new Error(`OAuth2 token request failed: ${norm.status} ${await norm.text()}`);
  }
  return norm.json();
}

/**
 * Exchange an authorization code for an access token.
 *
 * @param {object} options
 * @param {string} options.tokenUrl
 * @param {string} options.code
 * @param {string} options.redirectUri
 * @param {string} options.clientId
 * @param {string} [options.clientSecret]
 * @param {string} [options.codeVerifier] PKCE verifier, if used
 * @returns {Promise<object>} the token response
 */
export async function fetchAuthorizationCodeToken({
  tokenUrl,
  code,
  redirectUri,
  clientId,
  clientSecret,
  codeVerifier,
}) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
  });
  if (codeVerifier) body.set('code_verifier', codeVerifier);
  if (clientSecret) body.set('client_secret', clientSecret);

  const headers = {
    'content-type': 'application/x-www-form-urlencoded',
    accept: 'application/json',
  };
  if (clientSecret) {
    headers.authorization =
      'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  }

  const rsp = await fetch(tokenUrl, { method: 'POST', headers, body });
  const norm = await normaliseTokenResponse(rsp);
  if (!norm.ok) {
    throw new Error(`OAuth2 token exchange failed: ${norm.status} ${await norm.text()}`);
  }
  return norm.json();
}

/**
 * Refresh an access token using a refresh_token grant.
 *
 * Per the Mendeley authorization-code documentation, refresh requests
 * include `redirect_uri` (#129). It is sent whenever the caller
 * supplies one (both callers below always do for the auth-code flow).
 *
 * @param {object} options
 * @param {string} options.tokenUrl
 * @param {string} options.refreshToken
 * @param {string} options.clientId
 * @param {string} [options.clientSecret]
 * @param {string} [options.redirectUri]
 * @returns {Promise<object>} the refreshed token
 */
export async function refreshToken({
  tokenUrl,
  refreshToken,
  clientId,
  clientSecret,
  redirectUri,
}) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });
  if (clientSecret) body.set('client_secret', clientSecret);
  if (redirectUri) body.set('redirect_uri', redirectUri);

  const headers = {
    'content-type': 'application/x-www-form-urlencoded',
    accept: 'application/json',
  };
  if (clientSecret) {
    headers.authorization =
      'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  }

  const rsp = await fetch(tokenUrl, { method: 'POST', headers, body });
  const norm = await normaliseTokenResponse(rsp);
  if (!norm.ok) {
    throw new Error(`OAuth2 refresh failed: ${norm.status} ${await norm.text()}`);
  }
  return norm.json();
}

/**
 * Generate a PKCE code verifier (43-128 char URL-safe string).
 */
export function generateCodeVerifier(length = 64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = new Uint8Array(length);
  // Use Web Crypto if available (Node 18+ and browsers).
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

/**
 * Derive a PKCE code challenge (S256) from a verifier.
 */
export async function deriveCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Default state generator (random URL-safe string).
 */
export class DefaultStateGenerator {
  generateState(length = 30) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const bytes = new Uint8Array(length);
    if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
      globalThis.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    let out = '';
    for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
    return out;
  }
}

/**
 * Build the URL the user must visit to log in.
 *
 * @param {object} params
 * @param {string} params.authorizeUrl
 * @param {string} params.clientId
 * @param {string} params.redirectUri
 * @param {string} params.state
 * @param {string} [params.codeChallenge]
 * @returns {string}
 */
export function buildAuthorizationUrl({
  authorizeUrl,
  clientId,
  redirectUri,
  state,
  codeChallenge,
  scope = 'all',
}) {
  const url = new URL(authorizeUrl);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', codeChallenge ? 'code' : 'code');
  url.searchParams.set('state', state);
  url.searchParams.set('scope', scope);
  if (codeChallenge) {
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  return url.toString();
}

/**
 * @returns {boolean} `true` if `url` is a localhost http URL.
 */
export function isLocalhost(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && ['127.0.0.1', '0.0.0.0', 'localhost'].includes(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Authenticator for the **client credentials** flow.
 */
export class ClientCredentialsAuthenticator {
  constructor(mendeley) {
    this.mendeley = mendeley;
    this.tokenUrl = mendeley.host + '/oauth/token';
  }

  /** Perform the token request and return an authenticated session. */
  async authenticate() {
    const token = await fetchClientCredentialsToken({
      tokenUrl: this.tokenUrl,
      clientId: this.mendeley.clientId,
      clientSecret: this.mendeley.clientSecret,
    });
    return new MendeleySession(
      this.mendeley,
      token,
      null,
      new ClientCredentialsTokenRefresher(this),
    );
  }
}

/**
 * Authenticator for the **authorization code** flow.  Supports PKCE.
 *
 * Usage:
 *
 *     const auth = mendeley.startAuthorizationCodeFlow();
 *     const url = auth.getLoginUrl();
 *     // ... user visits url and gets redirected back to redirect_uri ...
 *     const session = await auth.authenticate(redirectUrl);
 */
export class AuthorizationCodeAuthenticator {
  constructor(mendeley, state, { codeChallenge, codeVerifier } = {}) {
    this.mendeley = mendeley;
    this.state = state;
    this.tokenUrl = mendeley.host + '/oauth/token';
    this.authorizeUrl = mendeley.host + '/oauth/authorize';
    this.codeChallenge = codeChallenge;
    this.codeVerifier = codeVerifier;
  }

  /** URL the user should visit to log in and grant access. */
  getLoginUrl() {
    return buildAuthorizationUrl({
      authorizeUrl: this.authorizeUrl,
      clientId: this.mendeley.clientId,
      redirectUri: this.mendeley.redirectUri,
      state: this.state,
      codeChallenge: this.codeChallenge,
    });
  }

  /**
   * Exchange the authorization `code` (or the full redirect URL containing
   * it) for an access token and return a session.
   *
   * If a full redirect URL is provided, the `state` parameter is parsed
   * and compared against the expected state. A mismatch throws before any
   * token request is made. Passing a bare authorization code (no URL)
   * skips state validation — this is the documented escape hatch for
   * headless / advanced usage where the caller is certain of the code's
   * origin.
   */
  async authenticate(codeOrUrl) {
    const code = extractCode(codeOrUrl);
    const redirectState = parseRedirectState(codeOrUrl);
    assertStateMatches(this.state, redirectState, 'authorization-code');
    const token = await fetchAuthorizationCodeToken({
      tokenUrl: this.tokenUrl,
      code,
      redirectUri: this.mendeley.redirectUri,
      clientId: this.mendeley.clientId,
      clientSecret: this.mendeley.clientSecret,
      codeVerifier: this.codeVerifier,
    });
    return new MendeleySession(
      this.mendeley,
      token,
      null,
      new AuthorizationCodeTokenRefresher(this),
    );
  }
}

/**
 * Authenticator for the **implicit grant** flow.  Deprecated but kept
 * for compatibility with the original Python SDK.
 */
export class ImplicitGrantAuthenticator {
  constructor(mendeley, state) {
    this.mendeley = mendeley;
    this.state = state;
    this.authorizeUrl = mendeley.host + '/oauth/authorize';
  }

  getLoginUrl() {
    const url = new URL(this.authorizeUrl);
    url.searchParams.set('client_id', this.mendeley.clientId);
    url.searchParams.set('redirect_uri', this.mendeley.redirectUri);
    url.searchParams.set('response_type', 'token');
    url.searchParams.set('state', this.state);
    url.searchParams.set('scope', 'all');
    return url.toString();
  }

  /**
   * Parse the access token from a redirect URL fragment.
   *
   * If the fragment carries a `state` parameter, it is compared against
   * the expected state. A mismatch throws before the session is
   * constructed. The legacy implicit flow did not always include state;
   * for backward compatibility, a missing or empty `state` on the
   * redirect is accepted without comparison.
   */
  async authenticate(redirectUrl) {
    const fragment = redirectUrl.split('#')[1] || '';
    const params = new URLSearchParams(fragment);
    const accessToken = params.get('access_token');
    if (!accessToken) {
      throw new Error('No access_token found in redirect URL fragment');
    }
    const redirectState = params.get('state');
    assertStateMatches(this.state, redirectState, 'implicit-grant');
    const token = {
      access_token: accessToken,
      token_type: params.get('token_type') || 'bearer',
      expires_in: parseInt(params.get('expires_in') || '3600', 10),
      state: redirectState,
    };
    return new MendeleySession(this.mendeley, token);
  }
}

/** Extract the `code` query parameter from a URL or return the string. */
function extractCode(codeOrUrl) {
  if (!codeOrUrl) return '';
  if (codeOrUrl.includes('?') || codeOrUrl.includes('&')) {
    try {
      const u = new URL(codeOrUrl);
      return u.searchParams.get('code') || codeOrUrl;
    } catch {
      return codeOrUrl;
    }
  }
  return codeOrUrl;
}

/**
 * Parse a redirect URL and return the OAuth `state` value from the query
 * string (auth-code flow) or fragment (implicit flow). Returns null if
 * the input is not a URL, can't be parsed, or carries no state.
 */
function parseRedirectState(redirectUrl) {
  if (!redirectUrl) return null;
  if (!redirectUrl.includes('?') && !redirectUrl.includes('#')) return null;
  let u;
  try {
    u = new URL(redirectUrl);
  } catch {
    return null;
  }
  const queryState = u.searchParams.get('state');
  if (queryState) return queryState;
  const fragment = u.hash ? u.hash.slice(1) : '';
  if (!fragment) return null;
  return new URLSearchParams(fragment).get('state');
}

/**
 * Validate the state from a redirect against the expected state.
 *
 * - If both are present and differ, throws an `Error` whose message
 *   identifies the flow and the cause.
 * - If either side is missing / empty, the check is skipped silently so
 *   that bare-code (advanced) and legacy implicit redirects still work.
 */
function assertStateMatches(expected, actual, flow) {
  if (!expected || !actual) return;
  if (expected !== actual) {
    throw new Error(
      `OAuth state mismatch in ${flow} flow: this may indicate a CSRF ` +
        `attack, a stale session, or a typo in the redirect URL. ` +
        `Start a new auth flow and try again.`,
    );
  }
}

class ClientCredentialsTokenRefresher {
  constructor(authenticator) {
    this.authenticator = authenticator;
  }
  async refresh(session) {
    const token = await fetchClientCredentialsToken({
      tokenUrl: this.authenticator.tokenUrl,
      clientId: this.authenticator.mendeley.clientId,
      clientSecret: this.authenticator.mendeley.clientSecret,
    });
    session.token = token;
  }
}

class AuthorizationCodeTokenRefresher {
  constructor(authenticator) {
    this.authenticator = authenticator;
  }
  async refresh(session) {
    if (!session.token.refresh_token) {
      throw new Error('No refresh_token available; re-authentication required');
    }
    const token = await refreshToken({
      tokenUrl: this.authenticator.tokenUrl,
      refreshToken: session.token.refresh_token,
      clientId: this.authenticator.mendeley.clientId,
      clientSecret: this.authenticator.mendeley.clientSecret,
      redirectUri: this.authenticator.mendeley.redirectUri,
    });
    session.token = token;
  }
}
