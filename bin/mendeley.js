#!/usr/bin/env node
/**
 * `mendeley` - a CLI for the Mendeley API, designed for AI agents.
 *
 * The CLI defaults to JSON output (the format most useful for AI
 * agents) but accepts `--format text|tsv|ids` for human consumption.
 *
 * It also exposes a `--skill` flag that prints the entire command
 * surface as a "skill" description, suitable for pasting into an
 * LLM system prompt.
 */

import process from 'node:process';
import { Command } from '../lib/cli/command.js';
import { Output } from '../lib/cli/output.js';

import * as authCmd from '../lib/cli/commands/auth.js';
import * as documentsCmd from '../lib/cli/commands/documents.js';
import * as filesCmd from '../lib/cli/commands/files.js';
import * as foldersCmd from '../lib/cli/commands/folders.js';
import * as groupsCmd from '../lib/cli/commands/groups.js';
import * as annotationsCmd from '../lib/cli/commands/annotations.js';
import * as catalogCmd from '../lib/cli/commands/catalog.js';
import * as profileCmd from '../lib/cli/commands/profile.js';
import * as trashCmd from '../lib/cli/commands/trash.js';
import * as libraryCmd from '../lib/cli/commands/library.js';

const root = new Command(
  'mendeley',
  'UNOFFICIAL CLI for the Mendeley API (not affiliated with Mendeley/Elsevier)',
);
root.isRoot = true;

root.longDescription(
  'Unofficial, community-maintained CLI and JavaScript SDK for the ' +
    'Mendeley API. NOT affiliated with, endorsed by, or sponsored by ' +
    'Mendeley Ltd. or Elsevier. By using this tool you accept the ' +
    'Mendeley Terms of Use (https://www.elsevier.com/legal/elsevier-mendeley-terms-and-conditions). ' +
    'Official resources: https://www.mendeley.com, ' +
    'https://dev.mendeley.com/, https://github.com/mendeley/mendeley-python-sdk.',
);

root.option('--format <fmt>', 'output format (json, text, tsv, ids)', 'json');
root.option('--quiet', 'suppress non-essential output', false);
root.option('--help', 'show help', false);
root.option('--skill', 'print the full CLI as a skill description', false);
root.option('--version', 'show version', false);

root.example('mendeley --help');
root.example('mendeley --skill');
root.example('mendeley --format text documents list --limit 5');
root.example('mendeley --format ids catalog search "machine learning" --limit 20');
root.example('mendeley whoami');
root.example('mendeley auth login');
root.example('mendeley auth status');

root.envVar('MENDELEY_CONFIG', 'path to credentials.json (default ~/.mendeley/credentials.json)');
root.envVar('MENDELEY_TOKEN_FILE', 'path to token.json (default ~/.mendeley/token.json)');
root.envVar('MENDELEY_HOST', 'override the API host (default https://api.mendeley.com)');
root.envVar('MENDELEY_CLIENT_ID', 'client id, overrides credentials.json');
root.envVar('MENDELEY_CLIENT_SECRET', 'client secret, overrides credentials.json');
root.envVar('MENDELEY_REDIRECT_URI', 'redirect URI, overrides credentials.json');

authCmd.register(root);

// Add a top-level `whoami` alias for `auth whoami` so AI agents can
// type it without remembering the subcommand tree.
const whoami = root
  .command('whoami')
  .description('alias for `auth whoami` — confirm the saved token works')
  .longDescription(
    `Short alias for \`mendeley auth whoami\`.  Calls
  /profiles/me with the saved access token; non-zero exit if the
  token is missing or invalid.`,
  )
  .example('mendeley whoami');
whoami.action(async (_args, _flags, out) => {
  const { buildSession } = await import('../lib/cli/credentials.js');
  const session = await buildSession();
  out.write(await session.profiles.me);
});

documentsCmd.register(root);
filesCmd.register(root);
foldersCmd.register(root);
groupsCmd.register(root);
annotationsCmd.register(root);
catalogCmd.register(root);
profileCmd.register(root);
trashCmd.register(root);
libraryCmd.register(root);

(async () => {
  const argv = process.argv.slice(2);

  // Handle --version before anything else.
  if (argv.includes('--version')) {
    const { VERSION } = await import('../src/index.js');
    process.stdout.write(`mendeley ${VERSION}\n`);
    process.exit(0);
  }

  // Pick up the --format flag early so error output matches.
  const formatFlagIdx = argv.findIndex((a) => a === '--format' || a.startsWith('--format='));
  let format = 'json';
  if (formatFlagIdx >= 0) {
    if (argv[formatFlagIdx].startsWith('--format=')) {
      format = argv[formatFlagIdx].slice('--format='.length);
    } else {
      format = argv[formatFlagIdx + 1] || 'json';
    }
  }
  let out;
  try {
    out = new Output(format);
  } catch (err) {
    // Bad --format: print the error in plain text and exit.
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(2);
  }

  if (argv.includes('--skill')) {
    process.stdout.write(renderSkill(root) + '\n');
    process.exit(0);
  }

  if (argv.length === 0) {
    process.stdout.write(root._helpText() + '\n');
    process.exit(1);
  }

  try {
    await root.parseAndRun(argv, out);
  } catch (err) {
    out.fail(err.message || String(err), err.exitCode || 1);
  }
})();

/**
 * Render the entire command tree as a single "skill" document,
 * designed to be pasted into an AI agent's system prompt.
 */
function renderSkill(root) {
  const lines = [];
  lines.push(`# mendeley CLI — Skill Reference`);
  lines.push('');
  lines.push(
    `> **Unofficial, community-maintained tool.** NOT affiliated with, endorsed by, or sponsored by Mendeley Ltd. or Elsevier. By using it the user accepts the Mendeley Terms of Use (https://www.elsevier.com/legal/elsevier-mendeley-terms-and-conditions) and is responsible for their own usage. Official resources: https://www.mendeley.com, https://dev.mendeley.com/, https://github.com/mendeley/mendeley-python-sdk.`,
  );
  lines.push('');
  lines.push(
    `You can manage a Mendeley library by running shell commands that start with \`mendeley\`.`,
  );
  lines.push(
    `The default output format is JSON.  Use \`--format text|tsv|ids\` for human-readable output.`,
  );
  lines.push(
    `Every command supports \`--help\` for detailed usage and \`--skill\` (on the root) for the full reference.`,
  );
  lines.push('');
  lines.push(`## Global options`);
  for (const opt of root.options.filter(
    (o) => o.name !== 'help' && o.name !== 'version' && o.name !== 'skill',
  )) {
    lines.push(`  --${opt.name}${opt.arg ? ` <${opt.arg}>` : ''}  ${opt.description}`);
  }
  lines.push('');
  lines.push(`## Environment variables`);
  for (const ev of root._envVars) {
    lines.push(`  $${ev.name}  ${ev.description}`);
  }
  lines.push('');
  lines.push(`## Output formats`);
  lines.push(`  json — single JSON document (default; ideal for AI agents)`);
  lines.push(`  text — pretty-printed summary, one record per line`);
  lines.push(`  tsv  — tab-separated values with a header row`);
  lines.push(`  ids  — bare identifiers, one per line`);
  lines.push('');
  lines.push(`## Authentication`);
  lines.push(`  1. Configure credentials once:  mendeley auth set clientId <id>`);
  lines.push(
    `  2. ` + '`mendeley auth login` — prints a URL, you visit it, paste the redirect URL back.',
  );
  lines.push(`     No browser is opened, no callback server is started.`);
  lines.push(`  3. Verify with ` + '`mendeley whoami`');
  lines.push(`  4. Subsequent calls auto-refresh the token from ` + '`~/.mendeley/token.json`');
  lines.push('');
  lines.push(`## Common workflows`);
  lines.push('  • `mendeley whoami` — confirm the token is valid');
  lines.push('  • `mendeley documents list --limit 10` — list recent documents');
  lines.push('  • `mendeley documents get <id>` — fetch full metadata for one document');
  lines.push(
    '  • `mendeley catalog search "machine learning" --limit 5` — search the global catalog',
  );
  lines.push('  • `mendeley folders list` — list folders in the library');
  lines.push('  • `mendeley library add-by-doi 10.1038/nature12373` — add a paper by DOI');
  lines.push('  • `mendeley library dedupe --by doi` — find duplicate documents');
  lines.push('  • `mendeley library export-bibtex` — dump the library as BibTeX');
  lines.push('  • `mendeley profile me` — view the authenticated user');
  lines.push('');

  // Recursive command tree.
  lines.push('## Command reference');
  for (const sub of root.subcommands.values()) {
    renderCommandNode(sub, lines, '  ');
  }
  return lines.join('\n');
}

function renderCommandNode(node, lines, indent) {
  lines.push(`${indent}\`${node._qualifiedName()}\` — ${node._description || ''}`);
  for (const arg of node.positional) {
    lines.push(
      `${indent}  • <${arg.name}>  ${arg.description}${arg.required ? ' (required)' : ''}`,
    );
  }
  for (const opt of node.options) {
    if (opt.name === 'help' || opt.name === 'version' || opt.name === 'skill') continue;
    lines.push(`${indent}  • --${opt.name}${opt.arg ? ` <${opt.arg}>` : ''}  ${opt.description}`);
  }
  if (node._examples.length > 0) {
    lines.push(`${indent}  Examples:`);
    for (const ex of node._examples.slice(0, 3)) {
      lines.push(`${indent}    $ ${ex}`);
    }
  }
  for (const sub of node.subcommands.values()) {
    renderCommandNode(sub, lines, indent + '  ');
  }
  lines.push('');
}
