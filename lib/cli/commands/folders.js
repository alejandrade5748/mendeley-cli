/**
 * `mendeley folders ...` subcommand.
 *
 * Folders are how Mendeley users organise documents in the library.
 * Folders are identified by UUIDs, can be nested, and can contain
 * either user documents or catalog documents.  Use
 * `mendeley folders documents <id>` to list the documents in a
 * folder, and `mendeley folders add-document` to insert one.
 */

import { buildSession } from '../credentials.js';
import { collect, parseLimit } from '../output.js';

export function register(program) {
  const cmd = program
    .command('folders')
    .description('manage folders (organise documents into collections)')
    .longDescription(
      `Folders are user-defined collections of documents.  Each
  folder has an id, a name, and an optional parent (for nesting).
  Use \`--group <id>\` to work with folders inside a group library.`,
    )
    .example('mendeley folders list --all --format ids')
    .example('mendeley folders create "My new folder"')
    .example('mendeley folders documents <folderId> --all')
    .example('mendeley folders add-document <folderId> <docId>');

  cmd
    .command('list')
    .description('list folders')
    .longDescription(
      `List folders in the user library.  Use --group <id> to list
  folders inside a group library instead.  Use --all to traverse
  every page; otherwise only the first 20 folders are returned.`,
    )
    .option('--limit <n>', 'page size', '20')
    .option('--all', 'fetch every page')
    .option('--group <id>', 'list folders in a group library (not the user library)')
    .example('mendeley folders list')
    .example('mendeley folders list --all --format ids')
    .example('mendeley folders list --group <groupId>')
    .action(async (_args, flags, out) => {
      const session = await buildSession();
      const kwargs = { pageSize: parseLimit(flags.limit) };
      if (flags.group) kwargs.group_id = flags.group;
      if (flags.all) {
        out.write(await collect(session.folders.iter(kwargs)));
      } else {
        const page = await session.folders.list(kwargs);
        const items = await page.items;
        out.write({ count: page.count, items });
      }
    });

  cmd
    .command('get <id>')
    .description('get a folder by id')
    .longDescription(
      `Return the folder record: id, name, parent, group, and counts
  of documents.`,
    )
    .example('mendeley folders get abcdef12-3456-7890')
    .action(async ([id], _flags, out) => {
      const session = await buildSession();
      const folder = await session.folders.get(id);
      out.write(folder);
    });

  cmd
    .command('create <name>')
    .description('create a new folder')
    .longDescription(
      `Create a new folder with the given name.  Pass --parent
  <parentId> to nest it inside another folder, or --group <groupId>
  to create the folder inside a group.`,
    )
    .option('--parent <id>', 'parent folder id (for nesting)')
    .option('--group <id>', 'group id (for group-library folders)')
    .example('mendeley folders create "Reading list"')
    .example('mendeley folders create "Important" --parent abcdef12')
    .example('mendeley folders create "Group" --group 12345')
    .action(async ([name], flags, out) => {
      const session = await buildSession();
      const folder = await session.folders.create({
        name,
        parentId: flags.parent,
        groupId: flags.group,
      });
      out.write(folder);
    });

  cmd
    .command('update <id>')
    .description('rename a folder')
    .longDescription(
      `Update the name (and currently only the name) of an existing
  folder.`,
    )
    .option('--name <name>')
    .example('mendeley folders update abcdef12 --name "Renamed folder"')
    .action(async ([id], flags, out) => {
      const session = await buildSession();
      const folder = await session.folders.get(id);
      const updated = await folder.update({ name: flags.name });
      out.write(updated);
    });

  cmd
    .command('delete <id>')
    .description('delete a folder (does not delete the contained documents)')
    .longDescription(
      `Delete a folder.  The documents inside it are not deleted —
  they simply become unfoldered.`,
    )
    .example('mendeley folders delete abcdef12-3456-7890')
    .action(async ([id], _flags, out) => {
      const session = await buildSession();
      const folder = await session.folders.get(id);
      await folder.delete();
      out.write({ ok: true, id, deleted: true });
    });

  cmd
    .command('documents <id>')
    .description('list documents contained in a folder')
    .longDescription(
      `Return the documents in the given folder.  Use --format ids
  to get a quick list of document ids, then pipe into other
  commands.`,
    )
    .option('--limit <n>', 'page size', '20')
    .option('--all', 'fetch every page')
    .example('mendeley folders documents abcdef12')
    .example('mendeley folders documents abcdef12 --all --format ids')
    .action(async ([id], flags, out) => {
      const session = await buildSession();
      const resource = session.folderDocuments(id);
      const kwargs = { pageSize: parseLimit(flags.limit) };
      if (flags.all) {
        out.write(await collect(resource.iter(kwargs)));
      } else {
        const page = await resource.list(kwargs);
        const items = await page.items;
        out.write({ count: page.count, items });
      }
    });

  cmd
    .command('add-document <folderId> <docId>')
    .description('add a document to a folder')
    .longDescription(
      `Insert an existing user document into a folder.  The document
  is not duplicated; it just gains a folder membership.`,
    )
    .example('mendeley folders add-document <folderId> <docId>')
    .action(async ([folderId, docId], _flags, out) => {
      const session = await buildSession();
      await session.folderDocuments(folderId).add(docId);
      out.write({ ok: true, folder_id: folderId, document_id: docId });
    });

  cmd
    .command('remove-document <folderId> <docId>')
    .description('remove a document from a folder (does not delete the document)')
    .longDescription(
      `Removes a document from the given folder.  The document itself
  remains in the library.`,
    )
    .example('mendeley folders remove-document <folderId> <docId>')
    .action(async ([folderId, docId], _flags, out) => {
      const session = await buildSession();
      await session.folderDocuments(folderId).remove(docId);
      out.write({ ok: true, folder_id: folderId, document_id: docId });
    });
}
