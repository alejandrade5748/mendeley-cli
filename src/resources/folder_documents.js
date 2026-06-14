/**
 * Documents contained in a particular folder.
 */

import { UserDocument } from '../models/documents.js';
import { addQueryParams, ListResource } from './base.js';

export class FolderDocuments extends ListResource {
  constructor(session, folderId) {
    super();
    this.session = session;
    this.folderId = folderId;
  }
  get _session() {
    return this.session;
  }
  get _url() {
    return `/folders/${this.folderId}/documents`;
  }
  _objType() {
    return UserDocument;
  }

  /**
   * Add an existing document to this folder.
   *
   * The Mendeley API returns **204 No Content** (empty body) on success,
   * so this method returns `null` when there is no body to parse.
   * If a JSON body is present, it is wrapped in a `UserDocument`.
   *
   * @param {string} documentId
   * @returns {Promise<UserDocument|null>}
   */
  async add(documentId) {
    const rsp = await this.session.post(this._url, {
      data: JSON.stringify({ id: documentId }),
      headers: {
        'content-type': UserDocument.contentType,
        accept: UserDocument.contentType,
      },
    });
    // 204 No Content — nothing to parse.
    const text = await rsp.text();
    if (!text) return null;
    try {
      return new UserDocument(this.session, JSON.parse(text));
    } catch {
      return null;
    }
  }

  /**
   * Remove a document from this folder (the document itself is not
   * deleted from the library).
   *
   * @param {string} documentId
   */
  async remove(documentId) {
    await this.session.delete(`${this._url}/${documentId}`);
  }
}
