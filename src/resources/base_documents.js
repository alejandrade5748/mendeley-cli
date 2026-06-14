/**
 * Shared base for `Documents` and `Trash`.
 *
 * Mirrors the original Python SDK's `DocumentsBase` class, which used
 * multiple inheritance from `GetByIdResource` and `ListResource`.  In
 * JavaScript, `super` is more restrictive than Python's MRO, so we just
 * call the parent class methods directly.
 */

import { GetByIdResource, ListResource, addQueryParams } from './base.js';

export class DocumentsBase extends GetByIdResource {
  constructor(session, groupId, folderId) {
    super();
    this.session = session;
    this.groupId = groupId;
    this.folderId = folderId;
  }

  get _session() {
    return this.session;
  }

  _objType(kwargs = {}) {
    return this.viewType(kwargs.view);
  }

  viewType(view) {
    throw new Error('not implemented');
  }

  async get(id, kwargs = {}) {
    return GetByIdResource.prototype.get.call(this, id, kwargs);
  }

  async list(kwargs = {}) {
    return ListResource.prototype.list.call(this, {
      ...kwargs,
      group_id: this.groupId,
      folder_id: this.folderId,
    });
  }

  async *iter(kwargs = {}) {
    yield* ListResource.prototype.iter.call(this, {
      ...kwargs,
      group_id: this.groupId,
      folder_id: this.folderId,
    });
  }

  async all(kwargs = {}) {
    return ListResource.prototype.all.call(this, {
      ...kwargs,
      group_id: this.groupId,
      folder_id: this.folderId,
    });
  }

  getLazy(id, kwargs = {}) {
    return GetByIdResource.prototype.getLazy.call(this, id, kwargs);
  }
}
