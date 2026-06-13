/**
 * Pagination helpers.
 *
 * Many Mendeley API endpoints return a page of results together with
 * `Link` headers that point to the next/prev/first/last page.  This module
 * wraps a single page and exposes a uniform navigation API.
 */

const LINKS_HEADER = 'link';

/**
 * Parse a `Link` header into a dictionary of `{ rel: { url } }`.
 * @param {string|null} header
 * @returns {Object<string, {url: string}>}
 */
function parseLinkHeader(header) {
  if (!header) return {};
  const result = {};
  for (const part of header.split(',')) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match) {
      result[match[2]] = { url: match[1] };
    }
  }
  return result;
}

/**
 * A page of a collection of objects.
 *
 * @param {import('./session.js').MendeleySession} session
 * @param {Response} rsp the raw fetch Response
 * @param {Function} objType constructor used to wrap each item
 * @param {number} [count] total count (when known)
 */
export class Page {
  constructor(session, rsp, objType, count) {
    this.session = session;
    this.rsp = rsp;
    this.objType = objType;
    this._items = null;
    this._links = parseLinkHeader(rsp.headers.get(LINKS_HEADER));

    if (count !== undefined && count !== null) {
      this.count = count;
    } else {
      const headerCount = rsp.headers.get('mendeley-count');
      if (headerCount) {
        this.count = parseInt(headerCount, 10);
      } else {
        this.count = 0; // filled in lazily once items are read
      }
    }
  }

  /** Asynchronously fetch and cache the items on this page. */
  async _fetchItems() {
    if (this._items === null) {
      const body = await this.rsp.json();
      this._items = body.map((i) => new this.objType(this.session, i));
      if (!this.count) this.count = this._items.length;
    }
    return this._items;
  }

  /** Promise resolving to the list of items on this page. */
  get items() {
    return this._fetchItems();
  }

  /** Promise resolving to the next page, or `null` if there isn't one. */
  get next_page() {
    return this._navigate('next');
  }

  /** Promise resolving to the previous page, or `null`. */
  get previous_page() {
    return this._navigate('prev');
  }

  /** Promise resolving to the first page, or `null`. */
  get first_page() {
    return this._navigate('first');
  }

  /** Promise resolving to the last page, or `null`. */
  get last_page() {
    return this._navigate('last');
  }

  async _navigate(rel) {
    const link = this._links[rel];
    if (!link) return null;
    assertSameOrigin(link.url, this.session.host, rel);
    const rsp = await this.session.get(link.url);
    return new Page(this.session, rsp, this.objType, this.count);
  }

  /**
   * Materialise the entire collection as an array.  Useful for AI agents
   * that just want a flat list of items.
   */
  async all() {
    const out = [];
    let page = this;
    while (page) {
      const items = await page.items;
      out.push(...items);
      page = await page.next_page;
    }
    return out;
  }
}

/**
 * Reject pagination links that would send the bearer token to a
 * different origin than the configured session host.  A malicious or
 * compromised API response (or a misconfigured `host`) could otherwise
 * exfiltrate the token via a `Link: <https://attacker.example/...>` header.
 *
 * Relative paths are always allowed — they will be joined to the
 * session host by `joinUrl` and stay same-origin by construction.
 * Absolute URLs are compared by origin (scheme + host + port); the
 * path and query are not considered.
 *
 * @param {string} url  the URL from the Link header
 * @param {string} host the session's configured API host
 * @param {string} rel  the link relation (for the error message)
 */
function assertSameOrigin(url, host, rel) {
  // Relative paths are always safe — they get joined onto `host` by
  // joinUrl, so the resulting request is same-origin.
  if (!/^https?:/i.test(url)) return;
  let linkOrigin;
  let hostOrigin;
  try {
    linkOrigin = new URL(url).origin;
    hostOrigin = new URL(host).origin;
  } catch {
    // If we can't parse either URL, fail closed — the request is
    // safer blocked than sent to a host we can't reason about.
    throw new Error(
      `Refusing to follow ${rel} pagination link: cannot parse URL: ${JSON.stringify(url)}`,
    );
  }
  if (linkOrigin !== hostOrigin) {
    throw new Error(
      `Refusing to follow ${rel} pagination link across origins: ` +
        `link=${linkOrigin} session=${hostOrigin}. ` +
        `Pagination must stay on the same origin as the session host.`,
    );
  }
}
