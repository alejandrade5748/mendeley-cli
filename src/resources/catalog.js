/**
 * Top-level resource for accessing catalog documents.
 */

import { MendeleyException } from '../exception.js';
import {
  CatalogAllDocument,
  CatalogBibDocument,
  CatalogClientDocument,
  CatalogDocument,
  CatalogStatsDocument,
  LookupResponse,
} from '../models/catalog.js';
import { addQueryParams, GetByIdResource, ListResource } from './base.js';

export class Catalog extends GetByIdResource {
  constructor(session) {
    super();
    this.session = session;
  }
  get _session() {
    return this.session;
  }
  get _url() {
    return '/catalog';
  }
  _objType(kwargs = {}) {
    return viewType(kwargs.view);
  }

  async byIdentifier({ arxiv, doi, isbn, issn, pmid, scopus, filehash, view } = {}) {
    const url = addQueryParams('/catalog', {
      arxiv,
      doi,
      isbn,
      issn,
      pmid,
      scopus,
      filehash,
      view,
    });
    const objType = viewType(view);
    const rsp = await this.session.get(url, { headers: { accept: objType.contentType } });
    const body = await rsp.json();
    if (body.length === 0) {
      throw new MendeleyException('Catalog document not found');
    }
    // The Mendeley API may return loosely-matched results for identifier
    // lookups. Validate that the first result actually contains the
    // requested identifier before returning it — otherwise a stray
    // record would be returned as a high-confidence match (#71).
    const record = body[0];
    const requested = { arxiv, doi, isbn, issn, pmid, scopus, filehash };
    if (!identifierMatches(record, requested)) {
      throw new MendeleyException(
        'Catalog document not found: no result matched the requested identifier',
      );
    }
    return new objType(this.session, record);
  }

  async lookup({ arxiv, doi, pmid, filehash, title, authors, year, source, view } = {}) {
    const url = addQueryParams('/metadata', {
      arxiv,
      doi,
      pmid,
      filehash,
      title,
      authors,
      year,
      source,
    });
    const objType = viewType(view);
    const rsp = await this.session.get(url, {
      headers: { accept: 'application/vnd.mendeley-document-lookup.1+json' },
    });
    return new LookupResponse(this.session, await rsp.json(), view, objType);
  }

  search(query, kwargs = {}) {
    return new CatalogSearch(this.session, { ...kwargs, query });
  }
  advancedSearch(kwargs = {}) {
    return new CatalogSearch(this.session, kwargs);
  }
}

export class CatalogSearch extends ListResource {
  constructor(session, params) {
    super();
    this.session = session;
    this.params = params;
  }
  get _session() {
    return this.session;
  }
  get _url() {
    return addQueryParams('/search/catalog', this.params);
  }
  _objType() {
    return viewType(this.params.view);
  }
}

export function viewType(view) {
  return (
    {
      bib: CatalogBibDocument,
      client: CatalogClientDocument,
      stats: CatalogStatsDocument,
      all: CatalogAllDocument,
    }[view] || CatalogDocument
  );
}

/**
 * Check whether a catalog record contains the requested identifier (#71).
 *
 * The Mendeley API stores identifiers as an object mapping type to an
 * array of values, e.g. `{ arxiv: ['1706.03762'], doi: ['10.5555/1'] }`.
 * This returns true only if every requested identifier is present in
 * the record, so a stray loosely-matched result is rejected.
 *
 * @param {object} record  the catalog record returned by the API
 * @param {Record<string, string>} requested  the identifiers the user asked for
 * @returns {boolean}
 */
export function identifierMatches(record, requested) {
  const ids = record.identifiers || {};
  for (const [type, value] of Object.entries(requested)) {
    if (value === undefined || value === null) continue;
    const candidates = ids[type];
    if (!Array.isArray(candidates) || !candidates.includes(String(value))) {
      return false;
    }
  }
  return true;
}
