/**
 * Top-level resource for trashed documents.
 */

import {
  TrashAllDocument,
  TrashBibDocument,
  TrashClientDocument,
  TrashDocument,
  TrashPatentDocument,
  TrashTagsDocument,
} from '../models/documents.js';
import { DocumentsBase } from './base_documents.js';

export class Trash extends DocumentsBase {
  constructor(session, groupId) {
    super(session, groupId, null);
  }
  get _url() {
    return '/trash';
  }
  viewType(view) {
    return (
      {
        all: TrashAllDocument,
        bib: TrashBibDocument,
        client: TrashClientDocument,
        tags: TrashTagsDocument,
        patent: TrashPatentDocument,
      }[view] || TrashDocument
    );
  }
}
