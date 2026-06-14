/**
 * User library documents and trash documents, plus their views.
 *
 * Each user document can be requested in one of several "views" that
 * add extra fields.  The classes below implement all four view
 * variants for both user and trashed documents.
 */

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { Annotation } from './annotations.js';
import { Arrow, toArrow } from './common.js';
import { BaseDocument, BaseBibView, BaseClientView } from './base_documents.js';
import { File } from './files.js';
import { guessMime } from '../mime.js';

const BASE_FIELDS = [
  'id',
  'title',
  'type',
  'source',
  'year',
  'authors',
  'identifiers',
  'keywords',
  'abstract',
  'created',
];
const BIB_FIELDS = BaseBibView.fields();
const CLIENT_FIELDS = [
  ...BaseClientView.fields(),
  'read',
  'starred',
  'authored',
  'confirmed',
  'hidden',
];
const TAGS_FIELDS = ['tags'];

/** Format keyword args before they're sent over the wire. */
function formatDocArgs(kwargs) {
  const out = { ...kwargs };
  if (out.authors) out.authors = out.authors.map((a) => (a.json ? a.json : a));
  if (out.editors) out.editors = out.editors.map((a) => (a.json ? a.json : a));
  if (out.accessed) {
    const d = out.accessed instanceof Arrow ? out.accessed : new Arrow(new Date(out.accessed));
    out.accessed = d.format('YYYY-MM-DD');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Source objects holding getters/methods (NOT installed yet).
// Spreading these directly would invoke the getters, so we install
// them with `Object.defineProperty`.
// ---------------------------------------------------------------------------

const userBaseGetters = {
  get created() {
    return toArrow(this.json.created);
  },
  get last_modified() {
    if (this.json.last_modified) return toArrow(this.json.last_modified);
    if (this.json.created) return toArrow(this.json.created);
    return null;
  },
  get profile() {
    return this.json.profile_id ? this.session.profiles.getLazy(this.json.profile_id) : null;
  },
  get group() {
    return this.json.group_id ? this.session.groups.getLazy(this.json.group_id) : null;
  },
  get files() {
    return this.session.documentFiles(this.id);
  },
};

const userBibGetters = {
  get accessed() {
    return toArrow(this.json.accessed);
  },
};

const userMethods = {
  async update(kwargs = {}) {
    await this.session.patch(`/documents/${this.id}`, {
      data: JSON.stringify(formatDocArgs(kwargs)),
      headers: {
        accept: this.contentType,
        'content-type': this.contentType,
      },
    });
    // The PATCH response from the Mendeley API may not include all
    // fields (especially `notes`, `authors` in certain views), so the
    // caller cannot confirm the change from the response alone (#73).
    // Re-fetch with view=all to return a complete record.
    const params = new URLSearchParams({ view: 'all' });
    const full = await this.session.get(`/documents/${this.id}?${params}`, {
      headers: { accept: 'application/vnd.mendeley-document.1+json' },
    });
    return new UserAllDocument(this.session, await full.json());
  },
  async delete() {
    await this.session.delete(`/documents/${this.id}`);
  },
  async moveToTrash() {
    await this.session.post(`/documents/${this.id}/trash`);
    return new (this._trashedType())(this.session, this.json);
  },
  async attachFile(filePath) {
    const filename = basename(filePath);
    const data = await readFile(filePath);
    const mime = await guessMime(filename);
    const headers = {
      'content-disposition': `attachment; filename=${filename}`,
      'content-type': mime,
      link: `<${this.session.host}/documents/${this.id}>; rel="document"`,
      accept: File.contentType,
    };
    const rsp = await this.session.post('/files', { data, headers });
    return new File(this.session, await rsp.json());
  },
  async addNote(text) {
    const annotation = { document_id: this.id, text };
    const rsp = await this.session.post('/annotations/', {
      data: JSON.stringify(annotation),
      headers: {
        accept: Annotation.contentType,
        'content-type': Annotation.contentType,
      },
    });
    const body = await rsp.json();
    // The Mendeley API may return the document id as the annotation's
    // top-level `id` for type=note annotations (#12). When this
    // happens, follow up with a list query to find the real annotation
    // (the most recently created note for this document with matching
    // text) and return it instead.
    if (body.id === this.id || !body.id) {
      const listRsp = await this.session.get(
        `/annotations?document_id=${encodeURIComponent(this.id)}&type=note`,
        { headers: { accept: Annotation.contentType } },
      );
      const candidates = await listRsp.json();
      // Prefer the most recent note whose text matches.
      const match = candidates.find((c) => c.text === text);
      if (match) return new Annotation(this.session, match);
      // Fallback: last in the list (usually most recent).
      if (candidates.length > 0)
        return new Annotation(this.session, candidates[candidates.length - 1]);
    }
    return new Annotation(this.session, body);
  },
};

const trashMethods = {
  async delete() {
    await this.session.delete(`/trash/${this.id}`);
  },
  async restore() {
    await this.session.post(`/trash/${this.id}/restore`);
    return new (this._restoredType())(this.session, this.json);
  },
};

/**
 * Install getter descriptors and method definitions onto a class
 * prototype, without invoking the getters in the process.
 *
 * @param {Function} Class
 * @param {...object} sources objects whose properties (methods or getters)
 *   will be copied onto the prototype.
 */
function apply(Class, ...sources) {
  for (const source of sources) {
    if (!source) continue;
    for (const name of Object.keys(source)) {
      const descriptor = Object.getOwnPropertyDescriptor(source, name);
      Object.defineProperty(Class.prototype, name, descriptor);
    }
  }
}

// ---------------------------------------------------------------------------
// Concrete document classes
// ---------------------------------------------------------------------------

/** Base user document. */
export class UserDocument extends BaseDocument {
  static contentType = 'application/vnd.mendeley-document.1+json';
  static fields() {
    return BASE_FIELDS;
  }
  _trashedType() {
    return TrashDocument;
  }
}
apply(UserDocument, userBaseGetters, userMethods);

export class UserBibDocument extends BaseDocument {
  static contentType = 'application/vnd.mendeley-document.1+json';
  static fields() {
    return [...new Set([...BASE_FIELDS, ...BIB_FIELDS])];
  }
  _trashedType() {
    return TrashBibDocument;
  }
}
apply(UserBibDocument, userBaseGetters, userBibGetters, userMethods);

export class UserClientDocument extends BaseDocument {
  static contentType = 'application/vnd.mendeley-document.1+json';
  static fields() {
    return [...new Set([...BASE_FIELDS, ...CLIENT_FIELDS])];
  }
  _trashedType() {
    return TrashClientDocument;
  }
}
apply(UserClientDocument, userBaseGetters, userMethods);

export class UserTagsDocument extends BaseDocument {
  static contentType = 'application/vnd.mendeley-document.1+json';
  static fields() {
    return [...new Set([...BASE_FIELDS, ...TAGS_FIELDS])];
  }
  _trashedType() {
    return TrashTagsDocument;
  }
}
apply(UserTagsDocument, userBaseGetters, userMethods);

export class UserAllDocument extends BaseDocument {
  static contentType = 'application/vnd.mendeley-document.1+json';
  static fields() {
    return [...new Set([...BASE_FIELDS, ...BIB_FIELDS, ...CLIENT_FIELDS, ...TAGS_FIELDS])];
  }
  _trashedType() {
    return TrashAllDocument;
  }
}
apply(UserAllDocument, userBaseGetters, userBibGetters, userMethods);

// ---------------------------------------------------------------------------
// Trash documents
// ---------------------------------------------------------------------------

export class TrashDocument extends BaseDocument {
  static contentType = 'application/vnd.mendeley-document.1+json';
  static fields() {
    return BASE_FIELDS;
  }
  _restoredType() {
    return UserDocument;
  }
}
apply(TrashDocument, userBaseGetters, trashMethods);

export class TrashBibDocument extends BaseDocument {
  static contentType = 'application/vnd.mendeley-document.1+json';
  static fields() {
    return [...new Set([...BASE_FIELDS, ...BIB_FIELDS])];
  }
  _restoredType() {
    return UserBibDocument;
  }
}
apply(TrashBibDocument, userBaseGetters, userBibGetters, trashMethods);

export class TrashClientDocument extends BaseDocument {
  static contentType = 'application/vnd.mendeley-document.1+json';
  static fields() {
    return [...new Set([...BASE_FIELDS, ...CLIENT_FIELDS])];
  }
  _restoredType() {
    return UserClientDocument;
  }
}
apply(TrashClientDocument, userBaseGetters, trashMethods);

export class TrashTagsDocument extends BaseDocument {
  static contentType = 'application/vnd.mendeley-document.1+json';
  static fields() {
    return [...new Set([...BASE_FIELDS, ...TAGS_FIELDS])];
  }
  _restoredType() {
    return UserTagsDocument;
  }
}
apply(TrashTagsDocument, userBaseGetters, trashMethods);

export class TrashAllDocument extends BaseDocument {
  static contentType = 'application/vnd.mendeley-document.1+json';
  static fields() {
    return [...new Set([...BASE_FIELDS, ...BIB_FIELDS, ...CLIENT_FIELDS, ...TAGS_FIELDS])];
  }
  _restoredType() {
    return UserAllDocument;
  }
}
apply(TrashAllDocument, userBaseGetters, userBibGetters, trashMethods);
