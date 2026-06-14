/**
 * Integration-style tests for `folders add-document`,
 * `folders remove-document`, and `trash empty`.
 *
 * Issue #3 regression: `folders add-document` sent a fabricated
 * `Content-Type: application/vnd.mendeley-folder-document.1+json`,
 * which the Mendeley API rejects with 415 Unsupported Media Type.
 * The correct type is `application/vnd.mendeley-document.1+json`
 * (the resource the POST body identifies and the response returns).
 *
 * Issue #4 regression: `trash empty` iterated with `view: 'core'`,
 * which is not a valid view on the trash endpoint. The API replied
 * `400 Invalid view` and the trash was never emptied.
 *
 * These tests run the real CLI binary against a stub HTTP server.
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

test('folders add-document posts with the document content-type (not 415)', async () => {
  const captured = { post: null, contentType: null };
  const { server, host } = await startApiServer(captured);
  servers.push(server);
  const { env } = createEnv(host);

  const result = await runCli(['folders', 'add-document', 'folder-1', 'doc-1'], { env });

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.ok(captured.post, 'POST /folders/{id}/documents must be received');
  // Body must carry the document id.
  assert.deepEqual(captured.post.body, { id: 'doc-1' });
  // Content-Type must be the document vendor type, NOT the fabricated
  // folder-document type that caused the 415.
  assert.equal(
    captured.post.contentType,
    'application/vnd.mendeley-document.1+json',
    'must use the document content-type, not the fabricated folder-document type',
  );
  // Output must be the clean success envelope, not an error.
  const out = JSON.parse(result.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.folder_id, 'folder-1');
  assert.equal(out.document_id, 'doc-1');
});

test('folders remove-document deletes the membership', async () => {
  const captured = { deleteUrl: null };
  const { server, host } = await startApiServer(captured);
  servers.push(server);
  const { env } = createEnv(host);

  const result = await runCli(['folders', 'remove-document', 'folder-1', 'doc-1'], { env });

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(captured.deleteUrl, '/folders/folder-1/documents/doc-1');
  const out = JSON.parse(result.stdout);
  assert.equal(out.ok, true);
});

test('trash empty does not send an invalid view param (#4)', async () => {
  const captured = { listQuery: null, deletes: [] };
  const { server, host } = await startApiServer(captured, { trashCount: 2 });
  servers.push(server);
  const { env } = createEnv(host);

  const result = await runCli(['trash', 'empty', '--yes'], { env });

  assert.equal(result.code, 0, result.stderr || result.stdout);
  // The list request must NOT carry view=core (or any view param that
  // the API rejects with 400 Invalid view).
  assert.ok(captured.listQuery !== null, 'trash list must be requested');
  assert.doesNotMatch(captured.listQuery, /view=core/, 'must not send view=core');
  // Each trashed doc must be individually deleted.
  assert.equal(captured.deletes.length, 2);
  assert.ok(captured.deletes.includes('/trash/doc-a'));
  assert.ok(captured.deletes.includes('/trash/doc-b'));
  const out = JSON.parse(result.stdout);
  assert.deepEqual(out, { ok: true, deleted: 2 });
});

function createEnv(host) {
  const root = mkdtempSync(join(tmpdir(), 'mendeley-folders-cli-'));
  const home = join(root, 'home');
  mkdirSync(join(home, '.mendeley'), { recursive: true });
  const configFile = join(root, 'credentials.json');
  writeFileSync(
    configFile,
    JSON.stringify({
      clientId: 'CLIENT_ID',
      redirectUri: 'http://localhost:11595',
      host,
    }),
  );
  const tokenFile = join(root, 'token.json');
  writeFileSync(
    tokenFile,
    JSON.stringify({
      access_token: 'ACCESS_TOKEN_FOR_TEST',
      refresh_token: 'REFRESH',
      expires_in: 3600,
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
  delete env.MENDELEY_ACCESS_TOKEN;
  delete env.MENDELEY_REFRESH_TOKEN;
  return { env, home };
}

function startApiServer(captured, { trashCount = 0 } = {}) {
  const trashDocs = Array.from({ length: trashCount }, (_, i) => ({
    id: `doc-${String.fromCharCode(97 + i)}`,
    title: `Trashed ${i}`,
  }));

  const server = createServer((req, res) => {
    const url = req.url.split('?')[0];
    const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';

    // POST /folders/{id}/documents — add a document to a folder.
    if (req.method === 'POST' && /^\/folders\/[^/]+\/documents$/.test(url)) {
      let chunks = '';
      req.on('data', (c) => {
        chunks += c;
      });
      req.on('end', () => {
        captured.post = {
          body: JSON.parse(chunks),
          contentType: req.headers['content-type'],
        };
        // The Mendeley API returns 204 No Content on success.
        res.statusCode = 204;
        res.end();
      });
      return;
    }

    // DELETE /folders/{id}/documents/{docId} — remove a document.
    if (req.method === 'DELETE' && /^\/folders\/[^/]+\/documents\/[^/]+$/.test(url)) {
      captured.deleteUrl = url;
      res.statusCode = 204;
      res.end();
      return;
    }

    // GET /trash — list trashed documents (pagination).
    if (req.method === 'GET' && url === '/trash') {
      captured.listQuery = query;
      res.setHeader('content-type', 'application/vnd.mendeley-document.1+json');
      res.setHeader('link', '<https://api.mendeley.com/trash>; rel="self"');
      res.end(JSON.stringify(trashDocs));
      return;
    }

    // DELETE /trash/{id} — permanently delete a trashed document.
    if (req.method === 'DELETE' && /^\/trash\/[^/]+$/.test(url)) {
      captured.deletes.push(url);
      res.statusCode = 204;
      res.end();
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
