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
    // Normalisation rules in `identifierMatches` (DOI URL prefixes,
    // arXiv version suffixes, ISBN hyphens, ...) accept legitimate
    // variations but still reject a genuinely wrong record (#101).
    const record = body[0];
    const requested = { arxiv, doi, isbn, issn, pmid, scopus, filehash };
    if (!identifierMatches(record, requested)) {
      const found = record.title
        ? `, but found "${record.title}" with identifiers ${JSON.stringify(
            record.identifiers || {},
          )}`
        : '';
      const requestedStr = Object.entries(requested)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      throw new MendeleyException(
        `Catalog document not found: requested ${requestedStr}${found}. ` +
          `This usually means the catalog returned a loosely-matched record whose stored ` +
          `identifier does not match yours. Try \`mendeley catalog search\` to find the correct id, ` +
          `or open an issue with the failing DOI/arXiv at ` +
          `https://github.com/VictorTomaili/mendeley-cli/issues.`,
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
 * Check whether a catalog record contains the requested identifier (#71, #101).
 *
 * The Mendeley API stores identifiers as an object mapping type to an
 * array of values, e.g. `{ arxiv: ['1706.03762'], doi: ['10.5555/1'] }`.
 * This returns true only if every requested identifier is present in
 * the record after normalisation, so a stray loosely-matched result
 * is rejected while legitimate normalisations (URL prefixes, arXiv
 * version suffixes, case) are still accepted.
 *
 * Normalisation rules (#101):
 *  - DOI:    strip `https://doi.org/` or `http://dx.doi.org/` prefix,
 *            strip a leading `doi:` scheme, lower-case the path.
 *  - arXiv:  strip a leading `arXiv:` prefix, strip the version
 *            suffix `vN`, accept `cs.LG/1706.03762` and
 *            `1706.03762` interchangeably.
 *  - ISBN:   strip hyphens and spaces, upper-case.
 *  - ISSN:   strip hyphens.
 *  - other:  exact string match (case-sensitive).
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
    if (!Array.isArray(candidates)) return false;
    const target = normaliseIdentifier(type, String(value));
    const normalised = candidates.map((c) => normaliseIdentifier(type, String(c)));
    if (!normalised.includes(target)) return false;
  }
  return true;
}

/**
 * Normalise an identifier value for comparison (#101). Returns the
 * input unchanged for identifier types we don't have a rule for.
 */
export function normaliseIdentifier(type, value) {
  if (!value) return value;
  let v = String(value).trim();
  if (type === 'doi') {
    v = v.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
    v = v.replace(/^doi:/i, '');
    // Lower-case the host if present (e.g. 10.5555/XYZ -> 10.5555/xyz),
    // but leave the suffix as-is because some publishers encode case
    // in the suffix.
    v = v.replace(/^(10\.\d{4,9})\//i, (_, p1) => `${p1.toLowerCase()}/`);
    return v;
  }
  if (type === 'arxiv') {
    v = v.replace(/^arxiv:/i, '');
    v = v.replace(/^([a-z\-]+(?:\.[A-Z]{2})?)\//i, ''); // strip cs.LG/
    v = v.replace(/v\d+$/i, ''); // strip version suffix
    return v;
  }
  if (type === 'isbn') {
    return v.replace(/[\s\-]/g, '').toUpperCase();
  }
  if (type === 'issn') {
    return v.replace(/[\s\-]/g, '');
  }
  return v;
}
