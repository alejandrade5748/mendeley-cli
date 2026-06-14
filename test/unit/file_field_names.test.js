/**
 * Tests for issues #115 / #116: File model field names.
 *
 * The Mendeley API returns `filename` and `content_type` (confirmed at
 * dev.mendeley.com/methods/ → "File attributes"), but the File model
 * previously declared `file_name` and `mime_type`. Both mismatched
 * names were undefined, so they were stripped — files showed only
 * `id`, `size`, `filehash`. The download path also read
 * `this.json.file_name`, so it always fell back to `file-<id>`.
 *
 * Now (#115/#116):
 *  - File.fields() declares the canonical names: filename,
 *    content_type, document_id, extension, created, plus the
 *    pre-existing id/size/filehash.
 *  - File.download() reads this.json.filename (not file_name).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { File } from '../../src/models/files.js';

test('File.fields() uses canonical API names (no file_name/mime_type) (#115)', () => {
  const fields = File.fields();
  assert.ok(fields.includes('filename'), `expected 'filename' in ${JSON.stringify(fields)}`);
  assert.ok(
    fields.includes('content_type'),
    `expected 'content_type' in ${JSON.stringify(fields)}`,
  );
  assert.ok(!fields.includes('file_name'), `'file_name' must be removed (API uses 'filename')`);
  assert.ok(!fields.includes('mime_type'), `'mime_type' must be removed (API uses 'content_type')`);
});

test('File.fields() exposes document_id, extension, created (#115)', () => {
  const fields = File.fields();
  assert.ok(fields.includes('document_id'));
  assert.ok(fields.includes('extension'));
  assert.ok(fields.includes('created'));
});

test('File.toJSON serializes filename and content_type when present (#115)', () => {
  // Simulate the exact shape the real Mendeley API returns.
  const f = new File(
    { get: async () => {} },
    {
      id: 'file-1',
      filename: 'attention.pdf',
      content_type: 'application/pdf',
      size: 1024,
      filehash: 'abc',
      document_id: 'doc-1',
      extension: 'pdf',
      created: '2024-01-01T00:00:00Z',
    },
  );
  const json = f.toJSON();
  assert.equal(json.filename, 'attention.pdf');
  assert.equal(json.content_type, 'application/pdf');
  assert.equal(json.document_id, 'doc-1');
  assert.equal(json.extension, 'pdf');
  assert.equal(json.created, '2024-01-01T00:00:00Z');
  assert.equal(json.size, 1024);
  assert.equal(json.filehash, 'abc');
});

test('File.toJSON no longer drops filename when the API uses the canonical name (#115)', () => {
  const f = new File(
    { get: async () => {} },
    { id: 'f', filename: 'paper.pdf', content_type: 'application/pdf', size: 1, filehash: 'h' },
  );
  const json = f.toJSON();
  // The old bug: filename would be undefined and stripped.
  assert.ok(json.filename, `filename must survive toJSON, got ${JSON.stringify(json)}`);
});

test('File.download uses the metadata filename when no Content-Disposition (#116)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mendeley-115-dl-'));
  try {
    const f = new File(
      {
        get: async () => new Response(new Blob(['bytes']), {}),
      },
      {
        id: 'file-9',
        filename: 'real-name.pdf', // canonical API field
        content_type: 'application/pdf',
        size: 5,
        filehash: 'h',
      },
    );
    const path = await f.download(dir);
    assert.ok(path.endsWith('real-name.pdf'), `expected real-name.pdf in path, got ${path}`);
    assert.ok(existsSync(join(dir, 'real-name.pdf')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('File.download still falls back to file-<id> when neither header nor metadata (#116)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mendeley-115-fb-'));
  try {
    const f = new File(
      {
        get: async () => new Response(new Blob(['x']), {}),
      },
      { id: 'abc-123' }, // no filename field at all
    );
    const path = await f.download(dir);
    assert.ok(path.endsWith('file-abc-123'), `expected file-abc-123, got ${path}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
