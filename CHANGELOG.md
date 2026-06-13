# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/VictorTomaili/mendeley-cli/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/VictorTomaili/mendeley-cli/releases/tag/v0.1.0
[1.0.0]: https://github.com/VictorTomaili/mendeley-cli/releases/tag/v1.0.0
