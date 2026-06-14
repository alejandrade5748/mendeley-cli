/**
 * `mendeley trash ...` subcommand.
 *
 * The Mendeley "trash" is a soft-delete bin.  Documents in the
 * trash can be listed, inspected, restored to the user library, or
 * permanently deleted.
 */

import { buildSession } from '../credentials.js';
import { collect } from '../output.js';

export function register(program) {
  const cmd = program
    .command('trash')
    .description('manage the trash (soft-deleted documents)')
    .longDescription(
      `Documents moved to the trash with \`mendeley documents
  move-to-trash\` are recoverable until you empty the trash or
  permanently delete them.  Use \`mendeley trash list\` to see
  what's there.`,
    )
    .example('mendeley trash list --all')
    .example('mendeley trash get <id>')
    .example('mendeley trash restore <id>')
    .example('mendeley trash delete <id>')
    .example('mendeley trash empty --yes');

  cmd
    .command('list')
    .description('list trashed documents')
    .longDescription(
      `Enumerate all documents currently in the trash.  Use --all
  to traverse every page, and --group <id> to list a group's
  trash instead of the user's.`,
    )
    .option('--group <id>', 'list trashed documents in a group')
    .option('--view <view>', 'view to request', 'all')
    .option('--limit <n>', 'page size', '20')
    .option('--all', 'fetch every page')
    .example('mendeley trash list')
    .example('mendeley trash list --all --format ids')
    .action(async (_args, flags, out) => {
      const session = await buildSession();
      const resource = flags.group ? session.groupTrash(flags.group) : session.trash;
      const kwargs = {
        view: flags.view,
        pageSize: parseInt(flags.limit, 10),
      };
      if (flags.all) {
        out.write(await collect(resource.iter(kwargs)));
      } else {
        const page = await resource.list(kwargs);
        const items = await page.items;
        out.write({ count: page.count, items });
      }
    });

  cmd
    .command('get <id>')
    .description('get a trashed document by id')
    .longDescription(`Fetch a single trashed document by its UUID.`)
    .option('--view <view>', 'view to request', 'all')
    .example('mendeley trash get abcdef12-3456-7890')
    .action(async ([id], flags, out) => {
      const session = await buildSession();
      const doc = await session.trash.get(id, { view: flags.view });
      out.write(doc);
    });

  cmd
    .command('restore <id>')
    .description('restore a document from the trash back to the library')
    .longDescription(
      `Move a document out of the trash and back into the user
  library.  This is the reverse of \`mendeley documents
  move-to-trash\`.`,
    )
    .example('mendeley trash restore abcdef12-3456-7890')
    .action(async ([id], _flags, out) => {
      const session = await buildSession();
      const doc = await session.trash.get(id);
      const restored = await doc.restore();
      out.write(restored);
    });

  cmd
    .command('delete <id>')
    .description('permanently delete a single trashed document (irreversible)')
    .longDescription(
      `Permanently delete one document from the trash.  The
  document is removed from the trash and cannot be restored.`,
    )
    .example('mendeley trash delete abcdef12-3456-7890')
    .action(async ([id], _flags, out) => {
      const session = await buildSession();
      const doc = await session.trash.get(id);
      await doc.delete();
      out.write({ ok: true, id, deleted: true });
    });

  cmd
    .command('empty')
    .description('permanently delete EVERY trashed document (requires --yes)')
    .longDescription(
      `Empty the trash.  This is destructive and cannot be undone —
  pass --yes to confirm.  Useful for housekeeping after a large
  cleanup.`,
    )
    .option('--yes', 'do not prompt for confirmation')
    .example('mendeley trash empty --yes')
    .action(async (_args, flags, out) => {
      if (!flags.yes) {
        process.stderr.write('Refusing to empty the trash without --yes.\n');
        process.exit(2);
      }
      const session = await buildSession();
      const all = await collect(session.trash.iter());
      let count = 0;
      for (const d of all) {
        await d.delete();
        count += 1;
      }
      out.write({ ok: true, deleted: count });
    });
}
