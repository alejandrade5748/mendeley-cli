<div align="center">

# 🔬 mendeley-cli

**AI-agent-friendly CLI & JavaScript SDK for the Mendeley API**

[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Tests: 51 passing](https://img.shields.io/badge/tests-51%20passing-brightgreen)](test/)

*Query 100 M+ academic papers, manage your library, export BibTeX — from the terminal.*

[Getting started](#getting-started) · [CLI reference](#cli-reference) · [Library API](#library-api) · [AI agents](#built-for-ai-agents)

</div>

---

## Why this exists

The official Mendeley SDK is Python-only and hasn't been updated in years. This project provides:

- **A shell CLI** (`mendeley`) that defaults to **JSON output** — perfect for scripting and AI agents
- **A JavaScript library** (`import { Mendeley } from 'mendeley-cli'`) for Node.js 20+
- **Zero dependencies** (the `open` package is optional, for browser launch)
- **PKCE auth** with automatic token refresh — log in once, stay logged in
- **73 help pages** with examples, plus a `--skill` flag that dumps the full command surface as Markdown for LLM system prompts

## Getting started

```bash
# Install globally (recommended)
npm install -g mendeley-cli

# Or run directly from source
git clone https://github.com/VictorTomaili/mendeley-cli.git
cd mendeley-cli
npm install
npm link        # makes 'mendeley' available system-wide
```

### Configure credentials

Get your client ID at [dev.mendeley.com](https://dev.mendeley.com/):

```bash
mendeley auth set clientId YOUR_CLIENT_ID
mendeley auth set clientSecret YOUR_CLIENT_SECRET
mendeley auth set redirectUri http://localhost:11595
```

### Authenticate

The CLI does **not** open a browser.  It prints the authorisation URL and
prompts you to paste the redirect URL back after logging in:

```bash
mendeley auth login
# 1. Open the printed URL in a browser and log in
# 2. Copy the full redirect URL from the browser address bar
# 3. Paste it at the prompt
```

For headless servers / CI / AI agents, use the two-step flow instead:

```bash
mendeley auth url                    # prints a login URL + saves PKCE verifier
# ... visit URL in any browser, log in, copy the redirect URL ...
mendeley auth exchange "http://localhost:11595/?code=...&state=..."
```

### Verify

```bash
mendeley whoami
```

## CLI reference

Every command supports `--help` with full usage, options, and examples:

```bash
mendeley --help                       # top-level help
mendeley documents list --help        # per-command help
mendeley --skill                      # full API as a skill document (for AI system prompts)
```

### Output formats

| Flag | Format | Use case |
|------|--------|----------|
| `--format json` *(default)* | JSON | AI agents, piping to `jq` |
| `--format text` | Key-value | Quick human reading |
| `--format tsv` | Tab-separated | Spreadsheet import |
| `--format ids` | Bare IDs, one per line | Piping to `xargs` |

### Commands

<details>
<summary><strong>auth</strong> — manage authentication</summary>

```
mendeley auth login                  # print URL, paste redirect URL back (no browser)
mendeley auth logout                 # delete saved token
mendeley auth status                 # show config (no secrets)
mendeley auth whoami                 # test token via /profiles/me
mendeley auth url                    # print login URL (headless step 1)
mendeley auth exchange <url|code>    # exchange code for token (headless step 2)
mendeley auth set <key> <value>      # set clientId, clientSecret, redirectUri, host
mendeley auth unset <key>            # remove a credential
```

</details>

<details>
<summary><strong>catalog</strong> — browse the global Mendeley catalog (100 M+ papers)</summary>

```
mendeley catalog search "machine learning" --limit 10
mendeley catalog by-doi 10.1038/nature14539
mendeley catalog by-identifier --arxiv 1706.03762
mendeley catalog lookup --title "Attention is all you need"
mendeley catalog advanced-search --author Hinton --min-year 2017
mendeley catalog get <id>
```

</details>

<details>
<summary><strong>documents</strong> — manage documents in your library</summary>

```
mendeley documents list --limit 50 --all
mendeley documents get <id>
mendeley documents search "deep learning"
mendeley documents advanced-search --author LeCun --min-year 2018
mendeley documents create --title "My Paper" --type journal
mendeley documents create-from-file ./paper.pdf
mendeley documents update <id> --data '{"title":"New Title"}'
mendeley documents delete <id>
mendeley documents move-to-trash <id>
mendeley documents attach-file <id> ./supplement.pdf
mendeley documents add-note <id> "important finding"
mendeley documents annotations <id>
mendeley documents files <id>
mendeley documents export-bibtex <id>
```

</details>

<details>
<summary><strong>library</strong> — high-level library operations</summary>

```
mendeley library export-bibtex --out refs.bib
mendeley library export-json --out library.json
mendeley library dedupe --by doi
mendeley library stats
mendeley library recent --limit 5
mendeley library by-tag "to-read"
mendeley library add-by-doi 10.1038/nature14539
mendeley library add-by-arxiv 1706.03762
```

</details>

<details>
<summary><strong>folders · groups · files · annotations · trash · profile</strong></summary>

```
mendeley folders list --all
mendeley folders create "Reading List" --parent <id>
mendeley folders documents <folderId>
mendeley folders add-document <folderId> <docId>

mendeley groups list
mendeley groups members <groupId>
mendeley groups documents <groupId>

mendeley files list --document <docId>
mendeley files download <fileId> /tmp/papers

mendeley annotations list --document <docId>
mendeley annotations get <id>
mendeley annotations update <id> --data '{"text":"updated"}'
mendeley annotations delete <id>

mendeley trash list
mendeley trash restore <id>
mendeley trash empty --yes

mendeley profile me
mendeley profile get <id>
```

</details>

## Library API

Use the SDK programmatically in any Node.js 20+ project:

```bash
npm install mendeley-cli
```

```js
import { Mendeley } from 'mendeley-cli';

const mendeley = new Mendeley({
  clientId: 'YOUR_CLIENT_ID',
  clientSecret: 'YOUR_CLIENT_SECRET',
  redirectUri: 'http://localhost:11595',
});

// Client-credentials flow (no user interaction)
const session = await mendeley.startClientCredentialsFlow().authenticate();

// Search the catalog
const results = await session.catalog.search('machine learning', { view: 'all' });
const page = await results.list({ pageSize: 10 });
console.log(`Found ${(await page.items).length} results`);

// Look up by DOI
const doc = await session.catalog.byIdentifier({ doi: '10.1038/nature14539' });
console.log(doc.title);   // "Deep learning"
console.log(doc.year);    // 2015
```

### Authorization-code flow with PKCE

```js
const flow = await mendeley.startAuthorizationCodeFlowAsync({ usePkce: true });
console.log('Visit:', flow.getLoginUrl());

// ... user completes login in browser ...
const session = await flow.authenticate(authorizationCode);
const me = await session.profiles.me;
console.log(`Hello, ${me.first_name}`);
```

## Built for AI agents

The CLI is designed as a **tool** that AI agents can call directly. Key design decisions:

1. **JSON by default** — output is always valid JSON, ready for parsing
2. **`--skill` flag** — prints the entire CLI surface as a Markdown document you can paste into a system prompt:

   ```bash
   mendeley --skill > MENDELEY_SKILL.md
   ```

3. **Structured errors** — errors are JSON objects with `ok: false` and a human-readable `error` field
4. **Headless auth** — no browser is opened; the agent can run `mendeley auth login` to get a URL, or `mendeley auth url` + `mendeley auth exchange` for a two-step flow
5. **Every command documented** — `--help` shows synopsis, description, options, arguments, and at least one example

### Example: AI agent workflow

```
Agent: I'll search the Mendeley catalog for papers about CRISPR.

$ mendeley catalog search "CRISPR gene editing" --limit 5 --format ids
> 436fcd07-37bf-36d8-9d86-3f073872c69d
> a105c9f1-b55f-382a-a4ce-90241d15ec77
> ...

Agent: Found 5 papers. Let me get details on the first one.

$ mendeley catalog get 436fcd07-37bf-36d8-9d86-3f073872c69d
> { "title": "Current applications and future perspective of CRISPR/Cas9 ...", ... }

Agent: Would you like me to add this to your library?

$ mendeley library add-by-doi 10.1186/s12943-022-01518-8
> { "ok": true, "id": "...", "title": "..." }
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `MENDELEY_CLIENT_ID` | OAuth client ID (overrides credentials.json) |
| `MENDELEY_CLIENT_SECRET` | OAuth client secret |
| `MENDELEY_REDIRECT_URI` | OAuth redirect URI |
| `MENDELEY_HOST` | API base URL (default `https://api.mendeley.com`) |
| `MENDELEY_CONFIG` | Path to `credentials.json` |
| `MENDELEY_TOKEN_FILE` | Path to `token.json` |

## Development

```bash
git clone https://github.com/VictorTomaili/mendeley-cli.git
cd mendeley-cli
npm install
npm link          # install global 'mendeley' command (symlink — edits are live)

npm test          # run all 51 tests
npm run test:unit
npm run test:integration
```

No build step — this is plain ESM JavaScript targeting Node.js 20+.

### Project structure

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
test/                   51 tests (unit + integration)
```

## Security

Please **do not** file public GitHub issues for suspected vulnerabilities.
See [SECURITY.md](SECURITY.md) for the supported versions, how to report a
vulnerability privately, and our response timeline. Reports can be opened
via [GitHub Security Advisories](https://github.com/VictorTomaili/mendeley-cli/security/advisories/new)
or emailed to the maintainer.

## License

[Apache-2.0](LICENSE)
