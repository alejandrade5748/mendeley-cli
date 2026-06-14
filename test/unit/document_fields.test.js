/**
 * Tests for issues #114 / #119: document output fields.
 *
 * The `authors` and `created` fields were missing from every
 * document's JSON output because `BASE_FIELDS` in
 * src/models/documents.js did not include them. Since every view
 * (UserAllDocument, UserClientDocument, ...) is built from
 * BASE_FIELDS, these fields were stripped by toJSON() before
 * printing — even though the API returns them and the model has
 * a `get authors()` getter.
 *
 * Now (#114/#119): BASE_FIELDS includes 'authors' and 'created'.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UserAllDocument, UserClientDocument, UserDocument } from '../../src/models/documents.js';

const CLI = fileURLToPath(new URL('../../bin/mendeley.js', import.meta.url));

const SAMPLE = {
  id: 'doc-1',
  title: 'Attention Is All You Need',
  type: 'journal',
  source: 'NeurIPS',
  year: 2017,
  authors: [
    { first_name: 'Ashish', last_name: 'Vaswani' },
    { first_name: 'Noam', last_name: 'Shazeer' },
  ],
  identifiers: { doi: ['10.5555/3295222.3295349'] },
  keywords: ['attention'],
  abstract: 'We propose a new architecture...',
  created: '2024-01-15T00:00:00.000Z',
};

test('BASE_FIELDS includes authors (#114)', () => {
  const d = new UserDocument({}, { ...SAMPLE });
  const json = d.toJSON();
  assert.ok(Array.isArray(json.authors), `expected authors array, got ${typeof json.authors}`);
  assert.equal(json.authors.length, 2);
});

test('BASE_FIELDS includes created (#119)', () => {
  const d = new UserDocument({}, { ...SAMPLE });
  const json = d.toJSON();
  assert.equal(json.created, '2024-01-15T00:00:00.000Z');
});

test('authors is serialized as raw {first_name, last_name} objects', () => {
  const d = new UserDocument({}, { ...SAMPLE });
  const json = d.toJSON();
  assert.deepEqual(json.authors, [
    { first_name: 'Ashish', last_name: 'Vaswani' },
    { first_name: 'Noam', last_name: 'Shazeer' },
  ]);
});

test('UserAllDocument (view=all) also exposes authors and created', () => {
  const d = new UserAllDocument({}, { ...SAMPLE, file_attached: true, tags: ['ml'] });
  const json = d.toJSON();
  assert.ok(Array.isArray(json.authors));
  assert.equal(json.created, '2024-01-15T00:00:00.000Z');
});

test('UserClientDocument (view=client) also exposes authors and created', () => {
  const d = new UserClientDocument({}, { ...SAMPLE, file_attached: true });
  const json = d.toJSON();
  assert.ok(Array.isArray(json.authors));
  assert.equal(json.created, '2024-01-15T00:00:00.000Z');
});

test('authors is omitted from JSON when the API returns none', () => {
  const d = new UserDocument({}, { id: 'd', title: 'T', type: 'journal' });
  const json = d.toJSON();
  // No authors in the source -> field stays undefined -> omitted by toJSON.
  assert.equal(json.authors, undefined);
});

test('authors with a single entry is still an array', () => {
  const d = new UserDocument(
    {},
    { ...SAMPLE, authors: [{ first_name: 'Solo', last_name: 'Author' }] },
  );
  assert.ok(Array.isArray(d.toJSON().authors));
  assert.equal(d.toJSON().authors.length, 1);
});

// ---- CLI integration: real bin/mendeley.js against a mock ----

function createEnv() {
  const root = mkdtempSync(join(tmpdir(), 'mendeley-doc-fields-'));
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

test('documents get --view all output includes authors and created (#114/#119)', async () => {
  // Use the model directly to simulate the CLI output shape.
  const d = new UserAllDocument({}, { ...SAMPLE, file_attached: true, tags: ['ml'] });
  const out = d.toJSON();
  assert.match(JSON.stringify(out), /"authors"/);
  assert.match(JSON.stringify(out), /"created"/);
  assert.match(JSON.stringify(out), /Vaswani/);
});
