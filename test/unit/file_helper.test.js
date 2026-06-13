/**
 * Unit tests for lib/cli/file_helper.js (streamToFile).
 *
 * Path-traversal regression tests: a malicious or compromised API
 * response must not be able to write outside the destination
 * directory via Content-Disposition, and an explicit --filename
 * flag must be honoured.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { streamToFile } from '../../lib/cli/file_helper.js';

function responseFromString(body, headers) {
  return new Response(new Blob([body]), { headers });
}

test('streamToFile uses the Content-Disposition filename when no explicit one is given', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mendeley-cli-cd-'));
  try {
    const rsp = responseFromString('hello', {
      'content-disposition': 'attachment; filename="via-header.pdf"',
    });
    const path = await streamToFile(rsp, dir);
    assert.ok(path.endsWith('via-header.pdf'));
    assert.equal(readFileSync(path, 'utf8'), 'hello');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('streamToFile honours an explicit filename (3rd arg)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mendeley-cli-explicit-'));
  try {
    const rsp = responseFromString('hello', {
      'content-disposition': 'attachment; filename="via-header.pdf"',
    });
    const path = await streamToFile(rsp, dir, 'paper.pdf');
    assert.ok(path.endsWith('paper.pdf'));
    assert.equal(readFileSync(path, 'utf8'), 'hello');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('streamToFile rejects a Content-Disposition with path traversal', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mendeley-cli-trav-'));
  const outside = join(dir, '..', 'escape.txt');
  try {
    const rsp = responseFromString('malicious', {
      'content-disposition': 'attachment; filename="../../escape.txt"',
    });
    await assert.rejects(() => streamToFile(rsp, dir), /path separator/);
    assert.equal(existsSync(outside), false, 'no file should be written outside the directory');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('streamToFile rejects a Content-Disposition with an absolute path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mendeley-cli-abs-'));
  try {
    const rsp = responseFromString('malicious', {
      'content-disposition': 'attachment; filename="/etc/passwd"',
    });
    await assert.rejects(() => streamToFile(rsp, dir), /absolute path/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('streamToFile rejects an explicit filename with path traversal', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mendeley-cli-explicit-bad-'));
  try {
    const rsp = responseFromString('x', {});
    await assert.rejects(() => streamToFile(rsp, dir, '../escape.txt'), /path separator/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('streamToFile falls back to "mendeley-file" when no Content-Disposition and no explicit name', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mendeley-cli-fallback-'));
  try {
    const rsp = responseFromString('hello', {});
    const path = await streamToFile(rsp, dir);
    assert.ok(path.endsWith('mendeley-file'));
    assert.equal(readFileSync(path, 'utf8'), 'hello');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('streamToFile rejects a missing response body', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mendeley-cli-nobody-'));
  try {
    const rsp = new Response(null, { headers: { 'content-disposition': 'filename="x"' } });
    await assert.rejects(() => streamToFile(rsp, dir), /no body/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
