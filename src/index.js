/**
 * @mendeley/sdk - a JavaScript SDK for the Mendeley API.
 *
 * The package exposes:
 *
 *   - {@link Mendeley} - the top-level client.  Use this to begin
 *     authentication.
 *   - {@link MendeleySession} - an authenticated session, exposing
 *     resources such as `session.documents`, `session.files`, etc.
 *   - All the model classes (`UserDocument`, `File`, `Annotation`, ...).
 *
 * Example (client credentials, for catalog-only access):
 *
 *     import { Mendeley } from 'mendeley';
 *
 *     const mendeley = new Mendeley({
 *       clientId: process.env.MENDELEY_CLIENT_ID,
 *       clientSecret: process.env.MENDELEY_CLIENT_SECRET,
 *     });
 *     const session = await mendeley.startClientCredentialsFlow().authenticate();
 *     for await (const doc of session.catalog.search('quantum computing').iter()) {
 *       console.log(doc.title);
 *     }
 *
 * Example (authorization code, with PKCE):
 *
 *     const mendeley = new Mendeley({ clientId, redirectUri });
 *     const auth = await mendeley.startAuthorizationCodeFlowAsync({ usePkce: true });
 *     console.log('Open this URL in a browser:', auth.getLoginUrl());
 *     // ... user is redirected back to redirectUri with `?code=...&state=...`
 *     const session = await auth.authenticate(redirectUrl);
 */

export { Mendeley } from './client.js';
export {
  AuthorizationCodeAuthenticator,
  ClientCredentialsAuthenticator,
  DefaultStateGenerator,
  ImplicitGrantAuthenticator,
  buildAuthorizationUrl,
  deriveCodeChallenge,
  fetchAuthorizationCodeToken,
  fetchClientCredentialsToken,
  generateCodeVerifier,
  isLocalhost,
  refreshToken,
} from './auth.js';
export { MendeleySession, USER_AGENT } from './session.js';
export { MendeleyApiException, MendeleyAuthException, MendeleyException } from './exception.js';
export { Page } from './pagination.js';
export { ResponseObject, SessionResponseObject, LazyResponseObject } from './response.js';

// Models
export { Annotation } from './models/annotations.js';
export {
  BoundingBox,
  Color,
  Discipline,
  Education,
  Employment,
  Location,
  Person,
  Photo,
  Position,
} from './models/common.js';
export {
  CatalogAllDocument,
  CatalogBibDocument,
  CatalogClientDocument,
  CatalogDocument,
  CatalogStatsDocument,
  LookupResponse,
} from './models/catalog.js';
export {
  TrashAllDocument,
  TrashBibDocument,
  TrashClientDocument,
  TrashDocument,
  TrashPatentDocument,
  TrashTagsDocument,
  UserAllDocument,
  UserBibDocument,
  UserClientDocument,
  UserDocument,
  UserPatentDocument,
  UserTagsDocument,
} from './models/documents.js';
export { File } from './models/files.js';
export { Folder } from './models/folders.js';
export { Group, GroupMember } from './models/groups.js';
export { Profile } from './models/profiles.js';

// Resources
export { Annotations } from './resources/annotations.js';
export { Catalog, CatalogSearch, viewType as catalogViewType } from './resources/catalog.js';
export { Documents, DocumentsSearch } from './resources/documents.js';
export { Files } from './resources/files.js';
export { Folders } from './resources/folders.js';
export { GroupMembers, Groups } from './resources/groups.js';
export { Profiles } from './resources/profiles.js';
export { Trash } from './resources/trash.js';

// Version — read from package.json so it stays in sync with releases (#89).
import pkg from '../package.json' with { type: 'json' };
export const VERSION = pkg.version;
