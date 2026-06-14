# Reporting issues — instructions for LLMs and AI agents

> **Audience:** this document is written for LLMs, coding agents, and
> automation that want to file a well-formed report against `mendeley-cli`.
> It tells you exactly **what to collect**, **which channel to use**, and
> **what never to include**. If you are a human, see
> [CONTRIBUTING.md](../CONTRIBUTING.md) instead.

`mendeley-cli` is an **unofficial**, community-maintained tool. Reports are
handled by volunteers; make them easy to action. Follow this sheet literally.

---

## 0. Golden rules

1. **Never file a security issue publicly.** Suspected vulnerabilities go to
   private [GitHub Security Advisories](https://github.com/VictorTomaili/mendeley-cli/security/advisories/new)
   — see [SECURITY.md](../SECURITY.md). This is non-negotiable.
2. **Never paste secrets.** No access tokens, refresh tokens, OAuth
   `code_verifier` values, redirect URLs containing `code=`, `.env` contents,
   `~/.mendeley/*.json` contents, or full library exports. See
   [Redaction](#5-redaction--secrets) below.
3. **One report per issue.** Don't bundle unrelated problems.
4. **Search before filing.** Check
   [open issues](https://github.com/VictorTomaili/mendeley-cli/issues?q=is%3Aissue)
   for duplicates first.
5. **Be minimal.** Reduce the reproduction to the smallest command that
   triggers the problem.

---

## 1. Triage: pick the right channel

Use this decision tree before you collect anything.

| If the problem is…                                                                      | Channel                       | Template / link                                                                              |
| --------------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------- |
| Something **crashes, errors, or behaves wrongly**                                       | **Bug report**                | [bug.yml](https://github.com/VictorTomaili/mendeley-cli/issues/new?template=bug.yml)         |
| A **command, option, or behaviour is missing** you wish existed                         | **Enhancement**               | [feature.yml](https://github.com/VictorTomaili/mendeley-cli/issues/new?template=feature.yml) |
| A **suspected vulnerability** (auth, token leak, injection, path traversal, SSRF, etc.) | **Private security advisory** | [new advisory](https://github.com/VictorTomaili/mendeley-cli/security/advisories/new)        |
| A **question or idea** that is not a concrete bug or request                            | **Discussion**                | [discussions](https://github.com/VictorTomaili/mendeley-cli/discussions) (if enabled)        |

**Ambiguity rule:** if you are unsure whether something is a bug or an
enhancement, treat **unexpected error output / wrong data / crash** as a bug,
and **missing capability** as an enhancement. Never escalate an uncertainty
into a public security report — when in doubt, open a private advisory and let
the maintainer reclassify.

---

## 2. What to collect before filing a bug

Run these commands and capture the output. They map 1:1 to the `bug.yml`
template fields, so gathering them up front means you can fill the template in
one pass.

```bash
# mendeley-cli version  (maps to "mendeley-cli version")
mendeley --version                      # e.g. "mendeley 0.2.0"

# Node.js version       (maps to "Node.js version")
node --version                          # e.g. "v22.4.0"

# Operating system      (maps to "Operating system")
#   detect programmatically:
uname -s 2>/dev/null || ver || systeminfo | findstr /B /C:"OS Name"
```

Then capture, **without secrets**:

- **The exact command** that failed — the full `mendeley ...` invocation
  including flags, with document/folder/group **ids left in** (ids are not
  secrets) but **credentials redacted**.
- **Expected behavior** — one or two sentences.
- **Actual behavior** — the full output the CLI printed. Copy it verbatim,
  including the `{ "ok": false, "error": "..." }` JSON object if present.
- **Steps to reproduce** — the minimal ordered list (auth setup → command →
  failure). Prefer a sequence that works against a fresh config.
- **Additional context** — output of `mendeley --format json ... -v` is often
  more useful than the default text mode, if the command gets far enough.

### Reproducibility self-check

Before you file, confirm the report answers all of these. If any answer is
"no", go back and gather more — a report a human has to interrogate you for is a
report that gets closed as `needs-information`.

- [ ] Does running the exact command a second time reproduce it?
- [ ] Is the `mendeley --version` output included?
- [ ] Is the `node --version` output included?
- [ ] Is the OS included?
- [ ] Have all tokens / credentials been redacted?
- [ ] Is the reproduction minimal (no unrelated flags, no 50-line pipelines)?

---

## 3. Title format

Use a bracketed prefix so triage is fast. The repo's existing issues follow this
convention:

```
[Bug]         <short, specific, one line>
[Enhancement] <capability being requested>
```

Good:

```
[Bug]         catalog lookup exits 127 on 404 (libuv crash)
[Bug]         documents annotations <id> returns bare array, not {count, items}
[Enhancement] add --dry-run to destructive commands
```

Bad (too vague):

```
[Bug]         it broke
[Enhancement] make it better
```

---

## 4. Filing with the GitHub CLI

If you have `gh` authenticated, you can file directly. Always prefer the
**template URL** so the structured fields are filled; raw body-only issues lose
triage metadata.

### Bug

````bash
gh issue create \
  --repo VictorTomaili/mendeley-cli \
  --title "[Bug] <one-line summary>" \
  --label "bug,needs-triage" \
  --body "$(cat <<'EOF'
## mendeley-cli version
0.2.0

## Node.js version
v22.4.0

## Operating system
Linux

## Command that failed
```bash
mendeley catalog lookup --title "..."
````

## Expected behavior

A clean error or a catalog id.

## Actual behavior

```json
{ "ok": false, "error": "..." }
```

## Steps to reproduce

1. `mendeley auth login`
2. `mendeley catalog lookup --title "..."`
3. Observe exit code 127 / crash.

## Additional context

None.
EOF
)"

````

### Enhancement

```bash
gh issue create \
  --repo VictorTomaili/mendeley-cli \
  --title "[Enhancement] <capability>" \
  --label "enhancement,needs-triage" \
  --body "$(cat <<'EOF'
## Problem
<What workflow is currently awkward or missing?>

## Proposed solution
<Concrete command/option/behaviour, with an example invocation.>

## Alternatives considered
<Any other approaches and why this one is better.>

## Are you willing to submit a PR?
Yes / No / Maybe, with guidance
EOF
)"
````

> **Note on labels:** `bug,needs-triage` / `enhancement,needs-triage` are the
> labels the templates apply. If your `gh` token lacks permission to set
> labels, omit `--label`; a maintainer will add them during triage.

---

## 5. Redaction & secrets

Before pasting **any** output, scrub it. The things most likely to leak:

| Leak source                      | Where it appears                                   | What to do                                                                      |
| -------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------- |
| `access_token` / `refresh_token` | `~/.mendeley/token.json`, env vars                 | **Never paste.** Replace with `<redacted>`.                                     |
| OAuth `code_verifier` / `state`  | `~/.mendeley/pending_auth.json`, `auth url` output | **Never paste.**                                                                |
| Redirect URL containing `?code=` | browser address bar, logs                          | Strip the `code=` query param.                                                  |
| `.env` / `.env.*`                | repo root                                          | **Never paste.** Only paste from [`.env.example`](../.env.example).             |
| API keys, client secrets         | config files                                       | Replace with `<redacted>`.                                                      |
| Personal library data            | `documents list` dumps                             | Replace titles/authors with placeholders unless they're public catalog records. |

The CLI itself never prints tokens after the auth flow (see CHANGELOG), but
**you** are responsible for anything you copy out of `~/.mendeley/` or `auth`
output into a report. When in doubt, redact.

> Document/folder/group **ids are not secrets.** Leave them in — they're
> essential for reproduction.

---

## 6. After you file

- Reports get the `needs-triage` label automatically. A maintainer will label
  and prioritise. There is **no SLA** — this is a volunteer project.
- If you can also fix it, say so in the report and open a PR referencing the
  issue number (e.g. `Fixes #123`). Follow the
  [6-phase workflow in AGENTS.md](../AGENTS.md).
- Do **not** `@`-mention maintainers to "bump" an issue. If new evidence
  appears, comment with it; otherwise let triage run.

---

## 7. Quick reference

```text
Bug          → /issues/new?template=bug.yml        labels: bug,needs-triage
Enhancement  → /issues/new?template=feature.yml     labels: enhancement,needs-triage
Security     → /security/advisories/new             (PRIVATE — never public)
Question     → /discussions                         (ideas, not concrete requests)
```

Repo: <https://github.com/VictorTomaili/mendeley-cli>
