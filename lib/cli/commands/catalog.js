/**
 * `mendeley catalog ...` subcommand.
 *
 * The Mendeley catalog is the global index of academic papers, books,
 * and other documents.  It includes ~100M records with rich metadata
 * (DOI, arXiv, PMID, ISSN, ISBN, …) and aggregated reader counts.
 *
 * Useful for AI agents that need to look up bibliographic metadata
 * (DOI, arXiv ID, etc.) and pull reader statistics.
 */

import { buildSession } from '../credentials.js';
import { collect } from '../output.js';

export function register(program) {
  const cmd = program
    .command('catalog')
    .description('browse the Mendeley global catalog (~100M papers, books, …)')
    .longDescription(
      `The catalog is the public, global index of papers and books
  in Mendeley.  Use \`mendeley catalog search <query>\` for free-text
  search, \`mendeley catalog by-doi <doi>\` to look up a specific
  paper, and \`mendeley catalog lookup\` for fuzzy lookups by
  metadata.  A typical workflow is to search, then add the result to
  the user library with \`mendeley library add-by-doi\`.`,
    )
    .example('mendeley catalog search "machine learning" --limit 5')
    .example('mendeley catalog by-doi 10.1038/nature12373')
    .example('mendeley catalog lookup --title "Attention is all you need" --authors Vaswani')
    .example('mendeley catalog advanced-search --author Hinton --min-year 2017 --all');

  cmd
    .command('get <id>')
    .description('get a catalog document by id')
    .longDescription(
      `Fetch a single catalog document by its UUID.  Use
  \`mendeley catalog by-doi <doi>\` to look up by DOI instead.`,
    )
    .option('--view <view>', 'view to request (bib, client, stats, all)', 'all')
    .example('mendeley catalog get abcdef12-3456-7890')
    .example('mendeley catalog get abcdef12 --view bib')
    .action(async ([id], flags, out) => {
      const session = await buildSession();
      const doc = await session.catalog.get(id, { view: flags.view });
      out.write(doc);
    });

  cmd
    .command('by-doi <doi>')
    .description('look up a catalog document by DOI')
    .longDescription(
      `Resolve a DOI (e.g. \`10.1038/nature12373\`) to a catalog
  document.  Returns the full record, including all identifiers,
  authors, source, and abstract.`,
    )
    .option('--view <view>', 'view to request', 'all')
    .example('mendeley catalog by-doi 10.1038/nature12373')
    .example('mendeley catalog by-doi 10.1371/journal.pmed.0020124 --view bib')
    .action(async ([doi], flags, out) => {
      const session = await buildSession();
      const doc = await session.catalog.byIdentifier({ doi, view: flags.view });
      out.write(doc);
    });

  cmd
    .command('by-identifier')
    .description('look up by any identifier (DOI, arXiv, ISBN, ISSN, PMID, Scopus, filehash)')
    .longDescription(
      `Resolve any of the supported identifier types to a catalog
  document.  Pass exactly one of the --doi/--arxiv/--isbn/--issn/
  --pmid/--scopus/--filehash flags.`,
    )
    .option('--doi <id>')
    .option('--arxiv <id>')
    .option('--isbn <id>')
    .option('--issn <id>')
    .option('--pmid <id>')
    .option('--scopus <id>')
    .option('--filehash <hash>')
    .option('--view <view>', 'view to request', 'all')
    .example('mendeley catalog by-identifier --doi 10.1038/nature12373')
    .example('mendeley catalog by-identifier --arxiv 1706.03762')
    .example('mendeley catalog by-identifier --pmid 25635392')
    .action(async (_args, flags, out) => {
      const session = await buildSession();
      const doc = await session.catalog.byIdentifier({
        doi: flags.doi,
        arxiv: flags.arxiv,
        isbn: flags.isbn,
        issn: flags.issn,
        pmid: flags.pmid,
        scopus: flags.scopus,
        filehash: flags.filehash,
        view: flags.view,
      });
      out.write(doc);
    });

  cmd
    .command('lookup')
    .description('fuzzy lookup by free-text metadata (returns a score and best match)')
    .longDescription(
      `Useful when you have only partial metadata: a partial DOI, a
  title, an author surname, and a year.  Returns the best-matching
  catalog document and a confidence score between 0 and 1.`,
    )
    .option('--doi <id>')
    .option('--arxiv <id>')
    .option('--pmid <id>')
    .option('--filehash <hash>')
    .option('--title <text>')
    .option('--authors <text>')
    .option('--year <n>')
    .option('--source <text>')
    .option('--view <view>', 'view to request', 'all')
    .example('mendeley catalog lookup --doi "10.1038/nature*"')
    .example(
      'mendeley catalog lookup --title "Attention is all you need" --authors Vaswani --year 2017',
    )
    .action(async (_args, flags, out) => {
      const session = await buildSession();
      const result = await session.catalog.lookup({
        doi: flags.doi,
        arxiv: flags.arxiv,
        pmid: flags.pmid,
        filehash: flags.filehash,
        title: flags.title,
        authors: flags.authors,
        year: flags.year,
        source: flags.source,
        view: flags.view,
      });
      const loaded = await result._load();
      out.write({ score: result.score, catalog_id: result.id, document: loaded });
    });

  cmd
    .command('search <query>')
    .description('search the catalog by free-text query')
    .longDescription(
      `Search across the global catalog.  Returns a single page of
  matches; use --all to traverse every page.  Combine with
  --format ids to extract just the catalog ids.`,
    )
    .option('--view <view>', 'view to request', 'all')
    .option('--limit <n>', 'page size', '20')
    .option('--all', 'fetch every page')
    .example('mendeley catalog search "machine learning" --limit 5')
    .example('mendeley catalog search "CRISPR" --all --format ids')
    .example('mendeley catalog search "transformer" --view bib')
    .action(async ([query], flags, out) => {
      const session = await buildSession();
      const search = session.catalog.search(query, { view: flags.view });
      const kwargs = { pageSize: parseInt(flags.limit, 10) };
      if (flags.all) {
        out.write(await collect(search.iter(kwargs)));
      } else {
        const page = await search.list(kwargs);
        const items = await page.items;
        out.write({ count: page.count, items });
      }
    });

  cmd
    .command('advanced-search')
    .description('search the catalog with individual fields')
    .longDescription(
      `Same shape as \`mendeley documents advanced-search\` but
  scoped to the global catalog.  Supports --open-access filtering.`,
    )
    .option('--title <text>')
    .option('--author <text>')
    .option('--source <text>')
    .option('--abstract <text>')
    .option('--min-year <n>')
    .option('--max-year <n>')
    .option('--open-access <bool>')
    .option('--view <view>', 'view to request', 'all')
    .option('--limit <n>', 'page size', '20')
    .option('--all', 'fetch every page')
    .example('mendeley catalog advanced-search --author Hinton --min-year 2017 --all')
    .example('mendeley catalog advanced-search --source Nature --open-access true')
    .action(async (_args, flags, out) => {
      const session = await buildSession();
      const search = session.catalog.advancedSearch({
        title: flags.title,
        author: flags.author,
        source: flags.source,
        abstract: flags.abstract,
        min_year: flags.minYear,
        max_year: flags.maxYear,
        open_access: flags.openAccess,
        view: flags.view,
      });
      const kwargs = { pageSize: parseInt(flags.limit, 10) };
      if (flags.all) {
        out.write(await collect(search.iter(kwargs)));
      } else {
        const page = await search.list(kwargs);
        const items = await page.items;
        out.write({ count: page.count, items });
      }
    });
}
