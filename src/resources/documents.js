/**
 * Top-level resource for accessing user library documents.
 */

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { MendeleyException } from '../exception.js';
import { guessMime } from '../mime.js';
import {
  UserAllDocument,
  UserBibDocument,
  UserClientDocument,
  UserDocument,
  UserPatentDocument,
  UserTagsDocument,
} from '../models/documents.js';
import { addQueryParams, ListResource } from './base.js';
import { DocumentsBase } from './base_documents.js';

export class Documents extends DocumentsBase {
  constructor(session, groupId) {
    super(session, groupId, null);
  }
  get _url() {
    return '/documents';
  }

  viewType(view) {
    return (
      {
        all: UserAllDocument,
        bib: UserBibDocument,
        client: UserClientDocument,
        tags: UserTagsDocument,
        patent: UserPatentDocument,
      }[view] || UserDocument
    );
  }

  async create({ title, type, ...kwargs }) {
    const body = { title, type, group_id: this.groupId, ...formatArgs(kwargs) };
    const rsp = await this.session.post('/documents', {
      data: JSON.stringify(body),
      headers: {
        accept: UserDocument.contentType,
        'content-type': UserDocument.contentType,
      },
    });
    return new UserAllDocument(this.session, await rsp.json());
  }

  async createFromFile(filePath) {
    const filename = basename(filePath);
    const data = await readFile(filePath);
    const mime = await guessMime(filename);
    const headers = {
      'content-disposition': `attachment; filename=${filename}`,
      'content-type': mime,
      accept: UserDocument.contentType,
    };
    const rsp = await this.session.post('/documents', { data, headers });
    return new UserAllDocument(this.session, await rsp.json());
  }

  search(query, kwargs = {}) {
    if (this.groupId) {
      throw new MendeleyException('Search is not available for group documents');
    }
    return new DocumentsSearch(this.session, { ...kwargs, query });
  }

  advancedSearch(kwargs = {}) {
    if (this.groupId) {
      throw new MendeleyException('Search is not available for group documents');
    }
    return new DocumentsSearch(this.session, kwargs);
  }
}

export function formatArgs(kwargs) {
  const out = { ...kwargs };
  if (out.authors !== undefined) {
    out.authors = parsePersonList(out.authors, 'authors');
  }
  if (out.editors !== undefined) {
    out.editors = parsePersonList(out.editors, 'editors');
  }
  return out;
}

/**
 * Coerce the `authors` / `editors` field of a document payload into
 * the array-of-{first_name,last_name} objects the Mendeley API
 * expects (#104). Accepts:
 *  - an array of {first_name, last_name} objects (the documented shape)
 *  - an array of strings ('First Last' or 'Surname, Name') — split
 *    client-side so callers don't have to do it
 *  - a single string ('First Last' or 'Surname, Name; Other Person')
 *    — wrapped into a one-element array
 * Throws a `MendeleyException` with an actionable message for
 * inputs that cannot be interpreted.
 */
function parsePersonList(value, fieldName) {
  if (value === null || value === undefined) return value;
  let items;
  if (Array.isArray(value)) {
    items = value;
  } else if (typeof value === 'string') {
    // Allow "A; B; C" as a multi-person string (#104): split on
    // semicolons first, then parse each name. A single "Ada
    // Lovelace" still produces a one-element list.
    const parts = value
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    items = parts.length > 0 ? parts : [value];
  } else {
    items = [value];
  }
  return items.map((entry) => {
    // Already an object (or a Person model with .json) — keep as-is.
    if (entry && typeof entry === 'object') {
      const obj = entry.json ? entry.json : entry;
      if (!obj || typeof obj !== 'object') {
        throw new MendeleyException(
          `'${fieldName}' entries must be objects with at least one of ` +
            `'first_name' or 'last_name' (got ${JSON.stringify(entry)})`,
        );
      }
      return obj;
    }
    if (typeof entry !== 'string') {
      throw new MendeleyException(
        `'${fieldName}' entries must be strings or objects, ` +
          `got ${typeof entry} (${JSON.stringify(entry)})`,
      );
    }
    return parsePersonString(entry, fieldName);
  });
}

/**
 * Parse a single 'First Last' / 'Surname, Name' / 'Surname, F. M.'
 * string into a {first_name, last_name} object (#104).
 */
function parsePersonString(s, fieldName) {
  const trimmed = s.trim();
  if (!trimmed) {
    throw new MendeleyException(`'${fieldName}' entry is an empty string`);
  }
  let last;
  let rest;
  if (trimmed.includes(',')) {
    // 'Surname, First' or 'Surname, F. M.' — split on the first comma.
    const idx = trimmed.indexOf(',');
    last = trimmed.slice(0, idx).trim();
    rest = trimmed.slice(idx + 1).trim();
  } else {
    // 'First Middle Last' — last token is the surname.
    const parts = trimmed.split(/\s+/);
    last = parts.pop();
    rest = parts.join(' ');
  }
  const obj = { last_name: last };
  if (rest) obj.first_name = rest;
  return obj;
}

/**
 * Search results for `/search/documents`.  Paginates like other list
 * resources, but the URL is fixed.
 */
export class DocumentsSearch extends ListResource {
  constructor(session, params) {
    super();
    this.session = session;
    this.params = params;
  }
  get _session() {
    return this.session;
  }
  get _url() {
    return addQueryParams('/search/documents', this.params);
  }
  _objType(kwargs = {}) {
    return (
      {
        all: UserAllDocument,
        bib: UserBibDocument,
        client: UserClientDocument,
        tags: UserTagsDocument,
      }[this.params.view] || UserDocument
    );
  }
}
