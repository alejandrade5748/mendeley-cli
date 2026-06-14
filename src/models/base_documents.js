/**
 * Base class for documents.
 *
 * A "document" is the canonical Mendeley resource representing a
 * bibliographic reference (a paper, book, etc.).  There are several
 * variants: catalog (read-only public catalog), user (a document in a
 * user's library) and trash.  Each variant can be requested in one of
 * several "views" that add extra fields.
 */

import { Person } from './common.js';
import { SessionResponseObject } from '../response.js';

/**
 * Common base for `CatalogDocument`, `UserDocument` and `TrashDocument`.
 */
export class BaseDocument extends SessionResponseObject {
  static contentType = 'application/vnd.mendeley-document.1+json';

  get contentType() {
    return this.constructor.contentType;
  }

  get authors() {
    if (this.json.authors) {
      return this.json.authors.map((p) => new Person(p));
    }
    return null;
  }

  static fields() {
    return ['id', 'title', 'type', 'source', 'year', 'identifiers', 'keywords', 'abstract'];
  }
}

/** Extra fields returned with `view=client` or `view=all`. */
export class BaseClientView extends SessionResponseObject {
  static fields() {
    return ['file_attached'];
  }
}

/** Extra fields returned with `view=bib` or `view=all`. */
export class BaseBibView extends SessionResponseObject {
  get editors() {
    if (this.json.editors) {
      return this.json.editors.map((p) => new Person(p));
    }
    return null;
  }

  static fields() {
    return [
      'pages',
      'volume',
      'issue',
      'websites',
      'month',
      'publisher',
      'day',
      'city',
      'edition',
      'institution',
      'series',
      'chapter',
      'revision',
      // Fields documented under the bib/all views but previously
      // omitted (#128), silently dropped by toJSON().
      'editors',
      'accessed',
      'citation_key',
      'source_type',
      'language',
      'short_title',
      'reprint_edition',
      'genre',
      'country',
      'translators',
      'series_editor',
      'code',
      'medium',
      'user_context',
      'department',
    ];
  }
}
