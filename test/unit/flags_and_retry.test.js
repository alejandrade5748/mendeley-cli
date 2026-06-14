/**
 * Tests for issue #11: unknown CLI flags are silently accepted.
 * and issue #70: transient empty responses on list calls.
 */

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const CLI = fileURLToPath(new URL('../../bin/mendeley.js', import.meta.url));

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
});

/* ── #11: unknown flag rejection ────────────────────────────────── */

test('unknown flag is rejected with an error (#11)', async () => {
  const { env } = createEnv('http://127.0.0.1:1');
  const result = await runCli(['documents', 'list', '--totally-invalid-flag'], { env });
  assert.notEqual(result.code, 0, 'must exit non-zero');
  assert.match(result.stdout + result.stderr, /unknown flag.*totally-invalid-flag/);
});

test('typo flag gets a "did you mean" suggestion (#11)', async () => {
  const { env } = createEnv('http://127.0.0.1:1');
  // "documnet" is a common typo — should suggest "document" if it
  // exists, or at least be rejected.
  const result = await runCli(['documents', 'list', '--limt', '5'], { env });
  assert.notEqual(result.code, 0, 'must exit non-zero');
  assert.match(result.stdout + result.stderr, /unknown flag.*limt/i);
  assert.match(result.stdout + result.stderr, /Did you mean.*limit/i);
});

test('valid flags are not rejected (#11)', async () => {
  const captured = { requests: 0 };
  const { server, host } = await startApiServer(captured);
  servers.push(server);
  const { env } = createEnv(host);
  const result = await runCli(['documents', 'list', '--limit', '5', '--format', 'ids'], { env });
  assert.equal(result.code, 0, result.stderr || result.stdout);
});

test('global flags work on subcommands (#11)', async () => {
  const captured = { requests: 0 };
  const { server, host } = await startApiServer(captured);
  servers.push(server);
  const { env } = createEnv(host);
  // --format and --quiet are global; must not be rejected.
  const result = await runCli(['documents', 'list', '--format', 'ids', '--quiet'], { env });
  assert.equal(result.code, 0, result.stderr || result.stdout);
});

/* ── #70: transient empty response retry ────────────────────────── */

test('list retries once on transient empty first page (#70)', async () => {
  const captured = { listRequests: 0 };
  const { server, host } = await startApiServer(captured, { emptyFirst: true });
  servers.push(server);
  const { env } = createEnv(host);

  const result = await runCli(['documents', 'list', '--all', '--format', 'ids'], { env });

  assert.equal(result.code, 0, result.stderr || result.stdout);
  // First request returned empty, so a retry should have happened.
  assert.ok(
    captured.listRequests >= 2,
    `expected >= 2 list requests, got ${captured.listRequests}`,
  );
  // The output must contain items from the retry (non-empty).
  const out = result.stdout.trim();
  assert.ok(out.length > 0 && out !== '[]', 'output must not be empty');
});

test('list does NOT retry when mendeley-count header explicitly says 0 (#94)', async () => {
  const captured = { listRequests: 0 };
  const { server, host } = await startApiServer(captured, { countZero: true });
  servers.push(server);
  const { env } = createEnv(host);

  const result = await runCli(['documents', 'list', '--all', '--format', 'ids'], { env });

  assert.equal(result.code, 0, result.stderr || result.stdout);
  // Must NOT retry — the API explicitly said count=0.
  assert.equal(captured.listRequests, 1, `expected 1 request, got ${captured.listRequests}`);
});

test('list retries when count header is absent (preserves #70)', async () => {
  const captured = { listRequests: 0 };
  const { server, host } = await startApiServer(captured, { emptyFirst: true });
  servers.push(server);
  const { env } = createEnv(host);

  const result = await runCli(['documents', 'list', '--all', '--format', 'ids'], { env });

  assert.equal(result.code, 0, result.stderr || result.stdout);
  // Must retry — no count header means we can't tell if the empty is legit.
  assert.ok(captured.listRequests >= 2, `expected >= 2 requests, got ${captured.listRequests}`);
});

/* ── helpers ────────────────────────────────────────────────────── */

function createEnv(host) {
  const root = mkdtempSync(join(tmpdir(), 'mendeley-flags-'));
  const home = join(root, 'home');
  mkdirSync(join(home, '.mendeley'), { recursive: true });
  const configFile = join(root, 'credentials.json');
  writeFileSync(
    configFile,
    JSON.stringify({ clientId: 'CLIENT_ID', redirectUri: 'http://localhost:11595', host }),
  );
  const tokenFile = join(root, 'token.json');
  writeFileSync(
    tokenFile,
    JSON.stringify({ access_token: 'ACCESS_TOKEN', refresh_token: 'REFRESH', expires_in: 3600 }),
  );
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    MENDELEY_CONFIG: configFile,
    MENDELEY_TOKEN_FILE: tokenFile,
  };
  delete env.MENDELEY_CLIENT_ID;
  delete env.MENDELEY_CLIENT_SECRET;
  delete env.MENDELEY_ACCESS_TOKEN;
  delete env.MENDELEY_REFRESH_TOKEN;
  return { env, home };
}

function startApiServer(captured, { emptyFirst = false, countZero = false } = {}) {
  const server = createServer((req, res) => {
    const url = req.url.split('?')[0];

    if (req.method === 'GET' && url === '/documents') {
      captured.listRequests = (captured.listRequests || 0) + 1;

      // #94: API explicitly says count=0 — should NOT trigger a retry.
      if (countZero) {
        res.setHeader('content-type', 'application/vnd.mendeley-document.1+json');
        res.setHeader('mendeley-count', '0');
        res.end(JSON.stringify([]));
        return;
      }

      // Simulate a transient empty response: return [] on the first
      // request, real data on the second.
      if (emptyFirst && captured.listRequests === 1) {
        res.setHeader('content-type', 'application/vnd.mendeley-document.1+json');
        res.end(JSON.stringify([]));
        return;
      }

      res.setHeader('content-type', 'application/vnd.mendeley-document.1+json');
      res.end(
        JSON.stringify([
          { id: 'doc-1', title: 'Paper A' },
          { id: 'doc-2', title: 'Paper B' },
        ]),
      );
      return;
    }

    res.statusCode = 404;
    res.end('not found');
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, host: `http://127.0.0.1:${server.address().port}` });
    });
    server.on('error', reject);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function runCli(args, { env, input = '' }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`CLI timed out: ${args.join(' ')}`));
    }, 10000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(input);
  });
}
