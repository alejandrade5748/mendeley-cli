/**
 * Tests for issue #17: response shapes are inconsistent across subcommands.
 *
 * All list commands — with or without --all — must return the standard
 * { count, items } envelope. Before #17, the --all variants returned
 * a bare array, forcing callers to special-case each command.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Output } from '../../lib/cli/output.js';

/* ── Output.writeList produces {count, items} ───────────────────── */

test('Output.writeList produces {count, items} envelope (#17)', () => {
  const out = new Output('json');
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  // Capture stdout
  const original = process.stdout.write.bind(process.stdout);
  let captured = '';
  process.stdout.write = (chunk) => {
    captured += chunk;
    return true;
  };
  try {
    out.writeList(items);
  } finally {
    process.stdout.write = original;
  }
  const body = JSON.parse(captured);
  assert.equal(body.count, 3);
  assert.ok(Array.isArray(body.items));
  assert.equal(body.items.length, 3);
});

test('Output.writeList accepts explicit count override (#17)', () => {
  const out = new Output('json');
  const items = [{ id: 'a' }];
  let captured = '';
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    captured += chunk;
    return true;
  };
  try {
    out.writeList(items, 999);
  } finally {
    process.stdout.write = original;
  }
  const body = JSON.parse(captured);
  assert.equal(body.count, 999, 'should use explicit count, not items.length');
  assert.equal(body.items.length, 1);
});

test('Output.writeList with empty array returns {count: 0, items: []}', () => {
  const out = new Output('json');
  let captured = '';
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    captured += chunk;
    return true;
  };
  try {
    out.writeList([]);
  } finally {
    process.stdout.write = original;
  }
  const body = JSON.parse(captured);
  assert.equal(body.count, 0);
  assert.ok(Array.isArray(body.items));
  assert.equal(body.items.length, 0);
});

/* ── --format ids/tsv/text extract items from the envelope ─────── */

test('formatIds extracts items from {count, items} envelope', () => {
  const out = new Output('ids');
  let captured = '';
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    captured += chunk;
    return true;
  };
  try {
    out.writeList([{ id: 'x' }, { id: 'y' }]);
  } finally {
    process.stdout.write = original;
  }
  assert.equal(captured.trim(), 'x\ny');
});

test('formatTsv extracts items from {count, items} envelope', () => {
  const out = new Output('tsv');
  let captured = '';
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    captured += chunk;
    return true;
  };
  try {
    out.writeList([{ id: 'x', title: 'Foo' }]);
  } finally {
    process.stdout.write = original;
  }
  const lines = captured.trim().split('\n');
  assert.ok(lines.length >= 2); // header + data row
});
