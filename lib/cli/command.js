/**
 * Minimal subcommand framework for the CLI.
 *
 *     const root = new Command('mendeley');
 *     const docs = root.command('documents').description('manage docs');
 *     docs.command('list')
 *     .description('list documents')
 *     .option('--limit <n>', 'page size')
 * .example('mendeley documents list --limit 5')
 * .action(async (args, flags, out) => { ... });
 *
 *     root.parseAndRun(process.argv.slice(2));
 *
 * Every command supports `.description(...)`, `.example(...)`, `.option(...)`,
 * `.argument(...)`, `.action(...)`, and `.help()`.  The help output is
 * designed to double as a "skill" description for AI agents: it lists
 * the command's purpose, its arguments and options, and several
 * concrete examples of use.
 */

import process from 'node:process';
import { ArgvError, parse } from './argparse.js';
import { CliExitError } from './output.js';

/**
 * @callback ActionFn
 * @param {string[]} args positional arguments
 * @param {Record<string, any>} flags
 * @param {import('./output.js').Output} out
 * @returns {Promise<void>|void}
 */

export class Command {
  /**
   * @param {string} name
   * @param {string} [desc]
   */
  constructor(name, desc = '') {
    this.name = name;
    this._description = desc;
    this._longDescription = '';
    this._examples = [];
    this._aliases = [];
    this._seeAlso = [];
    this._envVars = [];
    this.subcommands = new Map();
    this.options = []; // [{name, arg, description, default, parse}]
    this.positional = []; // [{name, description, required}]
    this._actionFn = null;
    this.parent = null;
    this.isRoot = false;
  }

  /**
   * Add a subcommand.  The `name` may include `<arg>` placeholders
   * which are automatically registered as required positional
   * arguments.
   */
  command(name, desc) {
    // Parse `<arg>` and `[arg]` placeholders out of the name.
    const positional = [];
    for (const piece of name.match(/<([^>]+)>|\[([^\]]+)\]/g) || []) {
      const argName = piece.slice(1, -1);
      const required = piece.startsWith('<');
      positional.push({ name: argName, description: '', required });
    }
    const baseName = name.replace(/<[^>]+>|\[[^\]]+\]/g, '').trim();
    if (this.subcommands.has(baseName)) {
      return this.subcommands.get(baseName);
    }
    const sub = new Command(baseName, desc);
    sub.parent = this;
    sub.positional = positional;
    this.subcommands.set(baseName, sub);
    return sub;
  }

  description(text) {
    if (text === undefined) return this._description;
    this._description = text;
    return this;
  }

  /** Set a longer description that is shown in the help output. */
  longDescription(text) {
    this._longDescription = text;
    return this;
  }

  /** Add a usage example.  Can be called multiple times. */
  example(...lines) {
    this._examples.push(...lines);
    return this;
  }

  /** Add a command alias (shorthand for the same subcommand). */
  alias(...names) {
    this._aliases.push(...names);
    return this;
  }

  /** Mark a related command to mention in the "See also" section. */
  seeAlso(...refs) {
    this._seeAlso.push(...refs);
    return this;
  }

  /** List environment variables that affect this command. */
  envVar(name, desc) {
    this._envVars.push({ name, description: desc });
    return this;
  }

  /** @returns {string} the description text. */
  getDescription() {
    return this._description;
  }

  /**
   * Add a named option.  The value is parsed through `parse` (default
   * identity).  `--no-<name>` is treated as a boolean false.
   */
  option(spec, desc, defaultValue, parse = identity) {
    const m = spec.match(/^--([a-zA-Z0-9-]+)(?:\s+<(\w+)>)?/);
    if (!m) throw new Error(`Invalid option spec: ${spec}`);
    let name = m[1];
    if (name.startsWith('no-')) {
      // `--no-foo` registers an option named `foo` that defaults to true.
      name = name.slice(3);
      defaultValue = defaultValue === undefined ? true : defaultValue;
    }
    this.options.push({
      name,
      arg: m[2] || null,
      description: desc || '',
      default: defaultValue,
      parse,
    });
    return this;
  }

  /**
   * Add a positional argument.
   */
  argument(name, desc, { required = true } = {}) {
    this.positional.push({ name, description: desc, required });
    return this;
  }

  /**
   * Set the action to run when this command is invoked.
   * @param {ActionFn} fn
   */
  action(fn) {
    this._actionFn = fn;
    return this;
  }

  /**
   * Walk the subcommand tree along the given token list and return
   * the deepest node reached.  Used to resolve `--help` for a
   * subcommand.
   */
  resolve(tokens) {
    let node = this;
    for (const t of tokens) {
      const sub = node.subcommands.get(t);
      if (!sub) break;
      node = sub;
    }
    return node;
  }

  /**
   * Parse argv and run the matching sub-command (or this command's
   * action if there is no further subcommand).
   */
  async parseAndRun(argv, out) {
    if (this.isRoot) {
      return this._runRoot(argv, out);
    }
    return this._runInner(argv, {}, out);
  }

  async _runRoot(argv, out) {
    let parsed;
    try {
      parsed = parse(argv);
    } catch (err) {
      if (err instanceof ArgvError) {
        out.fail(err.message);
        return;
      }
      throw err;
    }
    const { command, args, flags } = parsed;

    // `--help` / `-h` always shows the deepest matched command's help.
    if (flags.help) {
      const target = command ? this.resolve([command, ...args]) : this;
      process.stdout.write(target._helpText() + '\n');
      return;
    }

    if (!command) {
      if (this._actionFn) {
        const merged = mergeFlags(flags, this.options);
        const positional = validatePositional(args, this.positional);
        await this._actionFn(positional, merged, out);
        return;
      }
      this._printHelp(out);
      return;
    }

    if (this.subcommands.has(command)) {
      const sub = this.subcommands.get(command);
      await sub._runInner(args, flags, out);
      return;
    }

    if (this._actionFn) {
      const merged = mergeFlags(flags, this.options);
      const positional = validatePositional([command, ...args], this.positional);
      await this._actionFn(positional, merged, out);
      return;
    }

    out.fail(`unknown command: ${command}\n\n${this._helpText()}`);
  }

  async _runInner(args, flags, out) {
    // Merge the flags from the parent call with the local parse — the
    // parent may have already consumed some flags, so re-parse the
    // *remaining* args.  Since flags survive the parent parse, we
    // combine them here.
    const fullArgs = [...args];
    if (flags && Object.keys(flags).length) {
      for (const [k, v] of Object.entries(flags)) {
        if (v === true) {
          fullArgs.push(`--${k}`);
        } else if (v === false) {
          fullArgs.push(`--no-${k}`);
        } else {
          fullArgs.push(`--${k}`, String(v));
        }
      }
    }
    let parsed;
    try {
      parsed = parse([this.name, ...fullArgs]);
    } catch (err) {
      if (err instanceof ArgvError) {
        out.fail(err.message);
        return;
      }
      throw err;
    }
    const { command, args: subArgs, flags: subFlags } = parsed;

    if (subFlags.help) {
      // Resolve the deepest subcommand.
      const target = this.resolve(subArgs);
      process.stdout.write(target._helpText() + '\n');
      return;
    }

    // `command` here is always `this.name` because we prepended it.
    if (this.subcommands.has(command)) {
      // Shouldn't happen, but handle defensively.
      const sub = this.subcommands.get(command);
      await sub._runInner(subArgs, subFlags, out);
      return;
    }

    if (this._actionFn) {
      try {
        validateUnknownFlags(subFlags, this.options);
        validateMissingFlagValues(subFlags, this.options);
        const merged = mergeFlags(subFlags, this.options);
        const positional = validatePositional(subArgs, this.positional);
        await this._actionFn(positional, merged, out);
      } catch (err) {
        if (err instanceof ArgvError) {
          out.fail(err.message);
          return;
        }
        throw err;
      }
      return;
    }

    // Look at args[0] for a subcommand.
    const first = subArgs[0];
    if (first && this.subcommands.has(first)) {
      const sub = this.subcommands.get(first);
      await sub._runInner(subArgs.slice(1), subFlags, out);
      return;
    }

    this._printHelp(out);
  }

  _printHelp(out) {
    process.stdout.write(this._helpText() + '\n');
  }

  /**
   * Render the help text for this command.  Designed to be useful
   * both to humans and to AI agents (it includes synopsis, options,
   * and concrete examples).
   */
  _helpText() {
    const out = [];
    const path = this._path();
    const title = path ? `mendeley ${path}` : 'mendeley';
    out.push(`${title} — ${this._description || 'no description'}`);
    out.push('');

    // Synopsis
    out.push('Synopsis:');
    out.push(`  $ ${this._synopsis()}`);
    out.push('');

    if (this._longDescription) {
      out.push('Description:');
      for (const line of this._longDescription.split(/\n/)) {
        out.push(`  ${line}`);
      }
      out.push('');
    }

    if (this.subcommands.size > 0) {
      out.push('Subcommands:');
      for (const sub of this.subcommands.values()) {
        const aliases = sub._aliases.length ? ` (alias: ${sub._aliases.join(', ')})` : '';
        const line = `  ${pad(sub._qualifiedName(), 24)} ${sub._description || ''}${aliases}`;
        out.push(line);
      }
      out.push('');
    }

    if (this._aliases.length > 0) {
      out.push('Aliases:');
      for (const a of this._aliases) {
        out.push(`  ${a}`);
      }
      out.push('');
    }

    if (this.options.length > 0) {
      out.push('Options:');
      for (const opt of this.options) {
        const spec = opt.arg ? `--${opt.name} <${opt.arg}>` : `--${opt.name}`;
        const def =
          opt.default !== undefined && opt.default !== false && opt.default !== null
            ? ` (default: ${formatDefault(opt.default)})`
            : '';
        out.push(`  ${pad(spec, 30)} ${opt.description}${def}`);
      }
      out.push('');
    }

    if (this.positional.length > 0) {
      out.push('Arguments:');
      for (const arg of this.positional) {
        const req = arg.required ? 'required' : 'optional';
        out.push(`  ${pad(`<${arg.name}>`, 24)} ${arg.description} (${req})`);
      }
      out.push('');
    }

    if (this._envVars.length > 0) {
      out.push('Environment:');
      for (const ev of this._envVars) {
        out.push(`  ${pad(ev.name, 30)} ${ev.description}`);
      }
      out.push('');
    }

    if (this._examples.length > 0) {
      out.push('Examples:');
      for (const ex of this._examples) {
        out.push(`  $ ${ex}`);
      }
      out.push('');
    }

    if (this._seeAlso.length > 0) {
      out.push('See also:');
      for (const ref of this._seeAlso) {
        out.push(`  • ${ref}`);
      }
      out.push('');
    }

    return out
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd();
  }

  _qualifiedName() {
    if (this._positionalSpec()) {
      return `${this.name} ${this._positionalSpec()}`;
    }
    return this.name;
  }

  _positionalSpec() {
    const parts = [];
    for (const arg of this.positional) {
      parts.push(arg.required ? `<${arg.name}>` : `[${arg.name}]`);
    }
    return parts.join(' ');
  }

  _path() {
    const parts = [];
    let cur = this;
    while (cur && !cur.isRoot) {
      parts.unshift(cur.name);
      cur = cur.parent;
    }
    return parts.join(' ');
  }

  _synopsis() {
    const parts = [];
    if (this.isRoot) parts.push('mendeley');
    else parts.push('mendeley ' + this._path());
    const pos = this._positionalSpec();
    if (pos) parts.push(pos);
    if (this.subcommands.size > 0 && !this._actionFn) parts.push('<subcommand>');
    parts.push('[flags]');
    return parts.filter(Boolean).join(' ');
  }
}

function pad(s, w) {
  if (s.length >= w) return s + ' ';
  return s + ' '.repeat(w - s.length);
}

function formatDefault(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

function identity(v) {
  return v;
}

// Flags valid on every command (defined on the root program).
const GLOBAL_FLAGS = new Set(['format', 'quiet', 'help', 'skill', 'version', 'h', 'v', 'q']);

/**
 * Reject flags that are not defined on this command or globally (#11).
 * Throws an ArgvError with a "did you mean?" hint when possible.
 */
function validateUnknownFlags(flags, options) {
  const known = new Set(GLOBAL_FLAGS);
  for (const opt of options) {
    known.add(opt.name);
    if (opt.name.includes('-')) {
      known.add(opt.name.replace(/-([a-z])/g, (_, c) => c.toUpperCase()));
    }
  }
  for (const key of Object.keys(flags)) {
    if (!known.has(key)) {
      const suggestion = suggestFlag(key, known);
      throw new ArgvError(
        `unknown flag: --${key}` + (suggestion ? `. Did you mean --${suggestion}?` : ''),
      );
    }
  }
}

/**
 * Reject value-options that received no value (#14).
 *
 * When `--file` is the last token (or followed by another flag),
 * the parser stores `true` instead of a string. Options declared
 * with `<arg>` require a value, so a boolean `true` means the user
 * forgot to supply one. Throw a clean CLI error instead of letting
 * the action crash with a raw V8/Node internal error.
 */
function validateMissingFlagValues(flags, options) {
  for (const opt of options) {
    if (opt.arg && flags[opt.name] === true) {
      throw new ArgvError(`--${opt.name} requires a <${opt.arg}> argument`);
    }
  }
}

/**
 * Find the closest known flag name using a simple edit-distance metric.
 * Returns null when nothing is close enough to suggest.
 */
function suggestFlag(input, known) {
  let best = null;
  let bestDist = Infinity;
  for (const k of known) {
    const d = editDistance(input, k);
    if (d < bestDist) {
      bestDist = d;
      best = k;
    }
  }
  // Only suggest if within a reasonable threshold.
  const threshold = Math.max(2, Math.floor(input.length / 3));
  return bestDist <= threshold ? best : null;
}

/** Levenshtein edit distance. */
function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 3) return Infinity;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

function mergeFlags(flags, options) {
  const out = { ...flags };
  for (const opt of options) {
    if (!(opt.name in out)) {
      out[opt.name] = opt.default;
    } else if (out[opt.name] === 'true') {
      out[opt.name] = true;
    } else if (out[opt.name] === 'false') {
      out[opt.name] = false;
    } else if (opt.parse && opt.parse !== identity) {
      try {
        out[opt.name] = opt.parse(out[opt.name]);
      } catch (err) {
        throw new Error(`invalid value for --${opt.name}: ${err.message}`);
      }
    }
    // Expose a camelCase alias for kebab-case option names so action
    // code can write `flags.modifiedSince` instead of
    // `flags['modified-since']` (issue #9).  Both forms remain valid.
    if (opt.name.includes('-')) {
      const camel = opt.name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      out[camel] = out[opt.name];
    }
  }
  return out;
}

function validatePositional(args, positional) {
  const out = [];
  for (let i = 0; i < positional.length; i++) {
    const arg = positional[i];
    if (i < args.length) {
      out.push(args[i]);
    } else if (arg.required) {
      throw new ArgvError(`missing required argument: <${arg.name}>`);
    } else {
      out.push(undefined);
    }
  }
  if (args.length > positional.length) {
    out.push(...args.slice(positional.length));
  }
  return out;
}
