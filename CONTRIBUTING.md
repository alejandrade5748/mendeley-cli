# Contributing to mendeley-cli

Thanks for your interest in contributing! This project is a small CLI / SDK
and contributions of all sizes are welcome — typo fixes, docs, tests, and
new features alike.

By participating, you agree to abide by the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Project structure

```
bin/mendeley.js         CLI entry point
lib/cli/                CLI framework (command parser, output, credentials)
  commands/             One file per top-level subcommand
src/                    JavaScript SDK
  client.js             Mendeley class — entry point
  session.js            MendeleySession — authenticated resource container
  auth.js               OAuth flow helpers (auth-code, client-credentials, PKCE)
  resources/            REST resource classes
  models/               JSON model classes with lazy fields
  pagination.js         Page iterator
  response.js           ResponseObject, LazyResponseObject
test/                   Unit + integration tests
```

## Development setup

Requirements: **Node.js >= 22** (see `engines` in `package.json`).

```bash
git clone https://github.com/VictorTomaili/mendeley-cli.git
cd mendeley-cli
npm install
npm link            # makes the `mendeley` command available globally (live symlink)
```

There is **no build step** — the project is plain ESM JavaScript.

## Running tests

```bash
npm test                       # run all tests (unit + integration)
npm run test:unit              # unit tests only
npm run test:integration       # integration tests only
```

The current integration tests use mocked `fetch` responses and do not hit
the live Mendeley API. If live API coverage is added later, keep it opt-in,
gate it behind explicit credentials/environment flags, and skip it by
default when credentials are missing.

## Code style

The project uses [Prettier](https://prettier.io/) with the config in
[`.prettierrc.json`](.prettierrc.json).

```bash
npx prettier --check .     # verify formatting
npx prettier --write .     # auto-format
```

There is no ESLint or other linter; Prettier handles formatting and the
test suite handles correctness.

## CLI changes

If you add or modify a CLI command, regenerate the help text and skill
document by running:

```bash
mendeley --skill > MENDELEY_SKILL.md   # if you have a global link
```

…and keep examples accurate. New commands should follow the pattern in
`lib/cli/commands/` — each subcommand is one file exporting a default
`{ name, description, options, run }` object.

## Submitting issues

- **Bugs and feature requests**: use the
  [bug report](https://github.com/VictorTomaili/mendeley-cli/issues/new?template=bug.yml)
  and [feature request](https://github.com/VictorTomaili/mendeley-cli/issues/new?template=feature.yml)
  templates.
- **Security issues**: do **not** open a public issue — see
  [SECURITY.md](SECURITY.md).
- **Filing from an LLM / coding agent?** Read
  [`.github/LLM_ISSUE_REPORTING.md`](.github/LLM_ISSUE_REPORTING.md) first — it is
  a machine-actionable checklist covering triage, data collection, redaction,
  and the exact `gh` commands to file a well-formed report.

## Submitting pull requests

1. Fork the repo and create a topic branch
   (`git checkout -b fix/short-description` or `feat/...`, `docs/...`,
   `test/...`).
2. Make your changes, including a test when behaviour changes.
3. Run `npm test` and `npx prettier --check .` and ensure both pass.
4. Update [CHANGELOG.md](CHANGELOG.md) under the "Unreleased" section
   describing the change in one line (e.g. `Added: …`, `Fixed: …`,
   `Changed: …`).
5. Open a pull request using the
   [PR template](.github/PULL_REQUEST_TEMPLATE.md). The CI workflow will
   run the full test matrix on Node 22 and 24 across Linux, macOS,
   and Windows.

## Commit messages

Short, imperative, present tense. Conventional Commits are encouraged
but not required:

```
feat: add `mendeley catalog cite` command
fix: handle empty pages array in pagination
docs: clarify PKCE auth in README
test: cover response lazy fields
```

## License

This project is licensed under the Apache License 2.0. By submitting a
contribution, you agree to license it under the same terms — see
[LICENSE](LICENSE) for the full text.

## Repository protection

The repository uses [GitHub Rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets)
for branch and tag protection. The ruleset definitions are
version-controlled in [`.github/rulesets/`](.github/rulesets/):

- `main-branch.json` — protects `main`: requires a PR with 1 approval,
  requires the 6 CI jobs to pass, requires linear history, blocks
  force-pushes and deletions. `@VictorTomaili` is on the bypass list.
- `release-tags.json` — protects `v*` tags: blocks tag updates and
  deletions. `@VictorTomaili` is on the bypass list.

To re-apply the rules (e.g. on a fresh repo, or after a wipe):

```bash
gh api --method POST \
  -H "Accept: application/vnd.github+json" \
  repos/VictorTomaili/mendeley-cli/rulesets \
  --input .github/rulesets/main-branch.json

gh api --method POST \
  -H "Accept: application/vnd.github+json" \
  repos/VictorTomaili/mendeley-cli/rulesets \
  --input .github/rulesets/release-tags.json
```

Both rulesets are bypassed for `@VictorTomaili`, so as the maintainer
you can still push directly to `main` and re-tag releases when needed.
Other contributors go through the normal PR + CI flow.
