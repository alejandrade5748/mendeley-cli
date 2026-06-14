/**
 * The Mendeley session object.  This is the main entry point for
 * accessing the API once you have an access token.
 */

import { MendeleyApiException, MendeleyException } from './exception.js';
import { retryWithBackoff } from './retry.js';
import { Annotations } from './resources/annotations.js';
import { Catalog } from './resources/catalog.js';
import { Documents } from './resources/documents.js';
import { Files } from './resources/files.js';
import { Folders } from './resources/folders.js';
import { Groups, GroupMembers } from './resources/groups.js';
import { Profiles } from './resources/profiles.js';
import { Trash } from './resources/trash.js';
import { FolderDocuments } from './resources/folder_documents.js';

export const USER_AGENT = `mendeley-cli/1.0.0 node`;

/**
 * Authentication session.  Holds an OAuth2 token, exposes fetch helpers
 * and lazy accessors for the various resource collections.
 */
export class MendeleySession {
  /**
   * @param {import('./client.js').Mendeley} mendeley
   * @param {object} token
   * @param {object} [client] - reserved for future use
   * @param {object} [refresher] refresher with a `refresh(session)` method
   */
  constructor(mendeley, token, client = null, refresher = null) {
    this.host = mendeley.host;
    this.clientId = mendeley.clientId;
    this.token = token;
    this.refresher = refresher;

    this.annotations = new Annotations(this);
    this.catalog = new Catalog(this);
    this.documents = new Documents(this, null);
    this.files = new Files(this);
    this.folders = new Folders(this);
    this.groups = new Groups(this);
    this.profiles = new Profiles(this);
    this.trash = new Trash(this, null);
  }

  /** @returns {boolean} `true` if we have a bearer token. */
  get isAuthenticated() {
    return !!(this.token && this.token.access_token);
  }

  /** @returns {string} the bearer token, or empty string. */
  get accessToken() {
    return (this.token && this.token.access_token) || '';
  }

  // ----- Helpers for group-scoped resources ----------------------------

  groupMembers(groupId) {
    return new GroupMembers(this, groupId);
  }
  groupDocuments(groupId) {
    return new Documents(this, groupId);
  }
  groupTrash(groupId) {
    return new Trash(this, groupId);
  }
  groupFiles(groupId) {
    return new Files(this, { groupId });
  }
  documentFiles(documentId) {
    return new Files(this, { documentId });
  }
  catalogFiles(catalogId) {
    return new Files(this, { catalogId });
  }
  folderDocuments(folderId) {
    return new FolderDocuments(this, folderId);
  }

  // ----- HTTP --------------------------------------------------------

  /**
   * Make an authenticated request against the API.  This is the lowest
   * level method exposed on the session; resources call it for you.
   *
   * Retries on transient errors (#103): HTTP 429, 5xx, and common
   * network errors (`fetch failed`, `ECONNRESET`, `ETIMEDOUT`, ...).
   * Uses exponential backoff. 4xx errors (except 408, 429) are *not*
   * retried — they are client errors.
   *
   * @param {string} method HTTP method
   * @param {string} url path or full URL
   * @param {object} [opts]
   * @param {BodyInit|null} [opts.data]
   * @param {object} [opts.headers]
   * @param {object} [opts.query] query parameters
   * @param {boolean} [opts.stream=false] return a `Response` instead of
   *   consuming the body
   * @param {boolean} [opts.allowRedirects=true]
   * @param {object} [opts.retry]  override the retry config for this call
   * @param {number} [opts.retry.maxAttempts]
   * @param {number} [opts.retry.baseMs]
   * @param {number} [opts.retry.maxMs]
   * @returns {Promise<Response>} the raw fetch Response
   */
  async request(method, url, opts = {}) {
    const { data = null, headers = {}, query, stream = false, allowRedirects = true, retry } = opts;
    const fullUrl = joinUrl(this.host, url, query);

    const finalHeaders = {
      'user-agent': USER_AGENT,
      ...headers,
    };
    if (this.accessToken) {
      finalHeaders.authorization = `Bearer ${this.accessToken}`;
    }

    // Wrap the per-attempt cycle in a retry layer (#103).  Each
    // attempt does: fetch -> maybe 401 refresh -> raise on !ok.  Any
    // thrown MendeleyApiException with a retryable status (or any
    // transient network error) is retried with backoff.
    const self = this;
    return retryWithBackoff(async () => {
      let rsp;
      try {
        rsp = await self._fetch(method, fullUrl, data, finalHeaders, allowRedirects);
      } catch (err) {
        // Surface the error to the retry layer. Mark it transient so
        // the retry layer can decide (it always retries network errors
        // up to maxAttempts).
        throw err;
      }

      // Token expired -> try a refresh once, then re-fetch.
      if (rsp.status === 401 && self.refresher) {
        await self.refresher.refresh(self);
        finalHeaders.authorization = `Bearer ${self.accessToken}`;
        rsp = await self._fetch(method, fullUrl, data, finalHeaders, allowRedirects);
      }

      if (stream) {
        // Caller is responsible for consuming the body.
        if (!rsp.ok) await raiseApiError(rsp);
        return rsp;
      }
      if (!rsp.ok) await raiseApiError(rsp);
      return rsp;
    }, retry);
  }

  async _fetch(method, fullUrl, data, headers, allowRedirects) {
    return fetch(fullUrl, {
      method,
      headers,
      body: data === null ? undefined : data,
      redirect: allowRedirects ? 'follow' : 'manual',
    });
  }

  // Convenience helpers
  get(url, opts = {}) {
    return this.request('GET', url, opts);
  }
  post(url, opts = {}) {
    return this.request('POST', url, opts);
  }
  patch(url, opts = {}) {
    return this.request('PATCH', url, opts);
  }
  put(url, opts = {}) {
    return this.request('PUT', url, opts);
  }
  delete(url, opts = {}) {
    return this.request('DELETE', url, opts);
  }
}

function joinUrl(host, url, query) {
  if (/^https?:/i.test(url)) {
    const u = new URL(url);
    if (query) appendQuery(u, query);
    return u.toString();
  }
  // Normalise: remove leading slash, ensure exactly one between host and path.
  const base = host.replace(/\/+$/, '');
  const path = url.startsWith('/') ? url : '/' + url;
  const u = new URL(base + path);
  if (query) appendQuery(u, query);
  return u.toString();
}

function appendQuery(url, query) {
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) url.searchParams.append(k, String(item));
    } else {
      url.searchParams.set(k, String(v));
    }
  }
}

async function raiseApiError(rsp) {
  // Read the response body exactly once. Reading it twice — e.g. via
  // rsp.json() then rsp.text() — can trip a libuv `UV_HANDLE_CLOSING`
  // assertion on Windows once the first read has closed the underlying
  // handle (see issue #5: CLI crashes on a 404 from the catalog).
  // Read the body as text once, then try to parse it as JSON for a
  // structured error message; fall back to the raw text.
  let raw = '';
  try {
    raw = await rsp.text();
  } catch {
    raw = '';
  }
  let message = raw;
  let body = null;
  if (raw) {
    try {
      body = JSON.parse(raw);
      message = body.message || body.error_description || body.error || raw;
    } catch {
      // Not JSON; keep the raw text.
    }
  }
  // Use MendeleyApiException so the retry layer (#103) and any
  // downstream code can inspect .status and .body. It still extends
  // MendeleyException, so `catch (err instanceof MendeleyException)`
  // keeps working.
  const err = new MendeleyApiException(
    `The Mendeley API returned an error (status: ${rsp.status}, message: ${message})`,
    rsp.status,
    body,
  );
  // Attach the response so the retry layer can read Retry-After.
  err.lastResponse = rsp;
  throw err;
}
