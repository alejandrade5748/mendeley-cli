/**
 * Unit tests for the auth CLI command surface.
 */

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const CLI = fileURLToPath(new URL('../../bin/mendeley.js', import.meta.url));
const ACCESS_TOKEN = 'ACCESS_SECRET_SHOULD_NOT_PRINT';
const REFRESH_TOKEN = 'REFRESH_SECRET_SHOULD_NOT_PRINT';

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
});

test('auth exchange saves tokens without printing bearer material', async () => {
  const { server, host } = await startAuthServer();
  servers.push(server);
  const { env, home, tokenFile } = createAuthEnv(host);
  const pendingDir = join(home, '.mendeley');
  mkdirSync(pendingDir, { recursive: true });
  writeFileSync(
    join(pendingDir, 'pending_auth.json'),
    JSON.stringify({
      code_verifier: 'A'.repeat(64),
      state: 'EXPECTED_STATE',
      redirect_uri: 'http://localhost:11595',
      created_at: new Date().toISOString(),
    }),
  );

  const result = await runCli(['auth', 'exchange', 'AUTH_CODE'], { env });

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, new RegExp(ACCESS_TOKEN));
  assert.doesNotMatch(result.stdout, new RegExp(REFRESH_TOKEN));

  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.expires_in, 3600);
  assert.equal(output.token_file, tokenFile);
  assert.equal(output.access_token, undefined);
  assert.equal(output.refresh_token, undefined);

  const saved = JSON.parse(readFileSync(tokenFile, 'utf8'));
  assert.equal(saved.access_token, ACCESS_TOKEN);
  assert.equal(saved.refresh_token, REFRESH_TOKEN);
});

test('auth login saves tokens without printing bearer material', async () => {
  const { server, host } = await startAuthServer();
  servers.push(server);
  const { env, tokenFile } = createAuthEnv(host);

  const result = await runCli(['auth', 'login'], {
    env,
    input: 'http://localhost:11595/?code=AUTH_CODE&state=EXPECTED_STATE\n',
  });

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, new RegExp(ACCESS_TOKEN));
  assert.doesNotMatch(result.stdout, new RegExp(REFRESH_TOKEN));

  const output = parseTrailingJson(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.expires_in, 3600);
  assert.equal(output.token_file, tokenFile);
  assert.equal(output.access_token, undefined);
  assert.equal(output.refresh_token, undefined);
  assert.equal(output.profile.id, 'profile-1');

  const saved = JSON.parse(readFileSync(tokenFile, 'utf8'));
  assert.equal(saved.access_token, ACCESS_TOKEN);
  assert.equal(saved.refresh_token, REFRESH_TOKEN);
});

function createAuthEnv(host) {
  const root = mkdtempSync(join(tmpdir(), 'mendeley-auth-cli-'));
  const home = join(root, 'home');
  mkdirSync(join(home, '.mendeley'), { recursive: true });

  const configFile = join(root, 'credentials.json');
  const tokenFile = join(root, 'token.json');
  writeFileSync(
    configFile,
    JSON.stringify({
      clientId: 'CLIENT_ID',
      redirectUri: 'http://localhost:11595',
      host,
    }),
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
  delete env.MENDELEY_REDIRECT_URI;
  delete env.MENDELEY_ACCESS_TOKEN;
  delete env.MENDELEY_REFRESH_TOKEN;

  return { env, home, tokenFile };
}

async function startAuthServer() {
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/oauth/token') {
      req.resume();
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          access_token: ACCESS_TOKEN,
          refresh_token: REFRESH_TOKEN,
          expires_in: 3600,
        }),
      );
      return;
    }

    if (req.method === 'GET' && req.url === '/profiles/me') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: 'profile-1', display_name: 'Test User' }));
      return;
    }

    res.statusCode = 404;
    res.end('not found');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    server,
    host: `http://127.0.0.1:${server.address().port}`,
  };
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
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
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
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

function parseTrailingJson(stdout) {
  const start = stdout.lastIndexOf('\n{');
  assert.notEqual(start, -1, `stdout did not contain trailing JSON:\n${stdout}`);
  return JSON.parse(stdout.slice(start + 1));
}
