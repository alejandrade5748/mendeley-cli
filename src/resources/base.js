/**
 * Base classes for the various resources exposed by the Mendeley API.
 */

import { Page } from '../pagination.js';
import { LazyResponseObject } from '../response.js';

/**
 * Abstract base for a resource.  Subclasses must expose:
 *   - `_session`: a `MendeleySession`
 *   - `_url`: a relative path
 *   - `_objType(**kwargs)`: the model class returned by the API
 */
export class BaseResource {
  get _session() {
    throw new Error('not implemented');
  }
  get _url() {
    throw new Error('not implemented');
  }
  _objType() {
    throw new Error('not implemented');
  }
}

/** Resources that can be retrieved by id. */
export class GetByIdResource extends BaseResource {
  /**
   * Fetch a single object by id.
   * @param {string} id
   * @param {object} [kwargs] extra query parameters and view hint
   * @returns {Promise<object>} an instance of `_objType`
   */
  async get(id, kwargs = {}) {
    const objType = this._objType(kwargs);
    const url = addQueryParams(`${this._url}/${id}`, kwargs);
    const rsp = await this._session.get(url, {
      headers: { accept: objType.contentType },
    });
    return new objType(this._session, await rsp.json());
  }

  /**
   * Return a {@link LazyResponseObject} that defers the actual fetch until
   * the object is needed.
   */
  getLazy(id, kwargs = {}) {
    return new LazyResponseObject(this._session, id, this._objType(kwargs), () =>
      this.get(id, kwargs),
    );
  }
}

/** Resources that can be listed. */
export class ListResource extends BaseResource {
  /**
   * Return the first page of items.
   * @param {object} [kwargs] query parameters (and view hint)
   * @param {number} [kwargs.pageSize] - 0/null/undefined means default
   * @returns {Promise<Page>}
   */
  async list(kwargs = {}) {
    const { pageSize, ...rest } = kwargs;
    if (pageSize) rest.limit = pageSize;
    const objType = this._objType(rest);
    const url = addQueryParams(this._url, rest);
    const rsp = await this._session.get(url, { headers: { accept: objType.contentType } });
    return new Page(this._session, rsp, objType);
  }

  /**
   * Iterate over every item in the collection, transparently paging.
   * @param {object} [kwargs]
   * @returns {AsyncGenerator<object>}
   */
  async *iter(kwargs = {}) {
    let page = await this.list(kwargs);
    let retried = false;
    while (page) {
      const items = await page.items;
      // Guard against transient empty responses (#70): under rapid
      // consecutive calls, the API sometimes returns an empty body
      // for a populated collection. Retry once when there's evidence
      // the result should be non-empty — either the mendeley-count
      // header reported > 0, or the header was absent (can't tell).
      // Skip the retry when the API explicitly reported count=0 (#94).
      if (
        items.length === 0 &&
        !page._links.next &&
        !retried &&
        (page.count > 0 || !page._countHeaderPresent)
      ) {
        retried = true;
        page = await this.list(kwargs);
        continue;
      }
      for (const item of items) yield item;
      page = await page.next_page;
    }
  }

  /**
   * Materialise the entire collection as a flat array.  Convenient for
   * AI agents that just want a single list of items.
   */
  async all(kwargs = {}) {
    const out = [];
    for await (const item of this.iter(kwargs)) out.push(item);
    return out;
  }
}

/**
 * Append or replace query parameters on a URL (relative or absolute).
 *
 * @param {string} url
 * @param {object} params
 * @returns {string}
 */
export function addQueryParams(url, params = {}) {
  // Split into scheme+host / path / query / fragment.
  const m = url.match(/^([a-z]+:\/\/[^/?#]+)?(\/[^?#]*)?(\?[^#]*)?(#.*)?$/i);
  if (!m) return url;
  const [, origin = '', path = '', query = '', fragment = ''] = m;
  const sp = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    sp.delete(name);
    if (Array.isArray(value)) {
      for (const v of value) sp.append(name, String(v));
    } else {
      sp.set(name, String(value));
    }
  }
  const newQuery = sp.toString();
  return `${origin}${path}${newQuery ? '?' + newQuery : ''}${fragment}`;
}
