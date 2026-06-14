/**
 * Tests for issues #20 and #21:
 * - #20: library dedupe --by <invalid> silently falls back to a default
 * - #21: documents create/update --data "" returns API error instead of CLI error
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
  const root = mkdtempSync(join(tmpdir(), 'mendeley-validation-'));
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
  return env;
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
    child.stdin.end();
  });
}

/* ── #20: dedupe --by validation ───────────────────────────────── */

test('library dedupe --by invalid is rejected (#20)', async () => {
  const env = createEnv();
  const result = await runCli(['library', 'dedupe', '--by', 'bogus'], { env });
  assert.notEqual(result.code, 0);
  const output = result.stdout + result.stderr;
  assert.match(output, /--by must be one of.*doi.*title.*doi-or-title/i);
  // JSON output escapes the quotes; just match the invalid value
  // and the validation message.
  assert.match(output, /bogus/);
  assert.match(output, /must be one of/i);
});

test('library dedupe --by doi is accepted (#20)', async () => {
  // This will fail because there's no server, but it should NOT fail
  // with the --by validation error — it should get past validation.
  const env = createEnv();
  const result = await runCli(['library', 'dedupe', '--by', 'doi'], { env });
  const output = result.stdout + result.stderr;
  assert.doesNotMatch(output, /--by must be one of/i);
});

/* ── #21: empty --data on create/update ────────────────────────── */

test('documents create with no body or title/type is rejected (#21)', async () => {
  const env = createEnv();
  const result = await runCli(['documents', 'create'], { env });
  assert.notEqual(result.code, 0);
  const output = result.stdout + result.stderr;
  assert.match(output, /--data is empty|please supply/i);
});

test('documents update with no body is rejected (#21)', async () => {
  const env = createEnv();
  const result = await runCli(['documents', 'update', 'some-id'], { env });
  assert.notEqual(result.code, 0);
  const output = result.stdout + result.stderr;
  assert.match(output, /please supply.*--data.*--file/i);
});

test('documents create --title works without --data (#21)', async () => {
  // Should NOT get the "empty" error — --title is a valid minimal input.
  const env = createEnv();
  const result = await runCli(['documents', 'create', '--title', 'My Paper', '--type', 'journal'], {
    env,
  });
  const output = result.stdout + result.stderr;
  // Will fail at the API level (no server) but must NOT fail with
  // the "empty data" validation error.
  assert.doesNotMatch(output, /--data is empty/i);
});
