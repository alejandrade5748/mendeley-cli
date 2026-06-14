/**
 * Unit tests for src/models/files.js (File.download).
 *
 * Path-traversal regression tests: a malicious or compromised API
 * response must not be able to write outside the destination
 * directory via Content-Disposition.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { File } from '../../src/models/files.js';

function makeFile({ id = 'file-1', fileName = 'paper.pdf' } = {}) {
  return new File(
    { get: async () => {} },
    { id, filename: fileName, filehash: 'hash', content_type: 'application/pdf', size: 100 },
  );
}

function responseFromString(body, headers) {
  return new Response(new Blob([body]), { headers });
}

test('File.download writes a file using the Content-Disposition filename', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mendeley-fd-ok-'));
  try {
    const f = makeFile({ id: 'file-1' });
    f.session.get = async () =>
      responseFromString('hello', {
        'content-disposition': 'attachment; filename="actual.pdf"',
      });
    const path = await f.download(dir);
    assert.ok(path.endsWith('actual.pdf'));
    assert.equal(readFileSync(path, 'utf8'), 'hello');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('File.download rejects a Content-Disposition with path traversal', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mendeley-fd-trav-'));
  const outside = join(dir, '..', 'escape.txt');
  try {
    const f = makeFile({ id: 'file-1' });
    f.session.get = async () =>
      responseFromString('malicious', {
        'content-disposition': 'attachment; filename="../../escape.txt"',
      });
    await assert.rejects(() => f.download(dir), /path separator/);
    assert.equal(existsSync(outside), false, 'no file should be written outside the directory');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('File.download rejects a Content-Disposition with an absolute path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mendeley-fd-abs-'));
  try {
    const f = makeFile({ id: 'file-1' });
    f.session.get = async () =>
      responseFromString('malicious', {
        'content-disposition': 'attachment; filename="/tmp/absolute.txt"',
      });
    await assert.rejects(() => f.download(dir), /absolute path/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('File.download falls back to metadata filename when no Content-Disposition', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mendeley-fd-fb-'));
  try {
    const f = makeFile({ id: 'file-1', fileName: 'meta-name.pdf' });
    f.session.get = async () => responseFromString('hello', {});
    const path = await f.download(dir);
    assert.ok(path.endsWith('meta-name.pdf'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('File.download falls back to file-<id> when nothing else is available', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mendeley-fd-id-'));
  try {
    const f = new File({ get: async () => responseFromString('x', {}) }, { id: 'abc-123' });
    const path = await f.download(dir);
    assert.ok(path.endsWith('file-abc-123'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
