/**
 * Group and GroupMember models.
 */

import { Photo, toArrow } from './common.js';
import { Profile } from './profiles.js';
import { LazyResponseObject, SessionResponseObject } from '../response.js';

export class Group extends SessionResponseObject {
  static contentType = 'application/vnd.mendeley-group.1+json';
  get contentType() {
    return this.constructor.contentType;
  }

  static fields() {
    return [
      'id',
      'name',
      'description',
      'disciplines',
      'tags',
      'webpage',
      'link',
      'access_level',
      'role',
    ];
  }

  get created() {
    return toArrow(this.json.created);
  }
  get photo() {
    return this.json.photo ? new Photo(this.json.photo) : null;
  }
  get owner() {
    return this.json.owning_profile_id
      ? this.session.profiles.getLazy(this.json.owning_profile_id)
      : null;
  }
  get members() {
    return this.session.groupMembers(this.id);
  }
  get documents() {
    return this.session.groupDocuments(this.id);
  }
  get trash() {
    return this.session.groupTrash(this.id);
  }
  get files() {
    return this.session.groupFiles(this.id);
  }
}

/**
 * A member of a Mendeley group.  Wraps a `Profile`, which is loaded
 * lazily on first access.
 */
export class GroupMember extends LazyResponseObject {
  static contentType = 'application/vnd.mendeley-membership.1+json';
  get contentType() {
    return this.constructor.contentType;
  }

  constructor(session, memberJson) {
    super(session, memberJson.profile_id, Profile, () => this._load());
    this.memberJson = memberJson;
  }
  get joined() {
    return toArrow(this.memberJson.joined);
  }
  get role() {
    return this.memberJson.role;
  }
  async _load() {
    return this.session.profiles.get(this.id);
  }

  /**
   * Synchronous plain-object view for JSON serialization (#16).
   *
   * The parent `LazyResponseObject.toJSON()` is async (it returns a
   * Promise), so `JSON.stringify` would render `{}`. Expose the
   * membership fields we already have synchronously, and include the
   * profile if it has already been loaded.
   */
  toJSON() {
    const out = {
      id: this.id,
      profile_id: this.memberJson.profile_id,
      role: this.memberJson.role,
      joined: this.memberJson.joined,
    };
    if (this._value) {
      const profile = this._value.toJSON ? this._value.toJSON() : this._value;
      out.profile = profile;
    }
    return out;
  }
}
