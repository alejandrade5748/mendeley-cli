/**
 * Tests for issue #71: catalog by-identifier returns the wrong paper.
 *
 * The Mendeley API may return loosely-matched results for identifier
 * lookups. byIdentifier() must validate that the returned record
 * actually contains the requested identifier before returning it.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { Catalog, identifierMatches } from '../../src/resources/catalog.js';

function makeFakeSession(responses) {
  return {
    responses: [...responses],
    calls: [],
    async get(url, opts = {}) {
      this.calls.push({ method: 'GET', url, opts });
      const body = this.responses.shift();
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => body,
      };
    },
  };
}

describe('identifierMatches helper', () => {
  test('returns true when arxiv id is present', () => {
    const record = { identifiers: { arxiv: ['1706.03762'] } };
    assert.equal(identifierMatches(record, { arxiv: '1706.03762' }), true);
  });

  test('returns false when arxiv id does not match', () => {
    const record = { identifiers: { arxiv: ['9999.99999'] } };
    assert.equal(identifierMatches(record, { arxiv: '1706.03762' }), false);
  });

  test('returns false when identifiers field is missing', () => {
    const record = {};
    assert.equal(identifierMatches(record, { arxiv: '1706.03762' }), false);
  });

  test('returns true when doi matches', () => {
    const record = { identifiers: { doi: ['10.5555/12345'] } };
    assert.equal(identifierMatches(record, { doi: '10.5555/12345' }), true);
  });

  test('ignores undefined requested identifiers', () => {
    const record = { identifiers: { arxiv: ['1706.03762'] } };
    assert.equal(identifierMatches(record, { arxiv: '1706.03762', doi: undefined }), true);
  });

  test('requires all requested identifiers to match', () => {
    const record = { identifiers: { arxiv: ['1706.03762'] } };
    assert.equal(identifierMatches(record, { arxiv: '1706.03762', doi: '10.5555/1' }), false);
  });
});

describe('Catalog.byIdentifier validation (#71)', () => {
  test('returns the record when the identifier matches', async () => {
    const session = makeFakeSession([
      [
        {
          id: 'cat-1',
          title: 'Attention Is All You Need',
          identifiers: { arxiv: ['1706.03762'] },
        },
      ],
    ]);
    const catalog = new Catalog(session);
    const doc = await catalog.byIdentifier({ arxiv: '1706.03762' });
    assert.equal(doc.title, 'Attention Is All You Need');
  });

  test('throws when the returned record does not contain the identifier', async () => {
    // The API returns a stray loosely-matched result.
    const session = makeFakeSession([
      [
        {
          id: 'cat-2',
          title: 'LANL Student Symposium Poster 2019',
          identifiers: { arxiv: ['1901.00001'] },
        },
      ],
    ]);
    const catalog = new Catalog(session);
    await assert.rejects(
      () => catalog.byIdentifier({ arxiv: '1706.03762' }),
      /not found.*matched the requested identifier/i,
    );
  });

  test('throws when no results are returned', async () => {
    const session = makeFakeSession([[]]);
    const catalog = new Catalog(session);
    await assert.rejects(
      () => catalog.byIdentifier({ arxiv: '0000.00000' }),
      /Catalog document not found/i,
    );
  });

  test('validates doi lookups too', async () => {
    const session = makeFakeSession([
      [{ id: 'cat-3', title: 'Paper', identifiers: { doi: ['10.9999/wrong'] } }],
    ]);
    const catalog = new Catalog(session);
    await assert.rejects(
      () => catalog.byIdentifier({ doi: '10.5555/12345' }),
      /not found.*matched/i,
    );
  });
});
