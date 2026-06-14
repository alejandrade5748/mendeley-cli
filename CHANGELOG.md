# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- `catalog byIdentifier` (used by `library add-by-doi` / `add-by-arxiv`)
  now normalises DOIs (strips `https://doi.org/`, `http://dx.doi.org/`,
  and `doi:` prefixes; lower-cases the registrant prefix) and arXiv
  ids (strips `arXiv:`, the `cs.LG/` category prefix, and the `vN`
  version suffix) before comparing. Previously, a DOI or arXiv id
  whose stored form differed in any of these ways was rejected with
  "Catalog document not found" even when the record was a real match.
  When the rejection still happens, the error now includes the title
  and identifiers of the record that *was* found, so the user can
  decide whether to fall back to `mendeley library add-by-catalog-id`
  (see below). (#101)

### Added

- `mendeley library add-by-catalog-id <id>` adds a document to the
  user library directly from a catalog id (e.g. one returned by
  `mendeley catalog search`), without going through a DOI/arXiv
  lookup. Useful as a fallback when the identifier-lookup path
  rejects a real catalog hit, and as a faster path for the common
  "I just searched the catalog, now add this one" workflow. (#102)

## [0.2.0] - 2026-06-14

### ⚠️ Potentially breaking output change

- **All list commands now emit a normalized `{ "count": N, "items": [...] }`
  envelope** in `json` mode, instead of a bare top-level array. This affects
  `documents list`, `documents list --all`, `documents search ... --all`,
  `documents annotations <id>`, `folders list`, `groups list`, `groups members`,
  `annotations list`, `trash list`, `files list`, `library recent`, and
  `library by-tag`. The `--format ids`, `--format tsv`, and `--format text`
  modes are unchanged. Scripts that consumed the raw arrays should read
  `.items` (and may now use `.count`). (#17, #88, #91, #92, #93, #97)

### Added

- An **unofficial-tool disclaimer** now appears in the README (top and a
  dedicated section), the `package.json` description, the `--help` banner,
  the `--skill` banner, and `SECURITY.md`, making clear the project is
  community-maintained and not affiliated with Mendeley Ltd. or Elsevier.
  (#87)

### Fixed

- `--version` now reports the version synced from `package.json` instead of a
  hardcoded stale value. (#89)
- A **libuv crash (exit 127)** on `catalog lookup` and other multi-request
  error paths. `process.exit()` is no longer called mid-stack; CLI failures now
  throw a `CliExitError` sentinel caught at the top level, which sets
  `process.exitCode` and lets the event loop drain naturally. (#90)
- The **empty-collection retry** logic (#70) no longer doubles API requests
  for legitimately empty results. A retry now happens only when the API does
  not explicitly report `count=0` (i.e. the `Mendeley-Count` header is
  absent); when the header is present and zero, the empty result is trusted.
  (#94)
- `catalog by-identifier` now validates that the returned record's
  `identifiers` actually contains the requested arXiv/DOI/ISBN, instead of
  returning an unrelated match. (#71)
- `documents update` now re-fetches the complete record with `view=all` after
  the PATCH, so fields like `notes` are no longer missing from the response.
  (#73)
- `documents add-note` now returns the real annotation id, not the document
  id, working around an API quirk where the POST response echoes the document
  id. (#12)
- Downloads and library exports now **auto-create destination directories**
  instead of failing with `ENOENT` when the parent directory does not exist.
  (#13)
- `--limit` is now validated consistently as a positive integer across all
  commands, and was added to `groups documents` and `groups files` where it
  was missing. (#15, #18)
- Missing flag values and invalid `--data` JSON now produce clean
  `{ "ok": false, "error": "..." }` messages instead of stack traces. (#14)
- `library dedupe --by` now validates its argument against the allowed set,
  and create/update commands reject empty bodies. (#20, #21)
- `groups members` now renders members correctly (synchronous `toJSON`), and
  `folders list` forwards the `--group` option. (#16, #19)
- Unknown CLI flags are now rejected with a **"did you mean?"** suggestion
  (Levenshtein edit-distance matching), and transient empty first pages are
  retried once. (#11, #70)
- `page.items` is now awaited before reading `page.count`. (#10)
- The `.all()` paginator is wired up for documents, and kebab-case flag
  access is fixed. (#6, #9)
- `folders add-document` now handles `204 No Content` responses correctly.
  (#69)

## [0.1.1] - 2026-06-13

### Changed

- `auth login` now prints clear, ordered browser-handoff
  instructions (#53). The terminal output walks the user through the
  four-step copy/paste round-trip: (1) open the authorisation URL,
  (2) complete the Mendeley login, (3) copy the full redirect URL
  from the browser address bar, (4) paste it at the prompt. The URL
  is visually distinct, the prompt explicitly asks for the full
  `http://localhost:…` redirect URL, and the copy clarifies that the
  CLI does not run a local callback server (the "This site can't be
  reached" page is normal). The `auth login` help text and the
  README were updated to match.

## [0.1.0] - 2026-06-13

### Security

- `auth login` and `auth exchange` no longer print access or refresh tokens
  after saving them to the token file.
- `auth url` no longer prints the PKCE `code_verifier` in stdout. The
  verifier is still saved to `~/.mendeley/pending_auth.json` for the
  subsequent `auth exchange` step.
- OAuth `state` is now validated against the expected value before the
  token exchange, in both the **authorization-code** flow
  (`AuthorizationCodeAuthenticator.authenticate`) and the **implicit
  grant** flow (`ImplicitGrantAuthenticator.authenticate`). A mismatch
  throws before any token request is made. Passing a bare authorization
  code (no URL) still works and is the documented escape hatch for
  headless / advanced usage.
- `auth set` and `auth unset` no longer copy session/token material
  into `credentials.json`. They read the credentials file directly
  (without merging `token.json` or token env vars) and only persist
  allowlisted keys (`clientId`, `clientSecret`, `redirectUri`,
  `host`). Non-allowlisted keys are now rejected by these commands.
- Pagination `Link` headers pointing to a different origin than the
  session host are now rejected before any fetch is made, preventing
  the bearer token from being sent to a malicious or compromised
  `next` / `prev` / `first` / `last` URL. Same-origin absolute URLs
  and relative paths continue to work as before.

### Fixed

- CLI crash on a non-OK API response (`Assertion failed:
!(handle->flags & UV_HANDLE_CLOSING)`) — the error path in
  `MendeleySession.request()` was reading the response body twice
  (once via `.json()`, then again via `.text()` if the JSON parse
  failed). The second read on Windows triggered a libuv assertion
  in `src\win\async.c`. The body is now read exactly once as text
  and then parsed with `JSON.parse` for the structured error message.
  This affected every command that surfaces an API error, e.g.
  `catalog by-identifier --doi <invalid>`.
- `files add-sticky-note` and `files add-highlight` no longer fail
  with `"Unexpected token '%' ... %PDF-1.3"`. The commands were
  fetching `GET /files/{id}`, which on the Mendeley API returns a
  302 redirect to the binary download URL (not the metadata JSON).
  They now resolve the file metadata via the files list endpoint
  and pass the resulting `File` model straight to
  `addStickyNote`/`addHighlight`, which correctly POSTs to
  `/annotations`. The `files get` fallback that had the same bug
  is also fixed.
- `files add-sticky-note`: the coordinate flags `--x` and `--y` are
  now `--xpos` and `--ypos`. The old `--y` was silently swallowed
  by the argparse layer because `y` is a reserved boolean flag
  (the short form of `--yes`), so the y-coordinate value was never
  passed to the API.
- Path traversal in `File.download` (SDK) and `files download` (CLI)
  is now prevented. Both layers go through a new
  `src/safe_filename.js` helper that rejects filenames containing
  path separators, absolute paths, reserved names (`.`, `..`), and
  NUL bytes; the resolved output path is then verified to remain
  inside the destination directory. The CLI's `files download`
  `--filename` flag is now actually honoured (the previous
  implementation silently ignored it).
- `folders add-document` no longer fails with `415 Unsupported Media
Type`. The CLI was sending a fabricated
  `Content-Type: application/vnd.mendeley-folder-document.1+json`
  that the Mendeley API doesn't recognise. It now uses the correct
  `application/vnd.mendeley-document.1+json` type via the new
  `FolderDocuments.add()` SDK method. `library add-by-doi` and
  `library add-by-arxiv` (both used the same fabricated type when a
  `--folder` was specified) are also fixed. `folders
remove-document` now uses the matching `FolderDocuments.remove()`
  SDK method.
- `trash empty --yes` no longer returns `400 Invalid view`. The
  command iterated the trash with `view: 'core'`, which is not a
  valid view on the trash endpoint. It now requests the default
  view (no `view` parameter), which is sufficient since only the
  document ids are needed to delete each item.

### Changed

- **Node.js**: CI matrix is now Node 22 + 24 (latest 2 LTS lines).
  Dropped Node 18 and Node 20 from the test matrix (both are EOL).
  The `engines` field in `package.json` is now `>=22.0.0`; update
  accordingly if you were on Node 18 or Node 20.
- **Docs**: CONTRIBUTING now reflects the current mocked-fetch integration
  tests instead of describing them as live Mendeley API tests.

## [1.0.0] - 2026-06-13

### Added

- Initial public release of `mendeley-cli` — a Node.js CLI and JavaScript SDK
  for the Mendeley REST API.
- Shell CLI with **JSON by default** output for AI-agent and scripting use.
- `mendeley --skill` flag that prints the full command surface as a Markdown
  document for LLM system prompts.
- PKCE OAuth flow with automatic token refresh, persistent credential and
  token storage, and a headless two-step `auth url` / `auth exchange` mode.
- Coverage of the major Mendeley resource families (catalog, library, files,
  annotations, …) via the `Mendeley` / `MendeleySession` classes.
- 51 unit and integration tests (integration tests auto-skip without
  credentials).
- Zero runtime dependencies; the optional `open` peer is used only for
  browser-based auth.
- Node.js 18+ support (ESM only).

[Unreleased]: https://github.com/VictorTomaili/mendeley-cli/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/VictorTomaili/mendeley-cli/releases/tag/v0.1.1
[0.1.0]: https://github.com/VictorTomaili/mendeley-cli/releases/tag/v0.1.0
[1.0.0]: https://github.com/VictorTomaili/mendeley-cli/releases/tag/v1.0.0
