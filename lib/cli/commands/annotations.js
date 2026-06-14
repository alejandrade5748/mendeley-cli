/**
 * `mendeley annotations ...` subcommand.
 *
 * Annotations are highlights, sticky notes, and free-form notes that
 * users attach to documents (and, more specifically, to specific
 * positions on the PDF inside the document).  Each annotation has a
 * type (highlight, sticky_note, note), a body, and zero or more
 * bounding boxes for highlight regions.
 */

import { readFile } from 'node:fs/promises';

import { buildSession } from '../credentials.js';
import { collect, parseLimit, parseJson } from '../output.js';

export function register(program) {
  const cmd = program
    .command('annotations')
    .description('manage annotations (highlights, sticky notes, notes)')
    .longDescription(
      `Annotations live on documents (or more precisely, on files
  attached to documents).  Use \`mendeley documents annotations
  <docId>\` to list the annotations on a single document.`,
    )
    .example('mendeley annotations list --document <docId> --all')
    .example('mendeley annotations get <annotationId>')
    .example('mendeley annotations update <id> --data \'{"text":"updated"}\'')
    .example('mendeley annotations delete <id>');

  cmd
    .command('list')
    .description('list annotations (optionally scoped to a document)')
    .longDescription(
      `Enumerate annotations, optionally filtered by --document
  <docId>.  Use --all to traverse every page.`,
    )
    .option('--document <id>', 'limit to a specific document')
    .option('--modified-since <iso>')
    .option('--deleted-since <iso>')
    .option('--limit <n>', 'page size', '20')
    .option('--all', 'fetch every page')
    .example('mendeley annotations list --document <docId> --all')
    .example('mendeley annotations list --modified-since 2024-01-01')
    .action(async (_args, flags, out) => {
      const session = await buildSession();
      const kwargs = {
        document_id: flags.document,
        modified_since: flags.modifiedSince,
        deleted_since: flags.deletedSince,
        pageSize: parseLimit(flags.limit),
      };
      if (flags.all) {
        const items = await collect(session.annotations.iter(kwargs));
        out.writeList(items);
      } else {
        const page = await session.annotations.list(kwargs);
        const items = await page.items;
        out.write({ count: page.count, items });
      }
    });

  cmd
    .command('get <id>')
    .description('get a single annotation by id')
    .longDescription(`Return the full annotation record by its UUID.`)
    .example('mendeley annotations get abcdef12-3456-7890')
    .action(async ([id], _flags, out) => {
      const session = await buildSession();
      const ann = await session.annotations.get(id);
      out.write(ann);
    });

  cmd
    .command('update <id>')
    .description('update an annotation (e.g. change its text or color)')
    .longDescription(
      `Patch an annotation with new fields.  Pass --data (inline
  JSON) or --file (path to a JSON file).  Common fields: text, color,
  privacy_level, positions.`,
    )
    .option('--data <json>', 'inline JSON body')
    .option('--file <path>', 'path to a JSON file with the body')
    .example('mendeley annotations update <id> --data \'{"text":"updated text"}\'')
    .example('mendeley annotations update <id> --file patch.json')
    .action(async ([id], flags, out) => {
      const session = await buildSession();
      let body;
      if (flags.data !== undefined && flags.data !== null && flags.data !== '') {
        body = parseJson(flags.data);
      } else if (flags.file) {
        body = parseJson(await readFile(flags.file, 'utf8'), '--file');
      } else {
        out.fail('please supply a body via --data (inline JSON) or --file (path to a JSON file)');
        return;
      }
      const ann = await session.annotations.get(id);
      const updated = await ann.update(body);
      out.write(updated);
    });

  cmd
    .command('delete <id>')
    .description('delete an annotation')
    .longDescription(`Delete an annotation.  This is irreversible.`)
    .example('mendeley annotations delete abcdef12-3456-7890')
    .action(async ([id], _flags, out) => {
      const session = await buildSession();
      const ann = await session.annotations.get(id);
      await ann.delete();
      out.write({ ok: true, id, deleted: true });
    });
}
