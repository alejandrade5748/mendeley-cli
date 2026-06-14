/**
 * File model - a file attached to a document.
 */

import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

import { Annotation } from './annotations.js';
import { Color, BoundingBox, Position } from './common.js';
import { SessionResponseObject } from '../response.js';
import { parseContentDispositionFilename, safeFilename, safeJoin } from '../safe_filename.js';

export class File extends SessionResponseObject {
  static contentType = 'application/vnd.mendeley-file.1+json';
  get contentType() {
    return this.constructor.contentType;
  }

  static fields() {
    return [
      'id',
      'size',
      'filename',
      'content_type',
      'filehash',
      'document_id',
      'extension',
      'created',
    ];
  }

  /**
   * The URL at which the file can be downloaded.  This URL is only valid
   * for a short time, so should not be cached.
   */
  async getDownloadUrl() {
    const rsp = await this.session.get(`/files/${this.id}`, { allowRedirects: false });
    return rsp.headers.get('location');
  }

  /** Resolve the parent document, if any. */
  async document(view) {
    if (this.json.document_id) {
      return this.session.documents.getLazy(this.json.document_id, { view });
    }
    if (this.json.catalog_id) {
      return this.session.catalog.getLazy(this.json.catalog_id, { view });
    }
    return null;
  }

  /**
   * Download the file to `directory`.  Returns the local path.
   *
   * The filename is taken from the response's `Content-Disposition`
   * header (preferred) or the file's metadata `filename` field.  In
   * either case the name is validated by `safeFilename` and the
   * resolved path is verified to stay inside `directory`; absolute
   * paths and path-traversal segments are rejected before any bytes
   * are written to disk.
   */
  async download(directory) {
    const rsp = await this.session.get(`/files/${this.id}`, { stream: true });
    const headerName = parseContentDispositionFilename(rsp.headers.get('content-disposition'));
    const rawName = headerName || this.json.filename || `file-${this.id}`;
    const filename = safeFilename(rawName);
    const path = safeJoin(directory, filename);

    if (!rsp.body) {
      throw new Error('Response had no body to stream');
    }
    await pipeline(rsp.body, createWriteStream(path));
    return path;
  }

  async delete() {
    await this.session.delete(`/files/${this.id}`);
  }

  async addStickyNote(text, x, y, page) {
    const position = { x, y };
    const boundingBox = { top_left: position, bottom_right: position, page };
    const annotation = {
      document_id: (await this.document()).id,
      text,
      filehash: this.json.filehash,
      positions: [boundingBox],
    };
    const rsp = await this.session.post('/annotations', {
      data: JSON.stringify(annotation),
      headers: {
        accept: Annotation.contentType,
        'content-type': Annotation.contentType,
      },
    });
    return new Annotation(this.session, await rsp.json());
  }

  async addHighlight(boundingBoxes, color) {
    const annotation = {
      document_id: (await this.document()).id,
      filehash: this.json.filehash,
      positions: boundingBoxes.map((b) => (b.json ? b.json : b)),
      color: color.json ? color.json : color,
    };
    const rsp = await this.session.post('/annotations', {
      data: JSON.stringify(annotation),
      headers: {
        accept: Annotation.contentType,
        'content-type': Annotation.contentType,
      },
    });
    return new Annotation(this.session, await rsp.json());
  }
}
