/**
 * Tests for issue #16: groups members returns empty objects.
 * and issue #19: folders list --group silently ignored.
 *
 * #16: GroupMember.toJSON() was inherited from LazyResponseObject
 *      (async, returns a Promise) so JSON.stringify rendered {}.
 *      Now has a synchronous toJSON() exposing membership fields.
 *
 * #19: folders list --group <id> was silently dropped. Now it's a
 *      declared option that forwards group_id to the API.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GroupMember } from '../../src/models/groups.js';

const CLI = fileURLToPath(new URL('../../bin/mendeley.js', import.meta.url));

/* ── #16: GroupMember.toJSON ───────────────────────────────────── */

function makeFakeSession() {
  return {
    host: 'https://api.mendeley.com',
    async get() {
      return { json: async () => ({ id: 'p1', first_name: 'Ada' }) };
    },
  };
}

test('GroupMember.toJSON exposes membership fields synchronously (#16)', () => {
  const session = makeFakeSession();
  const member = new GroupMember(session, {
    profile_id: 'p1',
    role: 'owner',
    joined: '2020-01-01T00:00:00.000Z',
  });
  const json = member.toJSON();
  assert.equal(json.id, 'p1');
  assert.equal(json.profile_id, 'p1');
  assert.equal(json.role, 'owner');
  assert.equal(json.joined, '2020-01-01T00:00:00.000Z');
});

test('JSON.stringify renders GroupMember fields, not {} (#16)', () => {
  const session = makeFakeSession();
  const member = new GroupMember(session, {
    profile_id: 'p2',
    role: 'member',
    joined: '2021-06-15T00:00:00.000Z',
  });
  const str = JSON.stringify(member);
  const parsed = JSON.parse(str);
  assert.equal(parsed.profile_id, 'p2');
  assert.equal(parsed.role, 'member');
  // Must not be an empty object.
  assert.ok(Object.keys(parsed).length > 0, 'must have fields, not {}');
});

/* ── #19: folders list --group is accepted ─────────────────────── */

function createEnv() {
  const root = mkdtempSync(join(tmpdir(), 'mendeley-groups-'));
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

test('folders list --group is accepted (not silently dropped) (#19)', async () => {
  const env = createEnv();
  const result = await runCli(['folders', 'list', '--group', 'some-group-id'], { env });
  // --group is now a declared option, so it must NOT be rejected as
  // an unknown flag. The call will fail at the API level (no server)
  // but must not fail with "unknown flag".
  const output = result.stdout + result.stderr;
  assert.doesNotMatch(output, /unknown flag/i);
  assert.doesNotMatch(output, /Did you mean/i);
});

test('folders list --group appears in help (#19)', async () => {
  const env = createEnv();
  const result = await runCli(['folders', 'list', '--help'], { env });
  const output = result.stdout + result.stderr;
  assert.match(output, /--group/);
});
