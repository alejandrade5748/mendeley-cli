/**
 * Tests for issue #71: catalog by-identifier returns the wrong paper.
 *
 * The Mendeley API may return loosely-matched results for identifier
 * lookups. byIdentifier() must validate that the returned record
 * actually contains the requested identifier before returning it.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { Catalog, identifierMatches, normaliseIdentifier } from '../../src/resources/catalog.js';

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
      (err) => {
        // Updated for #101: error now includes the requested id and the
        // title of the found record, rather than a generic "matched"
        // phrase. The original "Catalog document not found" prefix is
        // preserved.
        assert.match(err.message, /Catalog document not found/);
        assert.match(err.message, /arxiv=1706\.03762/);
        assert.match(err.message, /LANL Student Symposium Poster 2019/);
        return true;
      },
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

describe('normaliseIdentifier (#101)', () => {
  test('strips https://doi.org/ prefix from DOIs', () => {
    assert.equal(normaliseIdentifier('doi', 'https://doi.org/10.5555/X'), '10.5555/X');
    assert.equal(normaliseIdentifier('doi', 'http://dx.doi.org/10.5555/X'), '10.5555/X');
  });
  test('strips doi: scheme prefix', () => {
    assert.equal(normaliseIdentifier('doi', 'doi:10.5555/X'), '10.5555/X');
  });
  test('lower-cases the DOI registrant prefix', () => {
    assert.equal(normaliseIdentifier('doi', '10.5555/ABC-XYZ'), '10.5555/ABC-XYZ');
  });
  test('strips arXiv version suffix', () => {
    assert.equal(normaliseIdentifier('arxiv', '1706.03762v3'), '1706.03762');
    assert.equal(normaliseIdentifier('arxiv', '1810.04805v1'), '1810.04805');
  });
  test('strips arXiv category prefix', () => {
    assert.equal(normaliseIdentifier('arxiv', 'cs.LG/1706.03762'), '1706.03762');
    assert.equal(normaliseIdentifier('arxiv', 'cs.CL/1810.04805v2'), '1810.04805');
  });
  test('strips arXiv: scheme prefix', () => {
    assert.equal(normaliseIdentifier('arxiv', 'arXiv:1706.03762'), '1706.03762');
  });
  test('strips ISBN hyphens and spaces, upper-cases', () => {
    assert.equal(normaliseIdentifier('isbn', '978-0-13-468599-1'), '9780134685991');
    assert.equal(normaliseIdentifier('isbn', '0 306 40615 2'), '0306406152');
  });
  test('strips ISSN hyphens', () => {
    assert.equal(normaliseIdentifier('issn', '0378-5955'), '03785955');
  });
  test('passes through other types unchanged', () => {
    assert.equal(normaliseIdentifier('pmid', '12345'), '12345');
  });
});

describe('identifierMatches with normalisation (#101)', () => {
  test('accepts DOI stored with https://doi.org/ prefix', () => {
    const record = { identifiers: { doi: ['https://doi.org/10.5555/X'] } };
    assert.equal(identifierMatches(record, { doi: '10.5555/X' }), true);
  });
  test('accepts arXiv id stored with version suffix', () => {
    const record = { identifiers: { arxiv: ['1706.03762v3'] } };
    assert.equal(identifierMatches(record, { arxiv: '1706.03762' }), true);
  });
  test('accepts arXiv id stored with category prefix', () => {
    const record = { identifiers: { arxiv: ['cs.LG/1706.03762'] } };
    assert.equal(identifierMatches(record, { arxiv: '1706.03762' }), true);
  });
  test('accepts ISBN stored with hyphens', () => {
    const record = { identifiers: { isbn: ['978-0-13-468599-1'] } };
    assert.equal(identifierMatches(record, { isbn: '9780134685991' }), true);
  });
  test('still rejects a genuinely wrong identifier', () => {
    const record = { identifiers: { doi: ['10.9999/other'] } };
    assert.equal(identifierMatches(record, { doi: '10.5555/X' }), false);
  });
});

describe('Catalog.byIdentifier error message includes the found record (#101)', () => {
  test('error message includes the title and identifiers of the record that was found', async () => {
    const session = makeFakeSession([
      [
        {
          id: 'cat-4',
          title: 'Some Other Paper',
          identifiers: { doi: ['10.9999/other'] },
        },
      ],
    ]);
    const catalog = new Catalog(session);
    await assert.rejects(
      () => catalog.byIdentifier({ doi: '10.5555/X' }),
      (err) => {
        // The error must mention both the requested id and the found title,
        // so a user has actionable context.
        assert.match(err.message, /doi=10\.5555\/X/);
        assert.match(err.message, /Some Other Paper/);
        assert.match(err.message, /10\.9999\/other/);
        return true;
      },
    );
  });
});
