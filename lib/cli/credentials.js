/**
 * Credential resolution for the CLI.
 *
 * The CLI looks for credentials in this order:
 *
 *   1. Environment variables (`MENDELEY_CLIENT_ID`, `MENDELEY_CLIENT_SECRET`,
 *      `MENDELEY_REDIRECT_URI`, `MENDELEY_ACCESS_TOKEN`, `MENDELEY_REFRESH_TOKEN`).
 *   2. A JSON file at `$MENDELEY_CONFIG` (default `~/.mendeley/credentials.json`).
 *   3. A token file at `$MENDELEY_TOKEN_FILE` (default `~/.mendeley/token.json`).
 *
 * If a pre-existing access/refresh token is found the CLI uses it
 * directly, attaching a refresher that calls the token endpoint with the
 * stored refresh token whenever the access token expires.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import process from 'node:process';

import { refreshToken } from '../../src/auth.js';
import { MendeleySession } from '../../src/session.js';

const DEFAULT_CONFIG = join(homedir(), '.mendeley', 'credentials.json');
const DEFAULT_TOKEN = join(homedir(), '.mendeley', 'token.json');

/**
 * Allowlist of keys that may be persisted to credentials.json.
 *
 * `auth set` and `auth unset` use this to reject non-credential keys
 * and to filter the file on write.  Anything not in this list is
 * considered sensitive runtime material (tokens, refresh tokens, etc.)
 * and must live in token.json, not credentials.json.
 */
export const ALLOWED_CREDENTIAL_KEYS = Object.freeze([
  'clientId',
  'clientSecret',
  'redirectUri',
  'host',
]);

/**
 * Strip non-allowlisted keys from a credentials object.
 * @param {object} creds
 * @returns {object} a new object containing only allowlisted keys
 */
export function sanitizeCredentials(creds) {
  const out = {};
  for (const k of ALLOWED_CREDENTIAL_KEYS) {
    if (creds[k] !== undefined) out[k] = creds[k];
  }
  return out;
}

/**
 * Read the credentials.json file directly, without merging in tokens or
 * environment variables.  Returns `{}` if the file does not exist.
 *
 * Use this from `auth set` / `auth unset` so that token material loaded
 * from `token.json` (or `MENDELEY_ACCESS_TOKEN` / `MENDELEY_REFRESH_TOKEN`
 * env vars) cannot accidentally be persisted into credentials.json.
 */
export function loadCredentialsFromFile() {
  const configPath = process.env.MENDELEY_CONFIG || DEFAULT_CONFIG;
  if (!existsSync(configPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    return sanitizeCredentials(parsed && typeof parsed === 'object' ? parsed : {});
  } catch (err) {
    throw new Error(`Failed to read ${configPath}: ${err.message}`);
  }
}

/** @returns {object} parsed credentials, never `null`. */
export function loadCredentials() {
  const configPath = process.env.MENDELEY_CONFIG || DEFAULT_CONFIG;
  let creds = {};
  if (existsSync(configPath)) {
    try {
      creds = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch (err) {
      throw new Error(`Failed to read ${configPath}: ${err.message}`);
    }
  }

  // Environment variables override file values.
  if (process.env.MENDELEY_CLIENT_ID) creds.clientId = process.env.MENDELEY_CLIENT_ID;
  if (process.env.MENDELEY_CLIENT_SECRET) creds.clientSecret = process.env.MENDELEY_CLIENT_SECRET;
  if (process.env.MENDELEY_REDIRECT_URI) creds.redirectUri = process.env.MENDELEY_REDIRECT_URI;
  if (process.env.MENDELEY_HOST) creds.host = process.env.MENDELEY_HOST;
  if (process.env.MENDELEY_ACCESS_TOKEN) creds.accessToken = process.env.MENDELEY_ACCESS_TOKEN;
  if (process.env.MENDELEY_REFRESH_TOKEN) creds.refreshToken = process.env.MENDELEY_REFRESH_TOKEN;

  // Fall back to the saved token in token.json when no env var or
  // credentials.json entry is present.  This is the normal case after
  // a successful `mendeley auth login` — the user has credentials.json
  // (client id/secret/redirect URI) and a separate token.json.
  if (!creds.accessToken || !creds.refreshToken) {
    const token = loadToken();
    if (token) {
      if (!creds.accessToken && token.access_token) creds.accessToken = token.access_token;
      if (!creds.refreshToken && token.refresh_token) creds.refreshToken = token.refresh_token;
    }
  }

  return creds;
}

/**
 * Persist a token (and optional refresh token) to disk.
 * @param {object} token
 * @param {string} [path]
 */
export function saveToken(token, path) {
  const file = path || process.env.MENDELEY_TOKEN_FILE || DEFAULT_TOKEN;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ saved_at: new Date().toISOString(), ...token }, null, 2), {
    mode: 0o600,
  });
  return file;
}

/** Read a saved token, if any. */
export function loadToken() {
  const file = process.env.MENDELEY_TOKEN_FILE || DEFAULT_TOKEN;
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Build a {@link MendeleySession} from saved credentials / token.
 *
 * The session includes a refresher that uses the configured refresh
 * token (and client secret, if available) to mint a new access token
 * whenever one is needed.
 *
 * @param {object} [options]
 * @param {string} [options.flow] 'client-credentials' or 'user' (default
 *   'user' if access+refresh tokens are present, else 'client-credentials')
 */
export async function buildSession({ flow } = {}) {
  const creds = loadCredentials();
  if (!creds.clientId) {
    throw new Error(
      'No client id configured. Set MENDELEY_CLIENT_ID or add it to ~/.mendeley/credentials.json',
    );
  }
  const { Mendeley } = await import('../../src/client.js');
  const mendeley = new Mendeley({
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    redirectUri: creds.redirectUri,
    host: creds.host,
  });

  const token =
    creds.accessToken || creds.refreshToken
      ? {
          access_token: creds.accessToken,
          refresh_token: creds.refreshToken,
        }
      : null;
  const chosenFlow = flow || (token ? 'user' : 'client-credentials');

  if (chosenFlow === 'client-credentials') {
    return mendeley.startClientCredentialsFlow().authenticate();
  }
  if (!token) {
    throw new Error('No access token configured. Run `mendeley auth login` to obtain one.');
  }
  const refresher = {
    async refresh(session) {
      const newToken = await refreshToken({
        tokenUrl: mendeley.host + '/oauth/token',
        refreshToken: session.token.refresh_token,
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        redirectUri: creds.redirectUri,
      });
      session.token = { ...session.token, ...newToken };
      saveToken(session.token);
    },
  };
  return new MendeleySession(mendeley, token, null, refresher);
}

/** Print credentials to stdout (for inspection or export). */
export function dumpCredentials() {
  return loadCredentials();
}
