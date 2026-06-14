/**
 * Tests for issue #106: Unknown subcommand silently prints parent help
 * and exits 0.
 *
 * Previously, `mendeley library by-identifier` (or any unknown
 * subcommand) printed the full parent help text (~1.8 KB) and
 * exited 0, misleading scripts. Now (#106):
 *  - unknown subcommands exit 1 with a one-line JSON error;
 *  - the error includes "unknown subcommand: <name>";
 *  - when a close candidate exists, a "did you mean?" line is added
 *    (edit distance for typos, shared prefix for cases like
 *    `library by-identifier` → `by-tag`);
 *  - a pointer to `<cmd> --help` is always present;
 *  - `mendeley library` (no subcommand) still prints help, exit 0.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../../bin/mendeley.js', import.meta.url));

function createEnv() {
  const root = mkdtempSync(join(tmpdir(), 'mendeley-unknown-sub-'));
  const home = join(root, 'home');
  mkdirSync(join(home, '.mendeley'), { recursive: true });
  const configFile = join(root, 'credentials.json');
  writeFileSync(
    configFile,
    JSON.stringify({
      clientId: 'CLIENT_ID',
      redirectUri: 'http://localhost:11595',
      host: 'http://127.0.0.1:1',
    }),
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
  delete env.MENDELEY_CLIENT_ID;
  delete env.MENDELEY_CLIENT_SECRET;
  delete env.MENDELEY_ACCESS_TOKEN;
  delete env.MENDELEY_REFRESH_TOKEN;
  return env;
}

function runCli(args, { env, timeoutMs = 15000 } = {}) {
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
    }, timeoutMs);
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

test('unknown subcommand exits 1 (not 0) (#106)', async () => {
  const env = createEnv();
  const result = await runCli(['library', 'by-identifier', '10.5555/x'], { env });
  assert.equal(result.code, 1, `expected exit 1, got ${result.code}`);
});

test('unknown subcommand error mentions "unknown subcommand" and the bad name (#106)', async () => {
  const env = createEnv();
  const result = await runCli(['library', 'by-identifier'], { env });
  const output = result.stdout + result.stderr;
  assert.match(output, /unknown subcommand/i);
  assert.match(output, /by-identifier/);
});

test('unknown subcommand with a close candidate suggests it (#106)', async () => {
  const env = createEnv();
  // `by-identifier` shares the `by-` prefix with `by-tag` / `by-year`.
  const result = await runCli(['library', 'by-identifier'], { env });
  const output = result.stdout + result.stderr;
  assert.match(output, /did you mean/i);
  assert.match(output, /by-tag|by-year/);
});

test('typo with small edit distance gets an edit-distance suggestion (#106)', async () => {
  const env = createEnv();
  // `stat` is one edit away from `stats`.
  const result = await runCli(['library', 'stat'], { env });
  const output = result.stdout + result.stderr;
  assert.match(output, /did you mean/i);
  assert.match(output, /stats/);
});

test('unknown subcommand with no close match has no suggestion (#106)', async () => {
  const env = createEnv();
  const result = await runCli(['library', 'frobnicate'], { env });
  const output = result.stdout + result.stderr;
  assert.match(output, /unknown subcommand/i);
  assert.doesNotMatch(output, /did you mean/i);
});

test('unknown subcommand points at --help (#106)', async () => {
  const env = createEnv();
  const result = await runCli(['documents', 'foo'], { env });
  const output = result.stdout + result.stderr;
  assert.match(output, /mendeley documents --help/);
});

test('unknown subcommand does NOT dump the full help text (#106)', async () => {
  const env = createEnv();
  const result = await runCli(['library', 'foo'], { env });
  const output = result.stdout + result.stderr;
  // The error must be short. The old behaviour dumped ~1.8 KB of help.
  // A reasonable bound: the error envelope should be well under 500 bytes.
  assert.ok(output.length < 500, `expected a short error, got ${output.length} bytes:\n${output}`);
  assert.doesNotMatch(output, /Synopsis:/);
  assert.doesNotMatch(output, /Subcommands:/);
});

test('documents frobnicate exits 1 (#106)', async () => {
  const env = createEnv();
  const result = await runCli(['documents', 'frobnicate'], { env });
  assert.equal(result.code, 1, `expected exit 1, got ${result.code}`);
});

// Regression guards: things that must still work.

test('regression: `mendeley library` (no subcommand) still prints help, exit 0', async () => {
  const env = createEnv();
  const result = await runCli(['library'], { env });
  assert.equal(result.code, 0, `expected exit 0, got ${result.code}`);
  const output = result.stdout + result.stderr;
  assert.match(output, /Synopsis:/);
});

test('regression: `mendeley library --help` still prints help, exit 0', async () => {
  const env = createEnv();
  const result = await runCli(['library', '--help'], { env });
  assert.equal(result.code, 0, `expected exit 0, got ${result.code}`);
  const output = result.stdout + result.stderr;
  assert.match(output, /Subcommands:/);
});

test('regression: known subcommand `library stats` still parses (fails at network, not parse)', async () => {
  const env = createEnv();
  // `stats` is a real subcommand. With a fake host it will fail at the
  // network layer, but must NOT fail with "unknown subcommand".
  const result = await runCli(['library', 'stats'], { env });
  const output = result.stdout + result.stderr;
  assert.doesNotMatch(output, /unknown subcommand/i);
});

test('regression: unknown flag path still works (#11, not regressed by #106)', async () => {
  const env = createEnv();
  const result = await runCli(['documents', 'list', '--bogusflag'], { env });
  assert.equal(result.code, 1);
  const output = result.stdout + result.stderr;
  assert.match(output, /unknown flag/i);
});
