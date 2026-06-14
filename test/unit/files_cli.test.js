/**
 * Integration-style tests for the `files add-sticky-note`,
 * `files add-highlight`, and `files get` CLI commands.
 *
 * Issue #1 / #2 regression: the commands used to fetch `GET /files/{id}`,
 * which on the Mendeley API returns a 302 redirect to the binary download
 * URL (a PDF stream). The CLI then tried to parse the PDF as JSON and
 * failed with "Unexpected token '%'". The fix routes the lookup through
 * the files list endpoint and passes the resulting File model to
 * addStickyNote / addHighlight, which POST to /annotations.
 *
 * These tests run the real CLI binary against a stub HTTP server that
 * emulates the relevant Mendeley API endpoints.
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
const ACCESS_TOKEN = 'ACCESS_TOKEN_FOR_TEST';

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
});

test('files add-sticky-note posts to /annotations (not the blob endpoint)', async () => {
  const captured = { annotationsPost: null };
  const { server, host } = await startApiServer(captured);
  servers.push(server);
  const { env } = createEnv(host);

  const result = await runCli(
    [
      'files',
      'add-sticky-note',
      'file-1',
      '--text',
      'note',
      '--xpos',
      '10',
      '--ypos',
      '20',
      '--page',
      '1',
    ],
    { env },
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.ok(captured.annotationsPost, 'POST /annotations must be received');
  // The annotation body must carry the file's document_id and filehash
  // resolved from the metadata, and the type/positions/text from the flags.
  const body = captured.annotationsPost;
  assert.equal(body.document_id, 'doc-1');
  assert.equal(body.filehash, 'HASH-abc');
  assert.equal(body.text, 'note');
  assert.deepEqual(body.positions, [
    { top_left: { x: 10, y: 20 }, bottom_right: { x: 10, y: 20 }, page: 1 },
  ]);

  // Output must be the annotation JSON, not a PDF parse error.
  const out = JSON.parse(result.stdout);
  assert.equal(out.id, 'ann-1');
});

test('files add-highlight posts to /annotations (not the blob endpoint)', async () => {
  const captured = { annotationsPost: null };
  const { server, host } = await startApiServer(captured);
  servers.push(server);
  const { env } = createEnv(host);

  const result = await runCli(
    [
      'files',
      'add-highlight',
      'file-1',
      '--positions',
      '[{"top_left":{"x":50,"y":100},"bottom_right":{"x":500,"y":120},"page":1}]',
      '--color',
      '{"r":255,"g":255,"b":0}',
    ],
    { env },
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.ok(captured.annotationsPost, 'POST /annotations must be received');
  const body = captured.annotationsPost;
  assert.equal(body.document_id, 'doc-1');
  assert.equal(body.filehash, 'HASH-abc');
  assert.deepEqual(body.positions, [
    { top_left: { x: 50, y: 100 }, bottom_right: { x: 500, y: 120 }, page: 1 },
  ]);
  assert.deepEqual(body.color, { r: 255, g: 255, b: 0 });

  const out = JSON.parse(result.stdout);
  assert.equal(out.id, 'ann-1');
});

test('files add-sticky-note --positions sends text in the POST body (#127)', async () => {
  const captured = { annotationsPost: null };
  const { server, host } = await startApiServer(captured);
  servers.push(server);
  const { env } = createEnv(host);

  const result = await runCli(
    [
      'files',
      'add-sticky-note',
      'file-1',
      '--text',
      'remember this',
      '--positions',
      '[{"top_left":{"x":5,"y":5},"bottom_right":{"x":5,"y":5},"page":1}]',
    ],
    { env },
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.ok(captured.annotationsPost, 'POST /annotations must be received');
  // #127 regression: the --positions path previously called addHighlight
  // (which sends no text) and faked the text client-side. The server must
  // actually receive the text.
  assert.equal(
    captured.annotationsPost.text,
    'remember this',
    'POST body must include the sticky-note text on the --positions path',
  );
  assert.deepEqual(captured.annotationsPost.positions, [
    { top_left: { x: 5, y: 5 }, bottom_right: { x: 5, y: 5 }, page: 1 },
  ]);
});

test('files add-sticky-note --color sends text in the POST body (#127)', async () => {
  const captured = { annotationsPost: null };
  const { server, host } = await startApiServer(captured);
  servers.push(server);
  const { env } = createEnv(host);

  const result = await runCli(
    [
      'files',
      'add-sticky-note',
      'file-1',
      '--text',
      'colored note',
      '--xpos',
      '10',
      '--ypos',
      '20',
      '--page',
      '1',
      '--color',
      '{"r":255,"g":0,"b":0}',
    ],
    { env },
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.ok(captured.annotationsPost, 'POST /annotations must be received');
  assert.equal(
    captured.annotationsPost.text,
    'colored note',
    'POST body must include the sticky-note text on the --color path',
  );
  assert.deepEqual(captured.annotationsPost.color, { r: 255, g: 0, b: 0 });
});

test('files add-sticky-note --positions --color sends text + color (#127)', async () => {
  const captured = { annotationsPost: null };
  const { server, host } = await startApiServer(captured);
  servers.push(server);
  const { env } = createEnv(host);

  const result = await runCli(
    [
      'files',
      'add-sticky-note',
      'file-1',
      '--text',
      'full',
      '--positions',
      '[{"top_left":{"x":1,"y":2},"bottom_right":{"x":3,"y":4},"page":7}]',
      '--color',
      '{"r":0,"g":255,"b":0}',
    ],
    { env },
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);
  const body = captured.annotationsPost;
  assert.equal(body.text, 'full');
  assert.deepEqual(body.color, { r: 0, g: 255, b: 0 });
  assert.equal(body.positions[0].page, 7);
});

test('files add-sticky-note fails cleanly when the file id is not in the library', async () => {
  const captured = { annotationsPost: null };
  const { server, host } = await startApiServer(captured);
  servers.push(server);
  const { env } = createEnv(host);

  const result = await runCli(
    [
      'files',
      'add-sticky-note',
      'missing-file',
      '--text',
      'x',
      '--xpos',
      '1',
      '--ypos',
      '2',
      '--page',
      '1',
    ],
    { env },
  );

  assert.notEqual(result.code, 0, 'CLI must fail when the file is not found');
  assert.match(result.stdout + result.stderr, /File not found/);
  assert.equal(captured.annotationsPost, null, 'no annotation must be created');
});

test('files get returns the metadata JSON (not the blob)', async () => {
  const { server, host } = await startApiServer({});
  servers.push(server);
  const { env } = createEnv(host);

  const result = await runCli(['files', 'get', 'file-1'], { env });

  assert.equal(result.code, 0, result.stderr || result.stdout);
  const out = JSON.parse(result.stdout);
  assert.equal(out.id, 'file-1');
  assert.equal(out.filename, 'paper.pdf');
  assert.equal(out.content_type, 'application/pdf');
  assert.equal(out.document_id, 'doc-1');
});

function createEnv(host) {
  const root = mkdtempSync(join(tmpdir(), 'mendeley-files-cli-'));
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
      access_token: ACCESS_TOKEN,
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

function startApiServer(captured) {
  const server = createServer((req, res) => {
    // GET /files returns the file metadata list (JSON).
    if (req.method === 'GET' && req.url.startsWith('/files')) {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify([
          {
            id: 'file-1',
            filename: 'paper.pdf',
            content_type: 'application/pdf',
            size: 12345,
            filehash: 'HASH-abc',
            document_id: 'doc-1',
          },
        ]),
      );
      return;
    }

    // GET /documents/{id} returns the parent document metadata.
    // The File model's document() accessor may resolve this lazily
    // when addStickyNote / addHighlight read (await this.document()).id.
    if (req.method === 'GET' && req.url.startsWith('/documents/')) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: 'doc-1', title: 'Paper' }));
      return;
    }

    // POST /annotations creates an annotation. Capture the body.
    if (req.method === 'POST' && req.url === '/annotations') {
      let chunks = '';
      req.on('data', (c) => {
        chunks += c;
      });
      req.on('end', () => {
        try {
          captured.annotationsPost = JSON.parse(chunks);
        } catch {
          captured.annotationsPost = { raw: chunks };
        }
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            id: 'ann-1',
            document_id: 'doc-1',
            filehash: 'HASH-abc',
            text: captured.annotationsPost.text || null,
            positions: captured.annotationsPost.positions || [],
            color: captured.annotationsPost.color || null,
          }),
        );
      });
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
