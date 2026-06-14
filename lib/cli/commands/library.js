/**
 * `mendeley library ...` subcommand.
 *
 * Higher-level commands that combine multiple API calls.  These are
 * particularly useful for AI agents that want to perform common
 * library-management tasks (e.g. "export my whole library as BibTeX",
 * "deduplicate by DOI", "move all PDFs from author X into a folder").
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { buildSession } from '../credentials.js';
import { collect, parseLimit } from '../output.js';
import { toBibtex } from './bibtex.js';

/**
 * Write a file, auto-creating parent directories (#13).
 */
async function writeFileMkdirP(path, content, encoding = 'utf8') {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, encoding);
}

export function register(program) {
  const cmd = program
    .command('library')
    .description('high-level library operations (export, dedupe, stats, bulk-add)')
    .longDescription(
      `These commands combine multiple lower-level API calls into
  common workflows.  All commands respect the --format flag and
  produce either JSON or human-readable output.`,
    )
    .example('mendeley library export-bibtex --out refs.bib')
    .example('mendeley library export-json --out library.json --view client')
    .example('mendeley library dedupe --by doi')
    .example('mendeley library stats')
    .example('mendeley library recent --limit 5')
    .example('mendeley library by-tag machine-learning')
    .example('mendeley library add-by-doi 10.1038/nature12373 --folder <folderId>');

  cmd
    .command('export-bibtex')
    .description('export the whole library to a BibTeX .bib file (or stdout)')
    .longDescription(
      `Walks the entire user library, requests each document with
  view=bib, and emits a single BibTeX string.  Suitable for use as a
  .bib file:
    mendeley library export-bibtex --out refs.bib
    mendeley library export-bibtex | wc -l  # quick count`,
    )
    .option('--out <path>', 'output file (default: stdout)')
    .option('--limit <n>', 'page size', '50')
    .example('mendeley library export-bibtex --out refs.bib')
    .example('mendeley library export-bibtex | head -50')
    .action(async (_args, flags, out) => {
      const session = await buildSession();
      const docs = await collect(
        session.documents.iter({
          view: 'bib',
          pageSize: parseLimit(flags.limit),
        }),
      );
      const bib = docs.map(toBibtex).join('\n\n') + '\n';
      if (flags.out) {
        await writeFileMkdirP(flags.out, bib, 'utf8');
        out.write({ ok: true, count: docs.length, path: flags.out });
      } else {
        process.stdout.write(bib);
      }
    });

  cmd
    .command('export-json')
    .description('export the whole library to a JSON file (default view=all)')
    .longDescription(
      `Like \`mendeley library export-bibtex\` but produces JSON.
  Useful for backups or further processing.  Pass --view bib/client/
  tags/all to control how much metadata is included.`,
    )
    .option('--out <path>', 'output file (default: stdout)')
    .option('--view <view>', 'view to request', 'all')
    .option('--limit <n>', 'page size', '50')
    .example('mendeley library export-json --out library.json')
    .example('mendeley library export-json --view client')
    .action(async (_args, flags, out) => {
      const session = await buildSession();
      const docs = await collect(
        session.documents.iter({
          view: flags.view,
          pageSize: parseLimit(flags.limit),
        }),
      );
      const json = JSON.stringify(
        docs.map((d) => d.toJSON()),
        null,
        2,
      );
      if (flags.out) {
        await writeFileMkdirP(flags.out, json, 'utf8');
        out.write({ ok: true, count: docs.length, path: flags.out });
      } else {
        process.stdout.write(json + '\n');
      }
    });

  cmd
    .command('dedupe')
    .description('find documents that look like duplicates (by DOI, title, or both)')
    .longDescription(
      `Scans the entire user library and reports groups of documents
  that look like duplicates.  \`--by doi\` is the strictest; \`--by
  title\` is fuzzier; \`--by doi-or-title\` (default) falls back to
  the title when no DOI is present.`,
    )
    .option('--by <field>', 'field to dedupe by: doi, title, doi-or-title', 'doi-or-title')
    .example('mendeley library dedupe')
    .example('mendeley library dedupe --by doi')
    .action(async (_args, flags, out) => {
      const validBy = new Set(['doi', 'title', 'doi-or-title']);
      if (!validBy.has(flags.by)) {
        out.fail(`--by must be one of: doi, title, doi-or-title (got ${JSON.stringify(flags.by)})`);
        return;
      }
      const session = await buildSession();
      const docs = await collect(session.documents.iter({ view: 'client' }));
      const seen = new Map();
      const dupes = [];
      for (const d of docs) {
        const key = keyFor(d, flags.by);
        if (!key) continue;
        if (seen.has(key)) {
          dupes.push({ key, keep: seen.get(key), dup: d.id });
        } else {
          seen.set(key, d.id);
        }
      }
      out.write({ duplicates: dupes, scanned: docs.length, unique: seen.size });
    });

  cmd
    .command('by-tag <tag>')
    .description('list documents that have a particular tag')
    .longDescription(
      `Filter the library to documents that have the given tag.  Tags
  are case-sensitive.`,
    )
    .example('mendeley library by-tag machine-learning')
    .example('mendeley library by-tag to-read --format ids')
    .action(async ([tag], _flags, out) => {
      const session = await buildSession();
      const docs = await collect(session.documents.iter({ view: 'tags' }));
      const matches = docs.filter((d) => Array.isArray(d.tags) && d.tags.includes(tag));
      out.write(matches);
    });

  cmd
    .command('recent')
    .description('list the most-recently-added documents (sorted by created date)')
    .longDescription(
      `Sort by \`created\` descending and return the first N
  documents.  Defaults to 10.`,
    )
    .option('--limit <n>', 'maximum number of documents', '10')
    .example('mendeley library recent --limit 5')
    .example('mendeley library recent --format ids')
    .action(async (_args, flags, out) => {
      const session = await buildSession();
      const docs = await collect(
        session.documents.iter({
          view: 'client',
          sort: 'created',
          order: 'desc',
          pageSize: 50,
        }),
      );
      const recent = docs.slice(0, parseLimit(flags.limit));
      out.writeList(recent);
    });

  cmd
    .command('stats')
    .description('print summary statistics about the library')
    .longDescription(
      `Returns:
    • total       — total document count
    • byType      — { type: count } for every document type
    • byYear      — { year: count } for every publication year
    • topTags     — the 20 most-common tags, with counts

  Scans the entire library.  For very large libraries this can be
  slow; consider --limit to sample.`,
    )
    .option('--limit <n>', 'maximum number of documents to scan', undefined)
    .example('mendeley library stats')
    .example('mendeley library stats | jq .byType')
    .action(async (_args, flags, out) => {
      const session = await buildSession();
      // Use `view: 'tags'` so we get the `tags` array (the `client`
      // view doesn't include it).  The `tags` view still includes
      // `type` and `year` so we can compute every stat in one pass.
      const kwargs = { view: 'tags', pageSize: 50 };
      if (flags.limit) kwargs.pageSize = parseLimit(flags.limit);
      const docs = await collect(session.documents.iter(kwargs));
      const byType = {};
      const byYear = {};
      const tagCount = {};
      let total = 0;
      for (const d of docs) {
        total += 1;
        byType[d.type] = (byType[d.type] || 0) + 1;
        if (d.year) byYear[d.year] = (byYear[d.year] || 0) + 1;
        for (const t of d.tags || []) tagCount[t] = (tagCount[t] || 0) + 1;
      }
      out.write({ total, byType, byYear, topTags: topN(tagCount, 20) });
    });

  cmd
    .command('add-by-doi <doi>')
    .description('look up a DOI in the catalog and add the document to the library')
    .longDescription(
      `Resolves a DOI to a catalog entry, then creates a new
  document in the user library with the same metadata.  Optionally
  places the new document into a folder (--folder).`,
    )
    .option('--folder <id>', 'put the new document into a folder')
    .example('mendeley library add-by-doi 10.1038/nature12373')
    .example('mendeley library add-by-doi 10.1038/nature12373 --folder abcdef12')
    .action(async ([doi], flags, out) => {
      const session = await buildSession();
      const catalog = await session.catalog.byIdentifier({ doi, view: 'all' });
      // Strip the `id` field and add the document.
      const { id, ...metadata } = catalog.toJSON();
      const created = await session.documents.create(metadata);
      if (flags.folder) {
        await session.folderDocuments(flags.folder).add(created.id);
      }
      out.write(created);
    });

  cmd
    .command('add-by-arxiv <arxivId>')
    .description('look up an arXiv ID in the catalog and add the document to the library')
    .longDescription(`Like \`add-by-doi\` but uses an arXiv identifier.`)
    .option('--folder <id>', 'put the new document into a folder')
    .example('mendeley library add-by-arxiv 1706.03762')
    .example('mendeley library add-by-arxiv 1706.03762 --folder abcdef12')
    .action(async ([arxivId], flags, out) => {
      const session = await buildSession();
      const catalog = await session.catalog.byIdentifier({ arxiv: arxivId, view: 'all' });
      const { id, ...metadata } = catalog.toJSON();
      const created = await session.documents.create(metadata);
      if (flags.folder) {
        await session.folderDocuments(flags.folder).add(created.id);
      }
      out.write(created);
    });
}

function keyFor(doc, mode) {
  if (mode === 'doi') return doc.identifiers && doc.identifiers.doi;
  if (mode === 'title') return (doc.title || '').toLowerCase().trim();
  if (mode === 'doi-or-title') {
    const doi = doc.identifiers && doc.identifiers.doi;
    if (doi) return `doi:${doi}`;
    return `title:${(doc.title || '').toLowerCase().trim()}`;
  }
  return null;
}

function topN(map, n) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => ({ tag: k, count: v }));
}
