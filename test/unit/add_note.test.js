/**
 * Tests for issue #12: documents add-note returns the parent document's id.
 *
 * The Mendeley API may return the document id as the annotation's
 * top-level `id` for type=note annotations. addNote() detects this
 * and follows up with a list query to return the real annotation.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { UserDocument } from '../../src/models/documents.js';

function makeFakeSession({ postBody, listBody }) {
  const calls = [];
  const session = {
    host: 'https://api.mendeley.com',
    calls,
    async post(url, opts = {}) {
      calls.push({ method: 'POST', url, opts });
      return {
        ok: true,
        status: 201,
        headers: { get: () => 'application/json' },
        json: async () => postBody,
      };
    },
    async get(url, opts = {}) {
      calls.push({ method: 'GET', url, opts });
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => listBody,
      };
    },
  };
  return session;
}

describe('UserDocument.addNote returns the real annotation id (#12)', () => {
  test('follows up with list query when POST returns document id', async () => {
    const docId = 'doc-abc-123';
    const realAnnotationId = 'ann-xyz-789';
    const session = makeFakeSession({
      // API quirk: POST response has document id as the annotation id.
      postBody: { id: docId, text: 'My note', type: 'note', privacy_level: 'private' },
      listBody: [
        { id: 'ann-old-1', text: 'older note', type: 'note' },
        { id: realAnnotationId, text: 'My note', type: 'note' },
      ],
    });
    const doc = new UserDocument(session, { id: docId });
    const note = await doc.addNote('My note');

    // Must return the real annotation id, not the document id.
    assert.equal(note.id, realAnnotationId);
    assert.notEqual(note.id, docId);
    assert.equal(note.text, 'My note');

    // Must have made a POST + a follow-up GET.
    const posts = session.calls.filter((c) => c.method === 'POST');
    const gets = session.calls.filter((c) => c.method === 'GET');
    assert.equal(posts.length, 1);
    assert.equal(gets.length, 1);
    assert.match(gets[0].url, /document_id=doc-abc-123/);
  });

  test('returns POST body directly when id differs from document id', async () => {
    const docId = 'doc-abc-123';
    const annId = 'ann-direct-456';
    const session = makeFakeSession({
      postBody: { id: annId, text: 'Hello', type: 'note' },
      listBody: [],
    });
    const doc = new UserDocument(session, { id: docId });
    const note = await doc.addNote('Hello');

    // No follow-up GET needed.
    assert.equal(note.id, annId);
    const gets = session.calls.filter((c) => c.method === 'GET');
    assert.equal(gets.length, 0);
  });

  test('falls back to last annotation in list when text does not match', async () => {
    const docId = 'doc-abc-123';
    const session = makeFakeSession({
      postBody: { id: docId, text: 'unique note', type: 'note' },
      listBody: [
        { id: 'ann-a', text: 'other', type: 'note' },
        { id: 'ann-b', text: 'another', type: 'note' },
      ],
    });
    const doc = new UserDocument(session, { id: docId });
    const note = await doc.addNote('unique note');

    // Falls back to last in list.
    assert.equal(note.id, 'ann-b');
  });
});
