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
 * The headless login flow is:
 *
 *   1. `mendeley auth login`    — prints a login URL and prompts you
 *      to paste the redirect URL after visiting it in a browser.
 *   2. `~/.mendeley/token.json` is written automatically.
 */

import { existsSync, unlinkSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import process from 'node:process';

import { Mendeley } from '../../../src/client.js';
import { AuthorizationCodeAuthenticator, deriveCodeChallenge } from '../../../src/auth.js';
import { MendeleySession } from '../../../src/session.js';
import * as readline from 'node:readline';
import { buildSession, loadCredentials, loadToken, saveToken } from '../credentials.js';

const CONFIG_PATH = join(homedir(), '.mendeley', 'credentials.json');
const TOKEN_PATH = join(homedir(), '.mendeley', 'token.json');
const PENDING_PATH = join(homedir(), '.mendeley', 'pending_auth.json');

/* ── helpers ────────────────────────────────────────────────────── */

function savePending(obj) {
  writeFileSync(PENDING_PATH, JSON.stringify(obj, null, 2), { mode: 0o600 });
}

function loadPending() {
  try {
    const raw = JSON.parse(readFileSync(PENDING_PATH, 'utf8'));
    // Reject stale pending files (older than 10 minutes) — they
    // contain a single-use PKCE verifier that can no longer be
    // exchanged.
    if (raw && raw.created_at) {
      const age = Date.now() - new Date(raw.created_at).getTime();
      if (Number.isFinite(age) && age > 10 * 60 * 1000) {
        removePending();
        return null;
      }
    }
    return raw;
  } catch {
    return null;
  }
}

function removePending() {
  try {
    unlinkSync(PENDING_PATH);
  } catch {
    /* already gone */
  }
}

/**
 * Read a line from stdin, properly handling TTY on Windows.
 */
function readFromStdin() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    rl.question('', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
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

function tokenFilePath(flags = {}) {
  return flags.tokenFile || process.env.MENDELEY_TOKEN_FILE || TOKEN_PATH;
}

function authSuccessResponse(session, flags = {}, extra = {}) {
  return {
    ok: true,
    expires_in: session.token.expires_in ?? null,
    token_file: tokenFilePath(flags),
    ...extra,
  };
}

/* ── register ───────────────────────────────────────────────────── */

export function register(program) {
  const auth = program
    .command('auth')
    .description('manage authentication (login, tokens, credentials)')
    .longDescription(
      `Manage OAuth credentials and the saved access/refresh token.

  The Mendeley API supports two flows:  the authorisation-code flow
  (for end-users) and the client-credentials flow (for the developer's
  own library).  The CLI uses the authorisation-code flow with PKCE
  whenever a refresh token is available, and the client-credentials
  flow as a fallback.

  Files:
    • credentials.json  — clientId, clientSecret, redirectUri, host
    • token.json        — { access_token, refresh_token, expires_in, saved_at }
    • pending_auth.json — temporary PKCE verifier (auto-deleted after login)

  Override paths with $MENDELEY_CONFIG and $MENDELEY_TOKEN_FILE.`,
    )
    .example('mendeley auth set clientId 23562')
    .example('mendeley auth set clientSecret fXn0bokYBMNJVo5S')
    .example('mendeley auth set redirectUri http://localhost:11595')
    .example('mendeley auth login')
    .example('mendeley auth status')
    .example('mendeley auth whoami')
    .example('mendeley auth logout')
    .example('mendeley auth exchange "http://localhost:11595/?code=ABC&state=XYZ"');

  /* ── login ──────────────────────────────────────────────────── */

  auth
    .command('login')
    .description('log in to Mendeley (PKCE); saves token.json')
    .longDescription(
      `Prints the authorisation URL and prompts you to paste the
  redirect URL after visiting it in a browser.

  Steps:
    1. Run \`mendeley auth login\`
    2. Open the printed URL in a browser and log in
    3. Copy the full redirect URL from the browser address bar
    4. Paste it at the prompt`,
    )
    .option('--token-file <path>', 'where to save the token (default ~/.mendeley/token.json)')
    .example('mendeley auth login')
    .action(async (_args, flags, out) => {
      const creds = loadCredentials();
      if (!creds.clientId) {
        out.fail('clientId is not configured. Run `mendeley auth set clientId <id>` first.');
      }
      const mendeley = new Mendeley({
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        redirectUri: creds.redirectUri,
        host: creds.host,
      });

      // Generate PKCE flow and persist the verifier.
      const flow = await mendeley.startAuthorizationCodeFlowAsync({ usePkce: true });
      savePending({
        code_verifier: flow.codeVerifier,
        state: flow.state,
        redirect_uri: creds.redirectUri,
        created_at: new Date().toISOString(),
      });

      const loginUrl = flow.getLoginUrl();

      // Print the URL in plain text.
      process.stdout.write('\n');
      process.stdout.write('  Open this URL in your browser and log in:\n\n');
      process.stdout.write('  ' + loginUrl + '\n\n');
      process.stdout.write('  After logging in, paste the redirect URL here: ');

      const rawRedirectUrl = await readFromStdin();
      process.stdout.write('\n');

      if (!rawRedirectUrl) {
        removePending();
        out.fail('No URL provided. Run `mendeley auth login` again.');
        return;
      }

      try {
        const session = await flow.authenticate(rawRedirectUrl);
        saveToken(session.token, flags.tokenFile);
        removePending();

        const profile = await session.profiles.me;
        out.write(authSuccessResponse(session, flags, { profile }));
      } catch (err) {
        removePending();
        if (err.message.includes('invalid_grant') || err.message.includes('401')) {
          out.fail('Authentication failed. Please run `mendeley auth login` again.');
        } else {
          out.fail('Login failed: ' + err.message);
        }
      }
    });

  /* ── logout ─────────────────────────────────────────────────── */

  auth
    .command('logout')
    .description('forget the saved access token (deletes token.json)')
    .longDescription(
      `Removes ~/.mendeley/token.json (or $MENDELEY_TOKEN_FILE).  Credentials
  in credentials.json are left untouched.  Use \`mendeley auth login\`
  to re-authenticate.`,
    )
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

  /* ── cancel ─────────────────────────────────────────────────── */

  auth
    .command('cancel')
    .description('cancel a pending login (deletes pending_auth.json)')
    .longDescription(
      `If a previous \`mendeley auth login\` (or \`auth url\`) was started
  but never completed, this removes the stale PKCE verifier from
  ~/.mendeley/pending_auth.json.  Stale pending files are also
  auto-deleted after 10 minutes.`,
    )
    .example('mendeley auth cancel')
    .action(async (_args, _flags, out) => {
      const existed = existsSync(PENDING_PATH);
      removePending();
      out.write({ ok: true, removed: existed ? PENDING_PATH : null });
    });

  /* ── status ─────────────────────────────────────────────────── */

  auth
    .command('status')
    .description('show configured credentials and token state (no secrets)')
    .longDescription(
      `Print a JSON object summarising the configuration.  Client
  secrets and access tokens are never printed in full — only booleans
  indicating whether they are set, and the file paths.  This is the
  fastest way to debug a CLI setup.`,
    )
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
    .longDescription(
      `Performs a live API call with the saved token.  Returns the full
  profile JSON.  Exits non-zero if the token is missing, expired, or
  invalid.  This is the canonical "is the auth working?" check.`,
    )
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
    .longDescription(
      `Writes one key/value pair into credentials.json.  Recognised keys
  are:
    clientId       — OAuth client id (required for all flows)
    clientSecret   — OAuth client secret (required for client-credentials flow)
    redirectUri    — OAuth redirect URI (required for authorisation-code flow)
    host           — API base URL (default https://api.mendeley.com)

  The file is created if it does not exist.  Existing keys are
  preserved.`,
    )
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
    .longDescription(
      `Removes a key from credentials.json.  The file is left in place
  even if empty.`,
    )
    .example('mendeley auth unset clientSecret')
    .action(async ([key], _flags, out) => {
      const creds = loadCredentials();
      delete creds[key];
      const path = process.env.MENDELEY_CONFIG || CONFIG_PATH;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(creds, null, 2), { mode: 0o600 });
      out.write({ ok: true, removed: key });
    });

  /* ── url (print URL only, useful for AI agents) ───────────── */

  auth
    .command('url')
    .description('print the authorisation URL (use with auth exchange)')
    .longDescription(
      `Generates the authorisation URL and saves the PKCE verifier to
  ~/.mendeley/pending_auth.json.  Use this when you want the URL
  printed separately before calling \`mendeley auth exchange\`.

  Steps:
    1. Run \`mendeley auth url\` and copy the URL
    2. Visit the URL in a browser and log in
    3. Run \`mendeley auth exchange <redirect-url>\``,
    )
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
    .description(
      'exchange an authorisation code for a token (paste the full redirect URL or just the code)',
    )
    .longDescription(
      `Exchanges an authorisation code for an access token.  Accepts either
  the bare \`code\` value, or the full redirect URL (in which case the
  \`code\` query parameter is extracted automatically).  The PKCE
  verifier is loaded from ~/.mendeley/pending_auth.json (saved by a
  previous \`mendeley auth login\` run).`,
    )
    .example('mendeley auth exchange "http://localhost:11595/?code=ABC&state=XYZ"')
    .example('mendeley auth exchange ABC')
    .action(async ([raw], flags, out) => {
      const creds = loadCredentials();
      const code = extractCode(raw);

      const pending = loadPending();
      if (!pending || !pending.code_verifier) {
        out.fail(
          'No pending PKCE verifier found. Run `mendeley auth login` first, then ' +
            'visit the printed URL before running this command.',
        );
        return;
      }

      try {
        const mendeley = new Mendeley({
          clientId: creds.clientId,
          clientSecret: creds.clientSecret,
          redirectUri: creds.redirectUri,
          host: creds.host,
        });

        const codeChallenge = await deriveCodeChallenge(pending.code_verifier);
        const flow = new AuthorizationCodeAuthenticator(mendeley, pending.state, {
          codeVerifier: pending.code_verifier,
          codeChallenge,
        });

        const session = await flow.authenticate(code);
        saveToken(session.token, flags.tokenFile);

        out.write(authSuccessResponse(session, flags));
      } finally {
        removePending();
      }
    });
}
