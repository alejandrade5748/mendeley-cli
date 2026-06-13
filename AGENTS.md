# AGENTS.md

## Project Facts

- This repository is `mendeley-cli`: an ESM-only Node.js CLI and JavaScript SDK for the Mendeley API.
- Runtime target is Node.js `>=20` from `package.json`; CI currently runs unit tests on Node 22 and 24 only.
- There is no build step. Source files are shipped directly from `src/`, `lib/`, and `bin/`.
- The package entry point is `src/index.js`; the executable is `bin/mendeley.js`.
- The project intentionally keeps dependencies near zero. `open` is optional; do not add runtime dependencies unless the gain is concrete and the API surface cannot stay simple without them.

## Repository Map

- `bin/mendeley.js`: CLI entry point, root command registration, global flags, `--skill` renderer, `--version`.
- `lib/cli/command.js`: custom command tree and help renderer. Avoid replacing it with a framework unless explicitly requested.
- `lib/cli/argparse.js`: small argument parser. Short flags are intentionally rejected.
- `lib/cli/output.js`: output contract for `json`, `text`, `tsv`, and `ids`.
- `lib/cli/credentials.js`: credential and token resolution for CLI sessions.
- `lib/cli/commands/`: one file per top-level CLI command, each exporting `register(program)`.
- `src/client.js`: `Mendeley` SDK entry point and auth flow factory.
- `src/auth.js`: OAuth2, PKCE, token exchange, and refresh helpers.
- `src/session.js`: authenticated session, fetch wrapper, token refresh retry, resource accessors.
- `src/resources/`: REST resource classes. Put API endpoint behavior here.
- `src/models/`: response model classes. Put JSON field exposure and object relationships here.
- `src/response.js`: `ResponseObject`, `SessionResponseObject`, and lazy response behavior.
- `src/pagination.js`: page and link-header traversal.
- `test/unit/`: unit tests using `node:test` and `node:assert/strict`.
- `test/integration/`: currently mocked-fetch integration tests, not live API tests.

## Commands

- Install dependencies with `npm install` or `npm ci`.
- Run all tests: `npm test`.
- Run unit tests only: `npm run test:unit`.
- Run integration tests only: `npm run test:integration`.
- Run the CLI from source: `node bin/mendeley.js ...` or `npm run cli -- ...`.
- Check formatting: `npm run format:check`.
- Apply formatting: `npm run format`.

Local note: if the environment routes `npm` through another package manager and creates an untracked lockfile, do not keep that lockfile unless the user explicitly wants to migrate package managers. This repo currently tracks `package-lock.json`.

## Coding Rules

- Use ESM imports and exports. Do not introduce CommonJS.
- Use Node built-ins before third-party packages.
- Preserve Prettier settings in `.prettierrc.json`: 2 spaces, semicolons, single quotes, trailing commas, LF line endings, 100-column print width.
- Keep comments useful and short. Existing files use JSDoc-style comments for exported classes and non-obvious behavior.
- Avoid broad rewrites. This repo is small; focused changes are easier to verify.
- Do not add TypeScript, Babel, bundlers, ESLint, or test frameworks unless explicitly requested.

## CLI Contract

- JSON is the default output and must remain machine-parseable.
- CLI errors in JSON mode are objects shaped like `{ "ok": false, "error": "..." }`.
- Supported output formats are exactly `json`, `text`, `tsv`, and `ids` unless the request explicitly changes the contract.
- Every new command or option needs help text and at least one concrete example.
- If a new boolean flag has no value, add it to `BOOLEAN_FLAGS` in `lib/cli/argparse.js`; otherwise the parser may consume the next token as its value.
- Preserve the top-level `whoami` alias unless the user explicitly removes it.
- If command behavior changes, verify both the command action and help rendering.

## SDK And API Patterns

- Put HTTP endpoint mechanics in `src/resources/*`, not in CLI command files.
- Put JSON field lists and lazy relationships in `src/models/*`.
- Resource list methods should return `Page` objects; collection traversal should use async iterators where practical.
- Model classes should extend `ResponseObject` or `SessionResponseObject` and define `static fields()`.
- Preserve lazy loading via `LazyResponseObject`; do not eagerly fetch related resources unless required by the command.
- `MendeleySession.request()` is the central HTTP path. Changes there affect auth, refresh, pagination, and every resource.

## Auth And Secrets

- Never commit real `.env`, `.env.*`, credentials, tokens, OAuth codes, refresh tokens, or user library exports containing private data.
- `.env.example` is the only tracked environment file.
- CLI credential precedence is: environment variables, credentials file, then token file fallback.
- Default credential paths are under `~/.mendeley/`; `MENDELEY_CONFIG` and `MENDELEY_TOKEN_FILE` override them.
- For tests, mock `fetch` instead of calling the live Mendeley API. If a live test is unavoidable, it must be opt-in and skipped when credentials are absent.

## Testing Expectations

- For behavior changes, add or update focused tests under `test/unit/` or `test/integration/`.
- Use `node:test` and `node:assert/strict`; do not add another test runner.
- Mock `globalThis.fetch` and restore it in `afterEach` for network-path tests.
- Prefer direct command/resource/model tests over end-to-end shell tests unless process behavior is the subject.
- Run at least `npm run test:unit` and `npm run format:check` before claiming completion.
- When changing `src/session.js`, `src/auth.js`, pagination, credentials, or output formatting, run `npm test` unless blocked.

## Change Checklists

### Adding Or Changing A CLI Command

- Update or add the relevant file in `lib/cli/commands/`.
- Register new top-level commands in `bin/mendeley.js`.
- Keep command output compatible with `Output.write()`.
- Add examples and help text.
- Add tests for argument parsing, command dispatch, and output shape when applicable.
- Update README/CONTRIBUTING/CHANGELOG when user-facing behavior changes.

### Adding Or Changing A Resource

- Add endpoint behavior in `src/resources/`.
- Add or update models in `src/models/`.
- Export public SDK classes from `src/index.js`.
- Add tests for URL construction, query parameters, pagination, model wrapping, and error behavior.
- Keep group-scoped and document-scoped variants explicit; do not hide them in brittle string concatenation.

### Changing Auth Or Credentials

- Add regression tests for credential precedence and token refresh behavior.
- Preserve headless auth behavior: the CLI prints URLs and accepts redirect URLs/codes; it should not require a browser.
- Treat token refresh as security-sensitive. Do not log secrets or full token payloads.

### Preparing A PR

- Run `npm run test:unit`.
- Run `npm run format:check`.
- Run `npm test` for shared SDK/session/auth/output changes.
- Update `CHANGELOG.md` under `Unreleased` for user-visible changes.
- Confirm `git status --short` contains only intended files.

## Known Weak Points

- CI tests Node 22 and 24, while `package.json` allows Node `>=20`; if using APIs newer than Node 20, either avoid them or update the engine policy deliberately.
- `CONTRIBUTING.md` says integration tests hit the live API, but the current integration test uses mocked `fetch`. Do not copy that claim into new docs without reconciling it.
- The custom parser is intentionally small. Adding complex CLI syntax can break existing flag-before-command behavior.
- `src/session.js` retries once after a 401. Changes to this logic can silently affect every API call.
