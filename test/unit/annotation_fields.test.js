/**
 * Tests for issue #124: Annotation model field whitelist.
 *
 * Annotation.fields() previously returned only
 * ['id', 'text', 'privacy_level', 'type'], so toJSON() stripped the
 * most useful fields the API actually returns: positions, color,
 * document_id, filehash, profile_id, created, last_modified.
 *
 * Now (#124): fields() mirrors the documented "Annotation attributes"
 * table from the Mendeley API reference plus `type`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Annotation } from '../../src/models/annotations.js';

const SAMPLE = {
  id: 'ann-1',
  text: 'Important point',
  type: 'highlight',
  privacy_level: 'private',
  positions: [
    {
      top_left: { x: 10, y: 20 },
      bottom_right: { x: 100, y: 40 },
      page: 1,
    },
  ],
  color: { r: 255, g: 255, b: 0 },
  document_id: 'doc-1',
  filehash: 'sha1-abcdef',
  profile_id: 'prof-1',
  created: '2024-01-15T00:00:00.000Z',
  last_modified: '2024-02-01T00:00:00.000Z',
};

function make(json = SAMPLE) {
  // Annotation extends SessionResponseObject; a null session is fine
  // for toJSON() which never touches it.
  return new Annotation(null, json);
}

test('toJSON includes positions (#124)', () => {
  const json = make().toJSON();
  assert.ok(Array.isArray(json.positions), `expected array, got ${typeof json.positions}`);
  assert.equal(json.positions.length, 1);
  assert.deepEqual(json.positions[0].top_left, { x: 10, y: 20 });
});

test('toJSON includes color as raw {r,g,b} (#124)', () => {
  const json = make().toJSON();
  assert.deepEqual(json.color, { r: 255, g: 255, b: 0 });
});

test('toJSON includes document_id, filehash, profile_id (#124)', () => {
  const json = make().toJSON();
  assert.equal(json.document_id, 'doc-1');
  assert.equal(json.filehash, 'sha1-abcdef');
  assert.equal(json.profile_id, 'prof-1');
});

test('toJSON includes created and last_modified as ISO strings (#124)', () => {
  const json = make().toJSON();
  assert.equal(json.created, '2024-01-15T00:00:00.000Z');
  assert.equal(json.last_modified, '2024-02-01T00:00:00.000Z');
});

test('toJSON still includes the original whitelist (id, text, type, privacy_level)', () => {
  const json = make().toJSON();
  assert.equal(json.id, 'ann-1');
  assert.equal(json.text, 'Important point');
  assert.equal(json.type, 'highlight');
  assert.equal(json.privacy_level, 'private');
});

test('optional fields are omitted when absent in the source JSON', () => {
  const ann = make({
    id: 'ann-2',
    text: null,
    type: 'note',
    privacy_level: 'private',
  });
  const json = ann.toJSON();
  // No positions/color/document_id/etc in source -> omitted.
  assert.equal(json.positions, undefined);
  assert.equal(json.color, undefined);
  assert.equal(json.document_id, undefined);
  assert.equal(json.filehash, undefined);
  assert.equal(json.profile_id, undefined);
  assert.equal(json.created, undefined);
  assert.equal(json.last_modified, undefined);
});

test('a sticky note (no color) round-trips without emitting color: null', () => {
  const ann = make({
    ...SAMPLE,
    type: 'sticky_note',
    color: undefined,
    positions: [
      {
        top_left: { x: 5, y: 5 },
        bottom_right: { x: 5, y: 5 },
        page: 2,
      },
    ],
  });
  const json = ann.toJSON();
  assert.equal(json.color, undefined); // omitted, not null
  assert.ok(Array.isArray(json.positions));
});

test('instance getters still work alongside the expanded whitelist', () => {
  const ann = make();
  // Prototype getter for positions returns BoundingBox wrappers,
  // while toJSON() emits the raw array. Both should work.
  assert.ok(Array.isArray(ann.positions));
  // color getter returns a Color wrapper.
  assert.ok(ann.color, 'color getter should return a value');
  // created getter returns a formatted value (toArrow).
  assert.ok(ann.created !== undefined);
});

test('Annotation.fields() lists all documented attributes', () => {
  const fields = Annotation.fields();
  const expected = [
    'id',
    'text',
    'type',
    'privacy_level',
    'positions',
    'color',
    'document_id',
    'filehash',
    'profile_id',
    'created',
    'last_modified',
  ];
  for (const f of expected) {
    assert.ok(fields.includes(f), `fields() should include ${f}`);
  }
});
