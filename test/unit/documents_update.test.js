/**
 * Tests for issue #73: documents update response may omit the patched field.
 *
 * The PATCH response from the Mendeley API may not include all fields.
 * After a successful PATCH, update() re-fetches the document with
 * view=all so the returned record is complete and the caller can
 * confirm the change.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { UserDocument } from '../../src/models/documents.js';

function makeFakeSession() {
  const calls = [];
  const session = {
    host: 'https://api.mendeley.com',
    calls,
    async patch(url, opts = {}) {
      calls.push({ method: 'PATCH', url, opts });
      // Simulate the real-world bug: the PATCH response omits `notes`.
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ id: 'doc-1', title: 'Updated Title' }),
      };
    },
    async get(url, opts = {}) {
      calls.push({ method: 'GET', url, opts });
      // The re-fetched record with view=all includes `notes`.
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({
          id: 'doc-1',
          title: 'Updated Title',
          notes: 'My new notes',
        }),
      };
    },
  };
  return session;
}

describe('UserDocument.update re-fetches complete record (#73)', () => {
  test('returns the full record after PATCH, including the patched field', async () => {
    const session = makeFakeSession();
    const doc = new UserDocument(session, { id: 'doc-1' });
    const updated = await doc.update({ title: 'Updated Title' });

    // The returned record must include `notes`, which the PATCH
    // response omitted but the re-fetch includes.  Access via the
    // raw json since `notes` is not an installed field accessor.
    assert.equal(updated.title, 'Updated Title');
    assert.equal(updated.json.notes, 'My new notes');

    // Exactly one PATCH and one GET should have been made.
    const patches = session.calls.filter((c) => c.method === 'PATCH');
    const gets = session.calls.filter((c) => c.method === 'GET');
    assert.equal(patches.length, 1, 'exactly one PATCH expected');
    assert.equal(gets.length, 1, 'exactly one GET expected');

    // The GET must request view=all.
    assert.match(gets[0].url, /view=all/);
  });

  test('PATCH sends the correct content type and body', async () => {
    const session = makeFakeSession();
    const doc = new UserDocument(session, { id: 'doc-1' });
    await doc.update({ title: 'New' });

    const patch = session.calls.find((c) => c.method === 'PATCH');
    assert.ok(patch);
    assert.equal(patch.opts.headers['content-type'], doc.contentType);
    const body = JSON.parse(patch.opts.data);
    assert.deepEqual(body, { title: 'New' });
  });
});
