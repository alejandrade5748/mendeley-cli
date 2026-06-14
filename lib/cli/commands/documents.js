/**
 * `mendeley documents ...` subcommand.
 *
 * Sub-commands:
 *  - list           list documents in the library
 *  - get            get a single document
 *  - search         full-text search of the user's library
 *  - advanced-search search with individual fields
 *  - create         create a document from JSON metadata
 *  - create-from-file  upload a file as a new document
 *  - update         patch an existing document
 *  - delete         permanently delete a document
 *  - move-to-trash  move a document to the trash
 *  - attach-file    upload a file and attach it to a document
 *  - add-note       add a text annotation to a document
 *  - annotations    list annotations for a document
 *  - files          list files attached to a document
 *  - export-bibtex  export a document as a BibTeX entry
 */

import { readFile } from 'node:fs/promises';

import { buildSession } from '../credentials.js';
import { collect } from '../output.js';

export function register(program) {
  const docs = program
    .command('documents')
    .description('manage documents in your library')
    .longDescription(
      `CRUD over the documents in your Mendeley library.  Each
  document has an id, a title, a type (journal, book, etc.), authors,
  identifiers (DOI, ISBN, PMID, …), and a list of attached files and
  annotations.  Use \`mendeley documents list\` to enumerate,
  \`mendeley documents get <id>\` to inspect, and
  \`mendeley library add-by-doi\` to add a new one from the catalog.`,
    )
    .example('mendeley documents list --limit 10')
    .example('mendeley documents get abcdef12-3456-7890')
    .example('mendeley documents search "neural networks" --all')
    .example('mendeley documents advanced-search --author Hinton --min-year 2015')
    .example('mendeley documents create --title "My new paper" --type journal')
    .example('mendeley documents move-to-trash abcdef12-3456-7890')
    .example('mendeley documents export-bibtex abcdef12-3456-7890 > paper.bib')
    .example('mendeley documents annotations abcdef12-3456-7890')
    .example('mendeley documents files abcdef12-3456-7890');

  docs
    .command('list')
    .description('list documents in the library')
    .longDescription(
      `Returns a single page of documents (default 20, override with
  --limit).  Use --all to traverse every page and emit a single JSON
  array.  For group libraries, pass --group <groupId>.`,
    )
    .option('--limit <n>', 'page size', '20')
    .option('--view <view>', 'view to request (bib, client, tags, all)', 'all')
    .option('--sort <field>', 'sort field (created, last_modified, title)')
    .option('--order <dir>', 'sort direction (asc, desc)')
    .option('--modified-since <iso>')
    .option('--deleted-since <iso>')
    .option('--group <id>', 'list documents in a group')
    .option('--all', 'fetch every page (default: first page only)')
    .example('mendeley documents list --limit 50')
    .example('mendeley documents list --view bib --sort title --order asc')
    .example('mendeley documents list --all --format ids')
    .example('mendeley documents list --group 12345 --limit 100')
    .action(async (_args, flags, out) => {
      const session = await buildSession();
      const docs = session.documents;
      const resource = flags.group ? session.groupDocuments(flags.group) : docs;
      const kwargs = {
        pageSize: parseInt(flags.limit, 10),
        view: flags.view,
        sort: flags.sort,
        order: flags.order,
        modified_since: flags.modifiedSince,
        deleted_since: flags.deletedSince,
      };
      if (flags.all) {
        const all = await resource.all(kwargs);
        out.write(all);
      } else {
        const page = await resource.list(kwargs);
        const items = await page.items;
        out.write({ count: page.count, items });
      }
    });

  docs
    .command('get <id>')
    .description('get a single document by id')
    .longDescription(
      `Fetch full metadata for a single document.  The \`--view\`
  flag controls how much detail is returned; \`bib\` is the smallest
  useful set, \`all\` (default) includes files and annotations.`,
    )
    .option('--view <view>', 'view to request (bib, client, tags, all)', 'all')
    .option('--group <id>', 'get a group document')
    .example('mendeley documents get abcdef12-3456-7890')
    .example('mendeley documents get abcdef12-3456-7890 --view bib')
    .example('mendeley documents get abcdef12-3456-7890 --group 12345')
    .action(async ([id], flags, out) => {
      const session = await buildSession();
      const resource = flags.group ? session.groupDocuments(flags.group) : session.documents;
      const doc = await resource.get(id, { view: flags.view });
      out.write(doc);
    });

  docs
    .command('search <query>')
    .description('full-text search the user library')
    .longDescription(
      `Search the user library using a single free-form query string.
  This is a thin wrapper around \`session.documents.search(query)\`.
  Use \`mendeley catalog search\` to search the global catalog.`,
    )
    .option('--limit <n>', 'page size', '20')
    .option('--view <view>', 'view to request', 'all')
    .option('--all', 'fetch every page')
    .example('mendeley documents search "deep learning"')
    .example('mendeley documents search "transformer" --all --format ids')
    .example('mendeley documents search "evolution" --limit 5')
    .action(async ([query], flags, out) => {
      const session = await buildSession();
      const search = session.documents.search(query, { view: flags.view });
      const kwargs = { pageSize: parseInt(flags.limit, 10) };
      if (flags.all) {
        out.write(await collect(search.iter(kwargs)));
      } else {
        const page = await search.list(kwargs);
        const items = await page.items;
        out.write({ count: page.count, items });
      }
    });

  docs
    .command('advanced-search')
    .description('search individual fields (title, author, source, year, …)')
    .longDescription(
      `Search by individual fields.  All flags are optional; omit
  those you don't need.  The \`--min-year\` and \`--max-year\` flags
  restrict the publication year.`,
    )
    .option('--title <text>')
    .option('--author <text>')
    .option('--source <text>')
    .option('--abstract <text>')
    .option('--min-year <n>', null, undefined, parseInt)
    .option('--max-year <n>', null, undefined, parseInt)
    .option('--view <view>', 'view to request', 'all')
    .option('--limit <n>', 'page size', '20')
    .option('--all', 'fetch every page')
    .example('mendeley documents advanced-search --author Hinton --min-year 2015')
    .example('mendeley documents advanced-search --title "Attention is all" --all')
    .example('mendeley documents advanced-search --source Nature --min-year 2020 --max-year 2023')
    .action(async (_args, flags, out) => {
      const session = await buildSession();
      const search = session.documents.advancedSearch({
        title: flags.title,
        author: flags.author,
        source: flags.source,
        abstract: flags.abstract,
        min_year: flags.minYear,
        max_year: flags.maxYear,
        view: flags.view,
      });
      const kwargs = { pageSize: parseInt(flags.limit, 10) };
      if (flags.all) out.write(await collect(search.iter(kwargs)));
      else {
        const page = await search.list(kwargs);
        const items = await page.items;
        out.write({ count: page.count, items });
      }
    });

  docs
    .command('create')
    .description('create a document from JSON metadata')
    .longDescription(
      `Create a new document in the library.  The body can be supplied
  as inline JSON (--data), a file (--file), or the simple --title/
  --type flags for a minimal record.  All three are merged: --data
  wins for any colliding keys.`,
    )
    .option('--data <json>', 'inline JSON body')
    .option('--file <path>', 'path to a JSON file with the body')
    .option('--title <title>')
    .option('--type <type>', 'document type (e.g. journal, book)')
    .example('mendeley documents create --title "My new paper" --type journal')
    .example('mendeley documents create --data \'{"title":"X","year":2024,"type":"journal"}\'')
    .example('mendeley documents create --file metadata.json')
    .action(async (_args, flags, out) => {
      const session = await buildSession();
      let body = {};
      if (flags.data) body = JSON.parse(flags.data);
      else if (flags.file) body = JSON.parse(await readFile(flags.file, 'utf8'));
      else body = {};
      const { title, type, ...rest } = body;
      const doc = await session.documents.create({
        title: title || flags.title,
        type: type || flags.type,
        ...rest,
      });
      out.write(doc);
    });

  docs
    .command('create-from-file <path>')
    .description('upload a file as a new document')
    .longDescription(
      `Create a new document from a file on disk.  The file's MIME type
  is detected from the extension.  The document title defaults to the
  filename; edit the document afterwards to rename it.`,
    )
    .example('mendeley documents create-from-file ./paper.pdf')
    .example('mendeley documents create-from-file /tmp/notes.docx')
    .action(async ([path], _flags, out) => {
      const session = await buildSession();
      const doc = await session.documents.createFromFile(path);
      out.write(doc);
    });

  docs
    .command('update <id>')
    .description('patch a document with new metadata')
    .longDescription(
      `Update an existing document with a partial body.  Only the
  fields you supply are changed; others are preserved.  Pass the
  body as --data (inline JSON) or --file (path to a JSON file).`,
    )
    .option('--data <json>', 'inline JSON body')
    .option('--file <path>', 'path to a JSON file with the body')
    .example('mendeley documents update abcdef12 --data \'{"title":"New title"}\'')
    .example('mendeley documents update abcdef12 --file patch.json')
    .action(async ([id], flags, out) => {
      const session = await buildSession();
      const body = flags.data
        ? JSON.parse(flags.data)
        : flags.file
          ? JSON.parse(await readFile(flags.file, 'utf8'))
          : {};
      const doc = await session.documents.get(id);
      const updated = await doc.update(body);
      out.write(updated);
    });

  docs
    .command('delete <id>')
    .description('permanently delete a document (irreversible)')
    .longDescription(
      `Remove a document from the library permanently.  This is NOT
  the same as moving to trash — there is no undo.  Prefer
  \`mendeley documents move-to-trash <id>\` if you might want to
  restore the document later.`,
    )
    .example('mendeley documents delete abcdef12-3456-7890')
    .action(async ([id], _flags, out) => {
      const session = await buildSession();
      const doc = await session.documents.get(id);
      await doc.delete();
      out.write({ ok: true, id, deleted: true });
    });

  docs
    .command('move-to-trash <id>')
    .description('move a document to the trash (recoverable via `mendeley trash`)')
    .longDescription(
      `Move a document to the trash, from which it can be restored via
  \`mendeley trash restore <id>\`.  This is the safe way to remove
  a document.`,
    )
    .example('mendeley documents move-to-trash abcdef12-3456-7890')
    .action(async ([id], _flags, out) => {
      const session = await buildSession();
      const doc = await session.documents.get(id);
      const trashed = await doc.moveToTrash();
      out.write(trashed);
    });

  docs
    .command('attach-file <id> <path>')
    .description('upload a file and attach it to a document')
    .longDescription(
      `Upload a file from disk and attach it to the given document.
  The file is uploaded with a multipart form; the path is read
  directly.`,
    )
    .example('mendeley documents attach-file abcdef12 /path/to/supplement.pdf')
    .action(async ([id, path], _flags, out) => {
      const session = await buildSession();
      const doc = await session.documents.get(id);
      const file = await doc.attachFile(path);
      out.write(file);
    });

  docs
    .command('add-note <id> <text>')
    .description('add a text note to a document')
    .longDescription(
      `Create a sticky-note style annotation containing the given
  text.  Returns the new annotation JSON.`,
    )
    .example('mendeley documents add-note abcdef12 "important — read carefully"')
    .action(async ([id, text], _flags, out) => {
      const session = await buildSession();
      const doc = await session.documents.get(id);
      const note = await doc.addNote(text);
      out.write(note);
    });

  docs
    .command('annotations <id>')
    .description('list annotations attached to a document')
    .longDescription(
      `List all annotations (highlights, notes, sticky notes) attached
  to the given document.  Combine with --format ids to get a quick
  list of annotation ids.`,
    )
    .option('--limit <n>', 'page size', '20')
    .option('--all', 'fetch every page')
    .example('mendeley documents annotations abcdef12')
    .example('mendeley documents annotations abcdef12 --all --format ids')
    .action(async ([id], flags, out) => {
      const session = await buildSession();
      const doc = await session.documents.get(id);
      const items = flags.all
        ? await collect(
            session.annotations.iter({ document_id: id, pageSize: parseInt(flags.limit, 10) }),
          )
        : await (async () => {
            const p = await session.annotations.list({
              document_id: id,
              pageSize: parseInt(flags.limit, 10),
            });
            return p.items;
          })();
      out.write(items);
    });

  docs
    .command('files <id>')
    .description('list files attached to a document')
    .longDescription(
      `Return the metadata of all files attached to the given document.
  Use \`mendeley files get <fileId>\` or \`mendeley files download\`
  to retrieve the actual contents.`,
    )
    .option('--all', 'fetch every page')
    .example('mendeley documents files abcdef12')
    .example('mendeley documents files abcdef12 --all --format ids')
    .action(async ([id], flags, out) => {
      const session = await buildSession();
      const files = session.documentFiles(id);
      if (flags.all) {
        out.write(await collect(files.iter()));
      } else {
        const page = await files.list();
        const items = await page.items;
        out.write({ count: page.count, items });
      }
    });

  docs
    .command('export-bibtex <id>')
    .description('export a document as a BibTeX entry (printed to stdout)')
    .longDescription(
      `Convert a document's \`bib\` view to a single BibTeX entry.
  Suitable for appending to a .bib file:
    mendeley documents export-bibtex <id> >> library.bib`,
    )
    .example('mendeley documents export-bibtex abcdef12')
    .example('mendeley documents export-bibtex abcdef12 >> refs.bib')
    .action(async ([id], _flags, out) => {
      const session = await buildSession();
      const doc = await session.documents.get(id, { view: 'bib' });
      out.write(toBibtex(doc));
    });
}

/** Convert a `bib`-view document to a BibTeX entry. */
function toBibtex(doc) {
  const type = bibType(doc.type);
  const fields = {
    title: doc.title,
    author: (doc.authors || []).map((a) => `${a.first_name} ${a.last_name}`).join(' and '),
    year: doc.year,
    source: doc.source,
    publisher: doc.publisher,
    volume: doc.volume,
    issue: doc.issue,
    pages: doc.pages,
    doi: doc.identifiers && doc.identifiers.doi,
    isbn: doc.identifiers && doc.identifiers.isbn,
    issn: doc.identifiers && doc.identifiers.issn,
    arxiv: doc.identifiers && doc.identifiers.arxiv,
    pmid: doc.identifiers && doc.identifiers.pmid,
    keywords: Array.isArray(doc.keywords) ? doc.keywords.join(', ') : doc.keywords,
    abstract: doc.abstract,
  };
  const citeKey = buildCiteKey(doc);
  const lines = [`@${type}{${citeKey},`];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || v === '') continue;
    lines.push(`  ${k} = {${escape(v)}},`);
  }
  lines.push('}');
  return lines.join('\n');
}

function bibType(t) {
  return (
    {
      journal: 'article',
      book: 'book',
      book_section: 'incollection',
      conference_proceedings: 'inproceedings',
      working_paper: 'misc',
      report: 'techreport',
      encyclopedia_article: 'inreference',
      generic: 'misc',
    }[t] || 'misc'
  );
}

function buildCiteKey(doc) {
  const author = (doc.authors && doc.authors[0] && doc.authors[0].last_name) || 'anon';
  const year = doc.year || 'nd';
  const title = (doc.title || 'untitled').split(/\s+/)[0].toLowerCase();
  return `${author.replace(/\W+/g, '')}_${year}_${title}`.replace(/[^A-Za-z0-9_]/g, '');
}

function escape(v) {
  return String(v).replace(/[{}]/g, '');
}
