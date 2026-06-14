/**
 * Tests for issue #102: `library add-by-catalog-id` command.
 *
 * The new command lets a user take an `id` from
 * `mendeley catalog search` and add that document to the user
 * library in a single call, without going through a DOI/arXiv
 * lookup.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../../bin/mendeley.js', import.meta.url));

function createEnv({ host } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'mendeley-addcat-'));
  const home = join(root, 'home');
  mkdirSync(join(home, '.mendeley'), { recursive: true });
  const configFile = join(root, 'credentials.json');
  writeFileSync(
    configFile,
    JSON.stringify({
      clientId: 'CLIENT_ID',
      redirectUri: 'http://localhost:11595',
      host: host || 'http://127.0.0.1:1',
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

function runCli(args, { env, timeoutMs = 10000 } = {}) {
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

test('library add-by-catalog-id appears in help (#102)', async () => {
  const env = createEnv();
  const result = await runCli(['library', '--help'], { env });
  const output = result.stdout + result.stderr;
  assert.match(output, /add-by-catalog-id/, 'add-by-catalog-id must appear in `library --help`');
  assert.match(output, /add-by-doi/);
  assert.match(output, /add-by-arxiv/);
});

test('library add-by-catalog-id <id> appears in its own help (#102)', async () => {
  const env = createEnv();
  const result = await runCli(['library', 'add-by-catalog-id', '--help'], { env });
  const output = result.stdout + result.stderr;
  assert.match(output, /catalog/i);
  assert.match(output, /--folder/, '--folder option must be documented');
});

test('library add-by-catalog-id calls the catalog and documents APIs (#102)', async () => {
  // Start a mock server that:
  //  1. GET /catalog/cat-1?view=all  → returns a catalog record
  //  2. POST /documents               → returns a created user document
  //  3. POST /folderDocuments/folder-x/documents  → returns 204
  const http = await import('node:http');
  const calls = [];
  const server = http.createServer((req, res) => {
    const ct = (t) => ({ 'content-type': t });
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, body });
      if (req.method === 'GET' && req.url.startsWith('/catalog/cat-1')) {
        res.writeHead(200, ct('application/json'));
        res.end(
          JSON.stringify({
            id: 'cat-1',
            title: 'Paper From Catalog',
            year: 2024,
            type: 'journal',
            identifiers: { doi: ['10.5555/X'] },
          }),
        );
        return;
      }
      if (req.method === 'POST' && req.url === '/documents') {
        res.writeHead(201, ct('application/json'));
        res.end(
          JSON.stringify({
            id: 'user-doc-NEW',
            title: 'Paper From Catalog',
            created: '2026-06-14T00:00:00Z',
          }),
        );
        return;
      }
      res.writeHead(404, ct('application/json'));
      res.end(JSON.stringify({ message: 'no mock for ' + req.method + ' ' + req.url }));
    });
  });
  await new Promise((r) => server.listen(19801, '127.0.0.1', r));

  try {
    const env = createEnv({ host: 'http://127.0.0.1:19801' });
    const result = await runCli(['library', 'add-by-catalog-id', 'cat-1'], { env });
    assert.equal(
      result.code,
      0,
      `expected exit 0, got ${result.code}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    // The CLI should have called GET /catalog/cat-1 and POST /documents.
    const get = calls.find((c) => c.method === 'GET' && c.url.includes('/catalog/cat-1'));
    const post = calls.find((c) => c.method === 'POST' && c.url === '/documents');
    assert.ok(get, 'expected a GET to /catalog/cat-1');
    assert.ok(post, 'expected a POST to /documents');
    // The POST body must include the catalog metadata but NOT the
    // catalog `id` field (we strip it before creating).
    const posted = JSON.parse(post.body);
    assert.equal(posted.title, 'Paper From Catalog');
    assert.equal(posted.id, undefined, 'catalog id must be stripped from the create payload');
    // The stdout should include the new user document id.
    assert.match(result.stdout, /user-doc-NEW/);
  } finally {
    server.close();
  }
});

test('library add-by-catalog-id 404 on the catalog surfaces a clear error (#102)', async () => {
  // The mock returns 404 for any catalog GET; documents POST is not
  // hit because the catalog lookup fails first.
  const http = await import('node:http');
  const server = http.createServer((req, res) => {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'nope' }));
  });
  await new Promise((r) => server.listen(19802, '127.0.0.1', r));
  try {
    const env = createEnv({ host: 'http://127.0.0.1:19802' });
    const result = await runCli(['library', 'add-by-catalog-id', 'cat-missing'], { env });
    assert.equal(result.code, 1, `expected exit 1, got ${result.code}`);
    assert.match(result.stdout, /status: 404/);
  } finally {
    server.close();
  }
});
