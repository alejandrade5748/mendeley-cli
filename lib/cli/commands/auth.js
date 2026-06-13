/**
 * `mendeley auth ...` subcommand.
 *
 * Manages credentials and OAuth tokens.  Credentials are stored in
 * `~/.mendeley/credentials.json` (or `$MENDELEY_CONFIG`).  Access
 * tokens are stored in `~/.mendeley/token.json` (or `$MENDELEY_TOKEN_FILE`).
 *
 * The CLI uses PKCE for the authorisation-code flow and persists the
 * refresh token, so an agent only needs to log in once.
 *
 * The two-step headless login flow is:
 *
 *   1. `mendeley auth url`   — prints a login URL and saves the
 *      PKCE verifier to `~/.mendeley/pending_auth.json`.
 *   2. `mendeley auth exchange <redirect-url>` — loads the saved
 *      verifier, exchanges the code for a token, and writes
 *      `~/.mendeley/token.json`.
 */

import {
  existsSync,
  unlinkSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import process from 'node:process';

import { Mendeley } from '../../../src/client.js';
import {
  AuthorizationCodeAuthenticator,
  deriveCodeChallenge,
} from '../../../src/auth.js';
import { MendeleySession } from '../../../src/session.js';
import { listenForCode, openBrowser } from '../../../src/login.js';
import {
  buildSession,
  loadCredentials,
  loadToken,
  saveToken,
} from '../credentials.js';

const CONFIG_PATH = join(homedir(), '.mendeley', 'credentials.json');
const TOKEN_PATH = join(homedir(), '.mendeley', 'token.json');
const PENDING_PATH = join(homedir(), '.mendeley', 'pending_auth.json');

/* ── helpers ────────────────────────────────────────────────────── */

function mendeleyDir() {
  const dir = dirname(CONFIG_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function savePending(obj) {
  writeFileSync(PENDING_PATH, JSON.stringify(obj, null, 2), { mode: 0o600 });
}

function loadPending() {
  try {
    return JSON.parse(readFileSync(PENDING_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function removePending() {
  try { unlinkSync(PENDING_PATH); } catch { /* already gone */ }
}

function portFromUri(uri) {
  if (!uri) return null;
  try {
    return parseInt(new URL(uri).port, 10) || null;
  } catch {
    return null;
  }
}

function extractCode(raw) {
  if (!raw) return raw;
  if (raw.includes('?') || raw.includes('&') || raw.includes('=')) {
    try {
      const u = new URL(raw);
      return u.searchParams.get('code') || raw;
    } catch {
      const m = raw.match(/[?&]code=([^&]+)/);
      return m ? decodeURIComponent(m[1]) : raw;
    }
  }
  return raw;
}

/* ── register ───────────────────────────────────────────────────── */

export function register(program) {
  const auth = program
    .command('auth')
    .description('manage authentication (login, tokens, credentials)')
    .longDescription(`Manage OAuth credentials and the saved access/refresh token.

  The Mendeley API supports two flows:  the authorisation-code flow
  (for end-users) and the client-credentials flow (for the developer's
  own library).  The CLI uses the authorisation-code flow with PKCE
  whenever a refresh token is available, and the client-credentials
  flow as a fallback.

  Files:
    • credentials.json  — clientId, clientSecret, redirectUri, host
    • token.json        — { access_token, refresh_token, expires_in, saved_at }
    • pending_auth.json — temporary PKCE verifier (auto-deleted after exchange)

  Override paths with $MENDELEY_CONFIG and $MENDELEY_TOKEN_FILE.`)
    .example('mendeley auth set clientId 23562')
    .example('mendeley auth set clientSecret fXn0bokYBMNJVo5S')
    .example('mendeley auth set redirectUri http://localhost:11595')
    .example('mendeley auth login')
    .example('mendeley auth status')
    .example('mendeley auth whoami')
    .example('mendeley auth url')
    .example('mendeley auth exchange http://localhost:11595/?code=ABC&state=XYZ')
    .example('mendeley auth logout');

  /* ── login ──────────────────────────────────────────────────── */

  auth
    .command('login')
    .description('log in to Mendeley via a browser (PKCE); saves token.json')
    .longDescription(`Open a browser, complete the OAuth dance, and persist the
  resulting access/refresh tokens to ~/.mendeley/token.json.  The
  redirect URI defaults to the one in credentials.json (or whatever
  port is specified with --port).  Use --no-browser if you have no
  GUI; in that case the URL is printed and you should call
  \`mendeley auth exchange <code>\` after visiting it manually.`)
    .option('--port <port>', 'local callback port (defaults to the port in redirectUri)', '0')
    .option('--no-browser', 'do not open a browser; just print the URL')
    .option('--token-file <path>', 'where to save the token (default ~/.mendeley/token.json)')
    .example('mendeley auth login')
    .example('mendeley auth login --no-browser')
    .example('mendeley auth login --port 8080')
    .action(async (_args, flags, out) => {
      const creds = loadCredentials();
      if (!creds.clientId) {
        out.fail('clientId is not configured. Run `mendeley auth set clientId <id>` first.');
      }
      const requestedPort = parseInt(flags.port, 10) || 0;
      const listenPort = requestedPort || portFromUri(creds.redirectUri) || 0;

      // Start the listener BEFORE creating the flow so we know the actual port.
      const listener = await listenForCode(listenPort);
      // Build the redirect URI from the port the listener actually bound to.
      const actualRedirectUri = `http://localhost:${listener.port}`;
      const mendeley = new Mendeley({
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        redirectUri: actualRedirectUri,
        host: creds.host,
      });
      // Start ONE flow — its state is used for both the listener and the login URL.
      const flow = await mendeley.startAuthorizationCodeFlowAsync({ usePkce: true });
      // Set state BEFORE generating the URL so the listener is ready even if
      // the browser fires the redirect before we await.
      listener.setState(flow.state);
      const loginUrl = flow.getLoginUrl();
      out.write({ login_url: loginUrl, callback_port: listener.port });
      if (flags.browser !== false) {
        const opened = await openBrowser(loginUrl);
        if (!opened && out.format === 'text') {
          process.stderr.write('Could not open a browser.  Please copy the URL above.\n');
        }
      }
      const captured = await listener.captured;
      const session = await flow.authenticate(captured.code);
      saveToken(session.token, flags.tokenFile);
      out.write({
        ok: true,
        access_token: session.token.access_token,
        refresh_token: session.token.refresh_token || null,
        expires_in: session.token.expires_in || null,
        token_file: flags.tokenFile || process.env.MENDELEY_TOKEN_FILE || TOKEN_PATH,
        profile: await session.profiles.me,
      });
    });

  /* ── logout ─────────────────────────────────────────────────── */

  auth
    .command('logout')
    .description('forget the saved access token (deletes token.json)')
    .longDescription(`Removes ~/.mendeley/token.json (or $MENDELEY_TOKEN_FILE).  Credentials
  in credentials.json are left untouched.  Use \`mendeley auth login\`
  to re-authenticate.`)
    .example('mendeley auth logout')
    .action(async (_args, _flags, out) => {
      const file = process.env.MENDELEY_TOKEN_FILE || TOKEN_PATH;
      if (existsSync(file)) {
        unlinkSync(file);
        out.write({ ok: true, removed: file });
      } else {
        out.write({ ok: true, removed: null });
      }
    });

  /* ── status ─────────────────────────────────────────────────── */

  auth
    .command('status')
    .description('show configured credentials and token state (no secrets)')
    .longDescription(`Print a JSON object summarising the configuration.  Client
  secrets and access tokens are never printed in full — only booleans
  indicating whether they are set, and the file paths.  This is the
  fastest way to debug a CLI setup.`)
    .example('mendeley auth status')
    .action(async (_args, _flags, out) => {
      const creds = loadCredentials();
      const token = loadToken();
      const pending = loadPending();
      const safe = {
        clientId: creds.clientId || null,
        redirectUri: creds.redirectUri || null,
        host: creds.host || 'https://api.mendeley.com',
        hasClientSecret: Boolean(creds.clientSecret),
        hasAccessToken: Boolean(creds.accessToken || (token && token.access_token)),
        hasRefreshToken: Boolean(creds.refreshToken || (token && token.refresh_token)),
        hasPendingAuth: pending !== null,
        tokenFile: process.env.MENDELEY_TOKEN_FILE || TOKEN_PATH,
        configFile: process.env.MENDELEY_CONFIG || CONFIG_PATH,
        tokenSavedAt: token ? token.saved_at : null,
      };
      out.write(safe);
    });

  /* ── whoami ─────────────────────────────────────────────────── */

  auth
    .command('whoami')
    .description('call /profiles/me to confirm the token works')
    .longDescription(`Performs a live API call with the saved token.  Returns the full
  profile JSON.  Exits non-zero if the token is missing, expired, or
  invalid.  This is the canonical "is the auth working?" check.`)
    .example('mendeley auth whoami')
    .example('mendeley whoami')
    .action(async (_args, _flags, out) => {
      const session = await buildSession();
      const me = await session.profiles.me;
      out.write(me);
    });

  /* ── set ────────────────────────────────────────────────────── */

  auth
    .command('set <key> <value>')
    .description('set a credential value (clientId, clientSecret, redirectUri, host)')
    .longDescription(`Writes one key/value pair into credentials.json.  Recognised keys
  are:
    clientId       — OAuth client id (required for all flows)
    clientSecret   — OAuth client secret (required for client-credentials flow)
    redirectUri    — OAuth redirect URI (required for authorisation-code flow)
    host           — API base URL (default https://api.mendeley.com)

  The file is created if it does not exist.  Existing keys are
  preserved.`)
    .example('mendeley auth set clientId 23562')
    .example('mendeley auth set clientSecret abcdef0123456789')
    .example('mendeley auth set redirectUri http://localhost:11595')
    .action(async ([key, value], _flags, out) => {
      const creds = loadCredentials();
      creds[key] = value;
      const path = process.env.MENDELEY_CONFIG || CONFIG_PATH;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(creds, null, 2), { mode: 0o600 });
      out.write({ ok: true, key, path });
    });

  /* ── unset ──────────────────────────────────────────────────── */

  auth
    .command('unset <key>')
    .description('remove a credential value')
    .longDescription(`Removes a key from credentials.json.  The file is left in place
  even if empty.`)
    .example('mendeley auth unset clientSecret')
    .action(async ([key], _flags, out) => {
      const creds = loadCredentials();
      delete creds[key];
      const path = process.env.MENDELEY_CONFIG || CONFIG_PATH;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(creds, null, 2), { mode: 0o600 });
      out.write({ ok: true, removed: key });
    });

  /* ── url (headless step 1) ──────────────────────────────────── */

  auth
    .command('url')
    .description('print the authorisation URL without opening a browser')
    .longDescription(`Generates the authorisation URL (with PKCE challenge) and prints
  it along with the state, code_verifier, and redirect URI.  The
  PKCE verifier is saved to ~/.mendeley/pending_auth.json so that
  \`mendeley auth exchange\` can pick it up later.

  This is the first step of the headless login flow.  On a machine
  with no GUI:
    1.  Run \`mendeley auth url\` and copy the login_url.
    2.  Visit the URL on any device and complete the login.
    3.  After login the browser redirects to the redirect URI.
        Copy the FULL redirect URL from the browser address bar.
    4.  Run \`mendeley auth exchange "<redirect-url>"\`.`)
    .example('mendeley auth url')
    .example('mendeley auth exchange "http://localhost:11595/?code=ABC&state=XYZ"')
    .action(async (_args, _flags, out) => {
      const creds = loadCredentials();
      const mendeley = new Mendeley({
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        redirectUri: creds.redirectUri,
        host: creds.host,
      });
      const flow = await mendeley.startAuthorizationCodeFlowAsync({ usePkce: true });

      // Persist verifier so `auth exchange` can reuse it.
      savePending({
        code_verifier: flow.codeVerifier,
        state: flow.state,
        redirect_uri: creds.redirectUri,
        created_at: new Date().toISOString(),
      });

      out.write({
        login_url: flow.getLoginUrl(),
        state: flow.state,
        code_verifier: flow.codeVerifier,
        redirect_uri: creds.redirectUri,
        hint: 'After visiting the URL, run: mendeley auth exchange "<redirect-url>"',
      });
    });

  /* ── exchange (headless step 2) ─────────────────────────────── */

  auth
    .command('exchange <code>')
    .description('exchange an authorisation code for a token (paste the full redirect URL or just the code)')
    .longDescription(`Exchanges an authorisation code for an access token.  Accepts either
  the bare \`code\` value, or the full redirect URL (in which case the
  \`code\` query parameter is extracted automatically).

  This is the second step of the headless login flow.  It loads the
  PKCE verifier that was saved by \`mendeley auth url\` and uses it
  to complete the token exchange.`)
    .example('mendeley auth exchange "http://localhost:11595/?code=ABC&state=XYZ"')
    .example('mendeley auth exchange ABC')
    .action(async ([raw], flags, out) => {
      const creds = loadCredentials();
      const code = extractCode(raw);

      // Load the PKCE verifier saved by `mendeley auth url`.
      const pending = loadPending();
      if (!pending || !pending.code_verifier) {
        out.fail(
          'No pending PKCE verifier found. Run `mendeley auth url` first, then ' +
          'visit the printed URL before running this command.'
        );
        return;
      }

      try {
        // Reconstruct the authenticator with the *saved* verifier (not a new one).
        const mendeley = new Mendeley({
          clientId: creds.clientId,
          clientSecret: creds.clientSecret,
          redirectUri: creds.redirectUri,
          host: creds.host,
        });

        // Derive the challenge from the saved verifier so the URL matches.
        const codeChallenge = await deriveCodeChallenge(pending.code_verifier);
        const flow = new AuthorizationCodeAuthenticator(
          mendeley,
          pending.state,
          { codeVerifier: pending.code_verifier, codeChallenge }
        );

        const session = await flow.authenticate(code);
        saveToken(session.token, flags.tokenFile);

        out.write({
          ok: true,
          access_token: session.token.access_token,
          refresh_token: session.token.refresh_token,
          expires_in: session.token.expires_in,
        });
      } finally {
        // Always clean up — the verifier is single-use.
        removePending();
      }
    });
}
