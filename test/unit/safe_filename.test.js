/**
 * Unit tests for the shared safe-filename helper used by file
 * download / stream-to-file paths.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseContentDispositionFilename,
  safeFilename,
  safeJoin,
} from '../../src/safe_filename.js';

test('safeFilename accepts a plain basename', () => {
  assert.equal(safeFilename('paper.pdf'), 'paper.pdf');
  assert.equal(safeFilename('2024-06-13_report.txt'), '2024-06-13_report.txt');
});

test('safeFilename rejects empty / non-string inputs', () => {
  assert.throws(() => safeFilename(''), /non-empty string/);
  assert.throws(() => safeFilename(null), /non-empty string/);
  assert.throws(() => safeFilename(undefined), /non-empty string/);
  assert.throws(() => safeFilename(123), /non-empty string/);
});

test('safeFilename rejects path separators', () => {
  assert.throws(() => safeFilename('../etc/passwd'), /path separator/);
  assert.throws(() => safeFilename('foo/bar.txt'), /path separator/);
  assert.throws(() => safeFilename('foo\\bar.txt'), /path separator/);
});

test('safeFilename rejects absolute paths', () => {
  assert.throws(() => safeFilename('/etc/passwd'), /absolute path/);
  assert.throws(() => safeFilename('C:\\Windows\\System32'), /absolute path/);
});

test('safeFilename rejects reserved names', () => {
  assert.throws(() => safeFilename('.'), /reserved/);
  assert.throws(() => safeFilename('..'), /reserved/);
});

test('safeFilename rejects NUL bytes', () => {
  assert.throws(() => safeFilename('foo\0bar'), /NUL byte/);
});

test('parseContentDispositionFilename parses plain form', () => {
  assert.equal(parseContentDispositionFilename('attachment; filename="paper.pdf"'), 'paper.pdf');
  assert.equal(parseContentDispositionFilename('attachment; filename=paper.pdf'), 'paper.pdf');
  assert.equal(parseContentDispositionFilename('filename="report.txt"'), 'report.txt');
});

test('parseContentDispositionFilename prefers RFC 5987 form', () => {
  // RFC 5987 should win when both are present.
  const header = 'attachment; filename="fallback.txt"; filename*=UTF-8\'\'proper%20name.pdf';
  assert.equal(parseContentDispositionFilename(header), 'proper name.pdf');
});

test('parseContentDispositionFilename returns null when missing or invalid', () => {
  assert.equal(parseContentDispositionFilename(null), null);
  assert.equal(parseContentDispositionFilename(''), null);
  assert.equal(parseContentDispositionFilename('attachment'), null);
  assert.equal(parseContentDispositionFilename('attachment; size=12345'), null);
});

test('safeJoin returns the resolved path when inside directory', () => {
  const dir = join(tmpdir(), 'mendeley-test-safe-join');
  const p = safeJoin(dir, 'paper.pdf');
  assert.ok(p.startsWith(dir));
  assert.ok(p.endsWith('paper.pdf'));
});

test('safeJoin throws when the filename would escape the directory', () => {
  // safeFilename already rejects '..', so the only way to escape is via
  // a path that the safe filename check missed — verify the defence
  // in depth path manually.
  const dir = join(tmpdir(), 'mendeley-test-escape');
  assert.throws(() => safeJoin(dir, '../escape.txt'), /path separator/);
});
