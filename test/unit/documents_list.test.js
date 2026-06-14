/**
 * Regression tests for:
 * - #6: `documents list --all` throws "resource.all is not a function"
 * - #9: `--modified-since` / `--deleted-since` silently ignored
 *   (kebab-case flags not accessible via camelCase in action code)
 *
 * Runs the real CLI binary against a stub HTTP server.
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

test('documents list --all traverses all pages (#6)', async () => {
  const captured = { docRequests: [] };
  const { server, host } = await startApiServer(captured, {
    pages: [[makeDoc('d1'), makeDoc('d2')], [makeDoc('d3')]],
  });
  servers.push(server);
  const { env } = createEnv(host);

  const result = await runCli(['documents', 'list', '--all'], { env });

  assert.equal(result.code, 0, result.stderr || result.stdout);
  // The output must be the standard { count, items } envelope (#17).
  const out = JSON.parse(result.stdout);
  assert.ok(out && typeof out === 'object' && !Array.isArray(out), 'must be an envelope object');
  assert.ok(Array.isArray(out.items), 'items must be an array');
  assert.equal(out.items.length, 3, 'must contain all items across pages');
  assert.equal(out.items[0].id, 'd1');
  assert.equal(out.items[2].id, 'd3');
});

test('documents list passes --modified-since as a query param (#9)', async () => {
  const captured = { docRequests: [] };
  const { server, host } = await startApiServer(captured);
  servers.push(server);
  const { env } = createEnv(host);

  const result = await runCli(['documents', 'list', '--modified-since', '2024-01-01T00:00:00Z'], {
    env,
  });

  assert.equal(result.code, 0, result.stderr || result.stdout);
  // The server must receive the modified_since query parameter.
  assert.ok(
    captured.docRequests.some((q) => q.includes('modified_since=2024-01-01')),
    `modified_since must be in the URL, got: ${JSON.stringify(captured.docRequests)}`,
  );
});

test('documents list passes --deleted-since as a query param (#9)', async () => {
  const captured = { docRequests: [] };
  const { server, host } = await startApiServer(captured);
  servers.push(server);
  const { env } = createEnv(host);

  const result = await runCli(['documents', 'list', '--deleted-since', '2024-06-01T00:00:00Z'], {
    env,
  });

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.ok(
    captured.docRequests.some((q) => q.includes('deleted_since=2024-06-01')),
    `deleted_since must be in the URL`,
  );
});

/* ── helpers ────────────────────────────────────────────────────── */

function makeDoc(id) {
  return { id, title: `Doc ${id}`, type: 'journal' };
}

function createEnv(host) {
  const root = mkdtempSync(join(tmpdir(), 'mendeley-docs-cli-'));
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

function startApiServer(captured, { pages } = {}) {
  const pageData = pages || [[makeDoc('d1')]];

  const server = createServer((req, res) => {
    const url = req.url.split('?')[0];
    const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';

    // GET /documents — paginated list.
    if (req.method === 'GET' && url === '/documents') {
      captured.docRequests.push(query);

      // Determine which page to return based on the page token.
      const sp = new URLSearchParams(query);
      const marker = sp.get('marker') || '';

      let pageIndex = 0;
      if (marker) {
        pageIndex = parseInt(marker, 10);
      }

      const items = pageData[pageIndex] || [];
      const nextPage = pageIndex + 1;

      res.setHeader('content-type', 'application/vnd.mendeley-document.1+json');
      if (pageIndex < pageData.length - 1) {
        // Return a Link header pointing to the next page.
        const link = `<${host(req)}/documents?marker=${nextPage}>; rel="next"`;
        res.setHeader('link', link);
      }
      res.end(JSON.stringify(items));
      return;
    }

    res.statusCode = 404;
    res.end('not found');
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        host: `http://127.0.0.1:${server.address().port}`,
      });
    });
    server.on('error', reject);
  });
}

function host(req) {
  return `http://${req.headers.host}`;
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
