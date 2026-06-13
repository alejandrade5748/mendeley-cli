# AGENTS.md

## Workflow

> For any non-trivial task — fixing a security issue, adding a feature, refactoring — follow the 6-phase workflow below. The four gates all loop back to **Phase 1.1 (Code)** if issues are found; do not bypass them.

### Phase 0 — Pre-work (mandatory)

- **0.1** Read the issue or task description carefully.
- **0.2 Issue check**: if a referenced issue exists on the tracker, verify it is still **open**. If it is closed, has a merged PR, or has been marked as won't-fix, **stop and tell the user** — the work may already be on `main`, or another agent may have done it. The expected `gh` invocation:
  ```bash
  gh issue view <N> --json state,stateReason,closedAt
  ```
- **0.3** Read the related code (the file/line references in the issue).
- **0.4** Sync to latest `main`:
  ```bash
  git fetch origin
  git checkout main
  git pull --ff-only origin main
  ```
- **0.5** Create a feature branch (do not commit directly to `main`):
  ```bash
  git checkout -b fix/issue-N-short-description
  # or feat/, docs/, chore/, test/, refactor/
  ```
- **0.6** Re-read the latest version of the files you are about to change — they may have shifted since the issue was filed.

### Phase 1 — Code

- 1.1 Write the minimal fix.
- 1.2 Add or update tests covering the fix (positive + negative cases).
- 1.3 Update `CHANGELOG.md` under `[Unreleased]` for user-visible changes.

### Phase 2 — Self-review (before running tests)

- 2.1 Re-read the diff: does it match the issue's **acceptance criteria** exactly?
- 2.2 Are tests adequate? Edge cases (empty inputs, special characters, concurrent access)?
- 2.3 Any obvious mistakes (typos, missing imports, wrong file)?

### Phase 3 — Test 🔁 loop gate #1

- 3.1 Run `npm test`.
- 3.2 Run `npm run format:check`.
- 3.3 **If failures** → return to **Phase 1.1 (Code)** to fix.
- 3.4 If pass → continue.

### Phase 4 — Refactor 🔁 loop gate #2

- 4.1 Reuse existing helpers, no duplication, good naming.
- 4.2 Anything over- or under-engineered?
- 4.3 `npm run format`.
- 4.4 Re-run tests after refactor.
- 4.5 **If issues** → return to **Phase 1.1 (Code)** to fix.
- 4.6 If clean → continue.

### Phase 5 — Overall review 🔁 loop gate #3

- 5.1 Re-read the full diff one more time, top to bottom.
- 5.2 `git status --short` — only intended files changed.
- 5.3 Commit message quality (one line, imperative, conventional prefix).
- 5.4 Acceptance criteria one more time.
- 5.5 **If issues** → return to **Phase 1.1 (Code)** to fix.
- 5.6 If clean → continue.

### Phase 6 — Pull request 🔁 loop gate #4 (post-PR)

- 6.1 Commit on the branch.
- 6.2 `git push -u origin <branch>`.
- 6.3 Open the PR (or instruct the user).
- 6.4 Wait for CI.
- 6.5 **If CI fails** → return to **Phase 1.1 (Code)** to fix.
- 6.6 If CI passes → hand off for review.

### Loop summary

```
        ┌──────────────────────────────────────┐
        ▼                                      │
0 → 1 → 2 → 3 —fail→ 1                         │
        │                                     │
        └→ 4 —issues→ 1                        │
        │                                     │
        └→ 5 —issues→ 1                        │
        │                                     │
        └→ 6 —CI fail→ 1                       │
                  │                           │
                  └── all clean ──→ done      │
                                              │
        (any of the 4 gates loops back to 1) ──┘
```

### Key principles

1. **Never bypass the loop gates.** A test failure is a stop sign, not "I'll deal with it later".
2. **Issue check is the first gate** — if the work is already done, don't redo it.
3. **Always work on a branch.** Don't push directly to `main`. The ruleset on `main` requires a PR; bypass is for the maintainer.
4. **All four gates loop back to Phase 1.1**, not to Phase 2 or 3. Re-reviewing after a fix is cheap; skipping review is expensive.

## Project Facts

- This repository is `mendeley-cli`: an ESM-only Node.js CLI and JavaScript SDK for the Mendeley API.
- Runtime target is Node.js `>=22` from `package.json`; CI currently runs unit tests on Node 22 and 24.
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

Follow the full **Workflow** at the top of this file. In short:

- Work on a feature branch off the latest `main`. Never push directly to `main`.
- Run `npm run test:unit`.
- Run `npm run format:check`.
- Run `npm test` for shared SDK/session/auth/output changes.
- Update `CHANGELOG.md` under `Unreleased` for user-visible changes.
- Confirm `git status --short` contains only intended files.

## Known Weak Points

- The custom parser is intentionally small and adequate for the current command surface. Adding complex CLI syntax can break existing flag-before-command behavior.
- `src/session.js` retries once after a 401. Changes to this logic can silently affect every API call.
