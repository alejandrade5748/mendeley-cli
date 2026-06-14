/**
 * Tests for issue #128: Document models omit many documented fields.
 *
 * The public Mendeley API reference documents "Additional document
 * attributes" and a "patent" view, but the model field lists omitted
 * most of them. Because ResponseObject.toJSON() emits only declared
 * fields, these values were silently dropped from CLI JSON output,
 * library exports, and catalog-to-library copy flows.
 *
 * Now (#128): the field lists match the documented attributes from
 * dev.mendeley.com/methods/#documents.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  UserAllDocument,
  UserBibDocument,
  UserDocument,
  UserPatentDocument,
  TrashPatentDocument,
} from '../../src/models/documents.js';

const FULL_DOC = {
  id: 'd1',
  title: 'A Paper',
  type: 'journal',
  source: 'Nature',
  year: 2024,
  authors: [{ first_name: 'Jane', last_name: 'Doe' }],
  identifiers: { doi: ['10.1/abc'] },
  keywords: ['ml'],
  abstract: '...',
  created: '2024-01-01T00:00:00.000Z',
  last_modified: '2024-02-01T00:00:00.000Z',
  profile_id: 'p1',
  group_id: 'g1',
  // bib fields
  pages: '1-10',
  volume: '5',
  issue: '2',
  websites: ['https://example.com'],
  month: 3,
  publisher: 'Pub',
  day: 15,
  city: 'City',
  edition: ['1st'],
  institution: 'Inst',
  series: 'S',
  chapter: 'C',
  revision: 'r1',
  editors: [{ first_name: 'Ed', last_name: 'Tor' }],
  accessed: '2024-03-01',
  citation_key: 'Doe2024',
  source_type: 'journal',
  language: 'en',
  short_title: 'Paper',
  reprint_edition: 'r2',
  genre: 'article',
  country: 'US',
  translators: [{ first_name: 'Tr', last_name: 'Ans' }],
  series_editor: 'SE',
  code: 'C123',
  medium: 'print',
  user_context: 'ctx',
  department: 'Dept',
  // client fields
  read: false,
  starred: true,
  authored: false,
  confirmed: true,
  hidden: false,
  file_attached: true,
  // tags
  tags: ['ai'],
  // patent
  patent_owner: 'Owner Inc',
  patent_application_number: 'APP-123',
  patent_legal_status: 'granted',
};

test('BASE_FIELDS includes profile_id, group_id, last_modified (#128)', () => {
  const d = new UserDocument({}, { ...FULL_DOC });
  const json = d.toJSON();
  assert.equal(json.profile_id, 'p1');
  assert.equal(json.group_id, 'g1');
  assert.equal(json.last_modified, '2024-02-01T00:00:00.000Z');
});

test('bib view exposes previously-missing bibliographic fields (#128)', () => {
  const d = new UserBibDocument({}, { ...FULL_DOC });
  const json = d.toJSON();
  for (const f of [
    'editors',
    'accessed',
    'citation_key',
    'source_type',
    'language',
    'short_title',
    'reprint_edition',
    'genre',
    'country',
    'translators',
    'series_editor',
    'code',
    'medium',
    'user_context',
    'department',
  ]) {
    assert.ok(f in json, `bib view must expose ${f}`);
  }
  assert.equal(json.citation_key, 'Doe2024');
  assert.equal(json.language, 'en');
  assert.equal(json.country, 'US');
  assert.ok(Array.isArray(json.editors));
  assert.ok(Array.isArray(json.translators));
});

test('all view exposes every documented field (#128)', () => {
  const d = new UserAllDocument({}, { ...FULL_DOC });
  const json = d.toJSON();
  // spot-check one field from each view group
  assert.equal(json.citation_key, 'Doe2024'); // bib
  assert.equal(json.starred, true); // client
  assert.deepEqual(json.tags, ['ai']); // tags
  assert.equal(json.patent_owner, 'Owner Inc'); // patent
  assert.equal(json.last_modified, '2024-02-01T00:00:00.000Z'); // core
});

test('patent view exposes patent fields (#128)', () => {
  const d = new UserPatentDocument({}, { ...FULL_DOC });
  const json = d.toJSON();
  assert.equal(json.patent_owner, 'Owner Inc');
  assert.equal(json.patent_application_number, 'APP-123');
  assert.equal(json.patent_legal_status, 'granted');
  // Core fields still present.
  assert.equal(json.title, 'A Paper');
});

test('trash patent view exposes patent fields (#128)', () => {
  const d = new TrashPatentDocument({}, { ...FULL_DOC });
  const json = d.toJSON();
  assert.equal(json.patent_owner, 'Owner Inc');
  assert.equal(json.patent_application_number, 'APP-123');
});

test('optional bib fields are omitted when absent', () => {
  const d = new UserBibDocument(
    {},
    {
      id: 'd',
      title: 'T',
      type: 'journal',
    },
  );
  const json = d.toJSON();
  assert.equal(json.citation_key, undefined);
  assert.equal(json.language, undefined);
  assert.equal(json.country, undefined);
});

test('editors serialised as raw {first_name, last_name} objects', () => {
  const d = new UserBibDocument({}, { ...FULL_DOC });
  const json = d.toJSON();
  assert.deepEqual(json.editors, [{ first_name: 'Ed', last_name: 'Tor' }]);
});

test('translators serialised as raw {first_name, last_name} objects', () => {
  const d = new UserBibDocument({}, { ...FULL_DOC });
  const json = d.toJSON();
  assert.deepEqual(json.translators, [{ first_name: 'Tr', last_name: 'Ans' }]);
});

import { Documents } from '../../src/resources/documents.js';
import { Trash } from '../../src/resources/trash.js';

test('Documents.viewType routes patent -> UserPatentDocument (#128)', () => {
  const docs = new Documents({});
  assert.equal(docs.viewType('patent').name, 'UserPatentDocument');
});

test('Trash.viewType routes patent -> TrashPatentDocument (#128)', () => {
  const trash = new Trash({});
  assert.equal(trash.viewType('patent').name, 'TrashPatentDocument');
});
