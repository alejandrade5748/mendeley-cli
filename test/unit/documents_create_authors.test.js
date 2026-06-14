/**
 * Tests for issue #104: `documents create` authors schema.
 *
 * The `authors` / `editors` field must be a list of
 * {first_name, last_name} objects.  The SDK now (#104):
 *  - validates that input and throws an actionable error if it
 *    cannot be parsed (instead of the bare
 *    `out.authors.map is not a function` TypeError);
 *  - accepts string entries ('First Last', 'Surname, Name') and
 *    splits them client-side;
 *  - accepts a single string and wraps it in a one-element list.
 *
 * The integration test in test/integration/session.test.js covers
 * the existing array-of-objects path; this file covers the
 * new behaviour and the CLI help text.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatArgs } from '../../src/resources/documents.js';
import { MendeleyException } from '../../src/exception.js';

const CLI = fileURLToPath(new URL('../../bin/mendeley.js', import.meta.url));

// ---- parsePersonList (unit) ---------------------------------------

function callFormat(body) {
  return formatArgs(body);
}

describe('Documents authors/editors parsing (#104)', () => {
  test('array of {first_name, last_name} objects passes through unchanged', () => {
    const out = callFormat({
      authors: [{ first_name: 'Ada', last_name: 'Lovelace' }],
    });
    assert.deepEqual(out.authors, [{ first_name: 'Ada', last_name: 'Lovelace' }]);
  });

  test('array of strings — "First Last" splits into first/last', () => {
    const out = callFormat({ authors: ['Ada Lovelace', 'Grace Hopper'] });
    assert.deepEqual(out.authors, [
      { first_name: 'Ada', last_name: 'Lovelace' },
      { first_name: 'Grace', last_name: 'Hopper' },
    ]);
  });

  test('array of strings — "Surname, First" splits on the comma', () => {
    const out = callFormat({ authors: ['Lovelace, Ada', 'Hopper, Grace'] });
    assert.deepEqual(out.authors, [
      { first_name: 'Ada', last_name: 'Lovelace' },
      { first_name: 'Grace', last_name: 'Hopper' },
    ]);
  });

  test('array of strings — "Surname, F. M." (initials) splits on the comma', () => {
    const out = callFormat({ authors: ['Knuth, D. E.'] });
    assert.deepEqual(out.authors, [{ first_name: 'D. E.', last_name: 'Knuth' }]);
  });

  test('single string input is wrapped in a one-element array', () => {
    const out = callFormat({ authors: 'Ada Lovelace' });
    assert.deepEqual(out.authors, [{ first_name: 'Ada', last_name: 'Lovelace' }]);
  });

  test('"Smith, J.; Doe, A." single string with semicolons is split into two people', () => {
    const out = callFormat({ authors: 'Smith, J.; Doe, A.' });
    assert.deepEqual(out.authors, [
      { first_name: 'J.', last_name: 'Smith' },
      { first_name: 'A.', last_name: 'Doe' },
    ]);
  });

  test('single string "A; B; C" splits into three people', () => {
    const out = callFormat({ authors: 'Ada Lovelace; Grace Hopper; Claude Shannon' });
    assert.deepEqual(out.authors, [
      { first_name: 'Ada', last_name: 'Lovelace' },
      { first_name: 'Grace', last_name: 'Hopper' },
      { first_name: 'Claude', last_name: 'Shannon' },
    ]);
  });

  test('"Lastname Only" produces a last_name with no first_name', () => {
    const out = callFormat({ authors: 'Plato' });
    assert.deepEqual(out.authors, [{ last_name: 'Plato' }]);
  });

  test('mix of strings and objects in the same array is allowed', () => {
    const out = callFormat({
      authors: [{ first_name: 'Ada', last_name: 'Lovelace' }, 'Grace Hopper'],
    });
    assert.deepEqual(out.authors, [
      { first_name: 'Ada', last_name: 'Lovelace' },
      { first_name: 'Grace', last_name: 'Hopper' },
    ]);
  });

  test('editors field is parsed the same way', () => {
    const out = callFormat({ editors: 'Smith, J.' });
    assert.deepEqual(out.editors, [{ first_name: 'J.', last_name: 'Smith' }]);
  });

  test('empty authors array passes through', () => {
    const out = callFormat({ authors: [] });
    assert.deepEqual(out.authors, []);
  });

  test('undefined / null authors is left alone (no field)', () => {
    assert.equal(callFormat({}).authors, undefined);
    assert.equal(callFormat({ authors: null }).authors, null);
  });

  test('a number entry throws an actionable MendeleyException (#104)', () => {
    assert.throws(
      () => callFormat({ authors: [42] }),
      (err) => {
        assert.ok(err instanceof MendeleyException);
        assert.match(err.message, /authors/);
        assert.match(err.message, /strings or objects/);
        return true;
      },
    );
  });

  test('a non-object non-string (e.g. boolean) entry throws (#104)', () => {
    assert.throws(
      () => callFormat({ authors: [true] }),
      (err) => {
        assert.ok(err instanceof MendeleyException);
        assert.match(err.message, /authors/);
        return true;
      },
    );
  });

  test('an empty string entry throws an actionable error', () => {
    assert.throws(
      () => callFormat({ authors: [''] }),
      (err) => {
        assert.ok(err instanceof MendeleyException);
        assert.match(err.message, /empty/);
        return true;
      },
    );
  });
});

// ---- CLI help text (#104) -----------------------------------------

function createEnv() {
  const root = mkdtempSync(join(tmpdir(), 'mendeley-doc-create-'));
  const home = join(root, 'home');
  mkdirSync(join(home, '.mendeley'), { recursive: true });
  const configFile = join(root, 'credentials.json');
  writeFileSync(
    configFile,
    JSON.stringify({
      clientId: 'CLIENT_ID',
      redirectUri: 'http://localhost:11595',
      host: 'http://127.0.0.1:1',
    }),
  );
  const tokenFile = join(root, 'token.json');
  writeFileSync(
    tokenFile,
    JSON.stringify({ access_token: 'A', refresh_token: 'R', expires_in: 3600 }),
  );
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    MENDELEY_CONFIG: configFile,
    MENDELEY_TOKEN_FILE: tokenFile,
  };
  delete env.MENDELEY_CLIENT_ID;
  delete env.MENDELEY_CLIENT_SECRET;
  delete env.MENDELEY_ACCESS_TOKEN;
  delete env.MENDELEY_REFRESH_TOKEN;
  return env;
}

function runCli(args, { env, timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`CLI timed out: ${args.join(' ')}`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end();
  });
}

test('documents create --help documents the authors schema (#104)', async () => {
  const env = createEnv();
  const result = await runCli(['documents', 'create', '--help'], { env });
  const output = result.stdout + result.stderr;
  assert.match(output, /authors/);
  assert.match(output, /first_name/);
  assert.match(output, /last_name/);
  // Should also have a string-syntax example.
  assert.match(output, /Surname, Name/);
});

test('documents create --help documents the identifiers field', async () => {
  const env = createEnv();
  const result = await runCli(['documents', 'create', '--help'], { env });
  const output = result.stdout + result.stderr;
  assert.match(output, /identifiers/);
});

test('documents create --help mentions tags', async () => {
  const env = createEnv();
  const result = await runCli(['documents', 'create', '--help'], { env });
  const output = result.stdout + result.stderr;
  assert.match(output, /tags/);
});
