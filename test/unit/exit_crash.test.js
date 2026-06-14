/**
 * Tests for issue #90: libuv crash on multi-request error paths.
 *
 * Output.fail() previously called process.exit(), which trips a libuv
 * UV_HANDLE_CLOSING assertion on Windows when fetch keep-alive handles
 * are still open. Now fail() throws a CliExitError sentinel, and the
 * top-level handler sets process.exitCode + lets the event loop drain.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Output, CliExitError } from '../../lib/cli/output.js';

const CLI = fileURLToPath(new URL('../../bin/mendeley.js', import.meta.url));

/* ── Unit tests for the sentinel mechanism ──────────────────────── */

test('Output.fail throws CliExitError, does not call process.exit', () => {
  const out = new Output('json');
  // Capture stdout to verify the error is written.
  const original = process.stdout.write.bind(process.stdout);
  let captured = '';
  process.stdout.write = (chunk) => {
    captured += chunk;
    return true;
  };
  try {
    assert.throws(
      () => out.fail('test error', 2),
      (err) => err instanceof CliExitError && err.exitCode === 2,
    );
  } finally {
    process.stdout.write = original;
  }
  // The error JSON must have been written before the throw.
  assert.match(captured, /test error/);
  // process.exitCode must NOT have been set by fail() itself.
  // (The top-level handler does that.)
});

test('CliExitError carries the exit code', () => {
  const err = new CliExitError('msg', 42);
  assert.equal(err.exitCode, 42);
  assert.equal(err.message, 'msg');
  assert.equal(err.name, 'CliExitError');
});

test('Output.writeError writes without throwing', () => {
  const out = new Output('json');
  const original = process.stdout.write.bind(process.stdout);
  let captured = '';
  process.stdout.write = (chunk) => {
    captured += chunk;
    return true;
  };
  try {
    out.writeError('plain error');
    // Must not throw.
    assert.ok(true);
  } finally {
    process.stdout.write = original;
  }
  assert.match(captured, /plain error/);
});

/* ── Integration: multi-request command doesn't crash (#90) ─────── */

function startMockServer() {
  const server = createServer((req, res) => {
    if (req.url.startsWith('/metadata')) {
      res.writeHead(200, { 'content-type': 'application/vnd.mendeley-document-lookup.1+json' });
      res.end(JSON.stringify({ catalog_id: 'cat-1', score: 0.9 }));
      return;
    }
    // /catalog/* → 404 to trigger the error path
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'not found' }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, host: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function closeServer(server) {
  return new Promise((r) => server.close(r));
}

function runCli(args, { env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timed out: ${args.join(' ')}`));
    }, 15000);
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
    child.stdin.end();
  });
}

test('catalog lookup with 404 on 2nd request: no crash, clean exit 1 (#90)', async () => {
  const { server, host } = await startMockServer();
  try {
    const root = mkdtempSync(join(tmpdir(), 'mendeley-crash-'));
    const home = join(root, 'home');
    mkdirSync(join(home, '.mendeley'), { recursive: true });
    const configFile = join(root, 'credentials.json');
    writeFileSync(
      configFile,
      JSON.stringify({ clientId: 'C', redirectUri: 'http://localhost:1', host }),
    );
    const tokenFile = join(root, 'token.json');
    writeFileSync(
      tokenFile,
      JSON.stringify({ access_token: 'A', refresh_token: 'R', expires_in: 3600 }),
    );
    const env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      MENDELEY_CONFIG: configFile,
      MENDELEY_TOKEN_FILE: tokenFile,
    };

    const result = await runCli(['catalog', 'lookup', '--title', 'test'], { env });

    // Must exit 1 (not 127, not 0).
    assert.equal(result.code, 1, `expected exit 1, got ${result.code}`);
    // Must NOT contain the libuv assertion crash.
    const output = result.stdout + result.stderr;
    assert.doesNotMatch(output, /UV_HANDLE_CLOSING|async\.c/i);
    // Must contain the clean error JSON.
    assert.match(output, /ok.*false/i);
    assert.match(output, /404/i);
  } finally {
    await closeServer(server);
  }
});
