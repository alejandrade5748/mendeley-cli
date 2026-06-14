/**
 * `mendeley files ...` subcommand.
 *
 * Manage files attached to documents in the user library, in a
 * group, or in the catalog.  Files are identified by UUIDs.  Use
 * `mendeley documents files <docId>` to list files attached to a
 * single document.
 */

import { buildSession } from '../credentials.js';
import { collect, parseLimit, parseJson } from '../output.js';

export function register(program) {
  const cmd = program
    .command('files')
    .description('manage files (PDFs, images, supplementary materials)')
    .longDescription(
      `Files are the binary blobs (typically PDFs) attached to
  documents.  Each file has an id, a content type, a hash, and a
  parent document id.  Use \`mendeley files download <id> <dir>\` to
  fetch the bytes to disk, and \`mendeley files add-highlight\` /
  \`mendeley files add-sticky-note\` to annotate.`,
    )
    .example('mendeley files list --limit 20')
    .example('mendeley files list --document <docId> --all')
    .example('mendeley files download <fileId> /tmp/papers')
    .example(
      'mendeley files add-highlight <fileId> --positions \'[{"page":1,...}]\' --color \'{"r":255,"g":255,"b":0}\'',
    );

  cmd
    .command('list')
    .description('list files (optionally scoped to a document/group/catalog)')
    .longDescription(
      `By default, lists files across the entire user library.  Use
  --document/--group/--catalog to scope to a specific parent.`,
    )
    .option('--document <id>', 'list files attached to a document')
    .option('--group <id>', 'list files in a group')
    .option('--catalog <id>', 'list files for a catalog document')
    .option('--added-since <iso>')
    .option('--deleted-since <iso>')
    .option('--limit <n>', 'page size', '20')
    .option('--all', 'fetch every page')
    .example('mendeley files list --limit 20')
    .example('mendeley files list --document abcdef12 --all')
    .example('mendeley files list --group 12345 --limit 50')
    .example('mendeley files list --format ids --all')
    .action(async (_args, flags, out) => {
      const session = await buildSession();
      let files = session.files;
      if (flags.document) files = session.documentFiles(flags.document);
      else if (flags.group) files = session.groupFiles(flags.group);
      else if (flags.catalog) files = session.catalogFiles(flags.catalog);
      const kwargs = {
        pageSize: parseLimit(flags.limit),
        added_since: flags.addedSince,
        deleted_since: flags.deletedSince,
      };
      if (flags.all) {
        const items = await collect(files.iter(kwargs));
        out.writeList(items);
      } else {
        const page = await files.list(kwargs);
        const items = await page.items;
        out.write({ count: page.count, items });
      }
    });

  cmd
    .command('get <id>')
    .description('get a file by id (metadata only)')
    .longDescription(
      `Return the metadata record for a file: id, file name, MIME
  type, size, hash, and parent document.  This does not download
  the file content; use \`mendeley files download\` for that.`,
    )
    .example('mendeley files get abcdef12-3456-7890')
    .action(async ([id], _flags, out) => {
      const session = await buildSession();
      const file = await findFileById(session, id);
      if (!file) {
        out.fail(
          `File not found in the user library: ${id}. If the file is in a ` +
            'group or the catalog, or on a later page of a large library, ' +
            'list files with `mendeley files list` to confirm the id.',
        );
        return;
      }
      out.write(file);
    });

  cmd
    .command('download <id> <directory>')
    .description('download a file to a directory; returns the path')
    .longDescription(
      `Stream the file's bytes to \`<directory>/<fileId>\`.  Useful
  for batch-downloading PDFs:
    mendeley files list --format ids --all | xargs -I{} mendeley files download {} /tmp/papers`,
    )
    .option('--filename <name>', 'use a custom filename (default: <id>)')
    .example('mendeley files download abcdef12 /tmp/papers')
    .example('mendeley files download abcdef12 /tmp/papers --filename paper.pdf')
    .action(async ([id, directory], flags, out) => {
      const session = await buildSession();
      const rsp = await session.get(`/files/${id}`, { stream: true });
      const { streamToFile } = await import('../file_helper.js');
      const file = await streamToFile(rsp, directory, flags.filename || id);
      out.write({ ok: true, id, path: file });
    });

  cmd
    .command('delete <id>')
    .description('delete a file (irreversible)')
    .longDescription(
      `Delete a file from the library.  The parent document is left
  intact.`,
    )
    .example('mendeley files delete abcdef12-3456-7890')
    .action(async ([id], _flags, out) => {
      const session = await buildSession();
      await session.delete(`/files/${id}`);
      out.write({ ok: true, id, deleted: true });
    });

  cmd
    .command('add-sticky-note <fileId>')
    .description('add a sticky note to a file')
    .longDescription(
      `Create a sticky-note annotation at the given (x, y) coordinates
  on a given page.  Coordinates are in points (PDF user space).`,
    )
    .option('--text <text>')
    .option('--xpos <n>', 'x coordinate (points)', undefined, parseFloat)
    .option('--ypos <n>', 'y coordinate (points)', undefined, parseFloat)
    .option('--page <n>', null, undefined, parseInt)
    .example(
      'mendeley files add-sticky-note <fileId> --text "Check this" --xpos 100 --ypos 200 --page 1',
    )
    .action(async ([fileId], flags, out) => {
      const session = await buildSession();
      const file = await findFileById(session, fileId);
      if (!file) {
        out.fail(`File not found in the user library: ${fileId}.`);
        return;
      }
      const ann = await file.addStickyNote(flags.text, flags.xpos, flags.ypos, flags.page);
      out.write(ann);
    });

  cmd
    .command('add-highlight <fileId>')
    .description('add a highlight to a file')
    .longDescription(
      `Create a highlight annotation spanning one or more bounding
  boxes.  The \`--positions\` flag takes a JSON array of objects with
  \`top_left\`, \`bottom_right\`, and \`page\` keys.  The \`--color\` flag
  takes a JSON object with \`r\`, \`g\`, \`b\` integers in [0,255].`,
    )
    .option('--positions <json>', 'JSON array of bounding boxes')
    .option('--color <json>', 'JSON object {r,g,b}')
    .example(
      'mendeley files add-highlight <fileId> --positions \'[{"top_left":{"x":50,"y":100},"bottom_right":{"x":500,"y":120},"page":1}]\'',
    )
    .example(
      'mendeley files add-highlight <fileId> --positions \'[...]\' --color \'{"r":255,"g":255,"b":0}\'',
    )
    .action(async ([fileId], flags, out) => {
      const session = await buildSession();
      const file = await findFileById(session, fileId);
      if (!file) {
        out.fail(`File not found in the user library: ${fileId}.`);
        return;
      }
      const { BoundingBox, Color } = await import('../../../src/models/common.js');
      const positions = parseJson(flags.positions || '[]', '--positions').map((p) =>
        p instanceof BoundingBox ? p : BoundingBox.create(p.top_left, p.bottom_right, p.page),
      );
      const color =
        typeof flags.color === 'string' ? parseJson(flags.color, '--color') : flags.color;
      const colorObj =
        color && color.r !== undefined ? Color.create(color.r, color.g, color.b) : color;
      const ann = await file.addHighlight(positions, colorObj);
      out.write(ann);
    });
}

/**
 * Look up a single file's metadata by id in the user library.
 *
 * `GET /files/{id}` on the Mendeley API returns a 302 redirect to the
 * binary download URL (see `File.getDownloadUrl`), not the metadata
 * JSON, so we can't fetch a single file directly. List the user
 * library's files and pick the matching id.
 *
 * Returns the `File` model instance, or `null` if no file in the
 * (first page of the) user library matches.
 */
async function findFileById(session, fileId) {
  const page = await session.files.list();
  const items = await page.items;
  return items.find((f) => f.id === fileId) || null;
}
