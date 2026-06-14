/**
 * Tests for issue #117: Annotation creation posts to /annotations/ with
 * a trailing slash; the official Mendeley endpoint is /annotations
 * (no trailing slash). Both File.addStickyNote and File.addHighlight
 * must POST to the slash-less URL or the real API returns 404/405.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { File } from '../../src/models/files.js';

// Build a File whose session captures the request URL of every call.
function makeFile() {
  const calls = [];
  const fakeDoc = {
    id: 'doc-1',
    title: 'T',
    toJSON() {
      return this;
    },
  };
  const session = {
    async post(url, opts) {
      calls.push({ method: 'POST', url });
      // Return a minimal annotation-shaped response.
      return {
        json: async () => ({
          id: 'ann-NEW',
          text: opts?.data ? JSON.parse(opts.data).text : null,
          positions: opts?.data ? JSON.parse(opts.data).positions : [],
        }),
      };
    },
    async get(url) {
      calls.push({ method: 'GET', url });
      return { json: async () => ({ id: 'doc-1', title: 'T' }) };
    },
    documents: {
      getLazy: () => fakeDoc,
    },
  };
  const file = new File(session, {
    id: 'file-1',
    filehash: 'hash',
    document_id: 'doc-1',
  });
  return { file, calls };
}

test('File.addHighlight POSTs to /annotations (no trailing slash) (#117)', async () => {
  const { file, calls } = makeFile();
  await file.addHighlight([{ top_left: { x: 0, y: 0 }, bottom_right: { x: 10, y: 10 }, page: 1 }], {
    r: 255,
    g: 255,
    b: 0,
  });
  const post = calls.find((c) => c.method === 'POST');
  assert.ok(post, 'expected a POST');
  assert.equal(post.url, '/annotations', `expected /annotations, got ${post.url}`);
});

test('File.addStickyNote POSTs to /annotations (no trailing slash) (#117)', async () => {
  const { file, calls } = makeFile();
  await file.addStickyNote('hello', 10, 20, 1);
  const post = calls.find((c) => c.method === 'POST');
  assert.ok(post, 'expected a POST');
  assert.equal(post.url, '/annotations', `expected /annotations, got ${post.url}`);
});

test('addHighlight does not POST to /annotations/ (trailing slash regression)', async () => {
  const { file, calls } = makeFile();
  await file.addHighlight(
    [{ top_left: { x: 0, y: 0 }, bottom_right: { x: 10, y: 10 }, page: 1 }],
    {},
  );
  const post = calls.find((c) => c.method === 'POST');
  assert.notEqual(post.url, '/annotations/');
  assert.ok(!/\/$/.test(post.url), `url should not end with /: ${post.url}`);
});
