/**
 * `mendeley groups ...` subcommand.
 *
 * Groups are shared libraries in Mendeley.  Each group has a set of
 * members and a set of documents, and group documents can be
 * addressed by combining \`<groupId>/<docId>\`.
 */

import { buildSession } from '../credentials.js';
import { collect, parseLimit } from '../output.js';

export function register(program) {
  const cmd = program
    .command('groups')
    .description('manage group libraries (shared reading lists)')
    .longDescription(
      `Groups are shared libraries that multiple Mendeley users can
  contribute to.  Use \`mendeley groups list\` to enumerate the
  groups you belong to, then use \`mendeley groups documents <id>\`
  and \`mendeley groups files <id>\` to access their contents.`,
    )
    .example('mendeley groups list --all --format ids')
    .example('mendeley groups members <groupId>')
    .example('mendeley groups documents <groupId> --all')
    .example('mendeley groups files <groupId> --all');

  cmd
    .command('list')
    .description('list groups you are a member of')
    .longDescription(`List all groups in which the authenticated user is a member.`)
    .option('--all', 'fetch every page')
    .example('mendeley groups list')
    .example('mendeley groups list --all --format ids')
    .action(async (_args, flags, out) => {
      const session = await buildSession();
      if (flags.all) {
        const items = await collect(session.groups.iter());
        out.writeList(items);
      } else {
        const page = await session.groups.list();
        const items = await page.items;
        out.write({ count: page.count, items });
      }
    });

  cmd
    .command('get <id>')
    .description('get a group by id')
    .longDescription(`Fetch a single group record by its UUID.`)
    .example('mendeley groups get abcdef12-3456-7890')
    .action(async ([id], _flags, out) => {
      const session = await buildSession();
      const group = await session.groups.get(id);
      out.write(group);
    });

  cmd
    .command('members <id>')
    .description('list members of a group')
    .longDescription(`Enumerate the user profiles that belong to the given group.`)
    .option('--all', 'fetch every page')
    .example('mendeley groups members <groupId>')
    .example('mendeley groups members <groupId> --all --format ids')
    .action(async ([id], flags, out) => {
      const session = await buildSession();
      const resource = session.groupMembers(id);
      if (flags.all) {
        const items = await collect(resource.iter());
        out.writeList(items);
      } else {
        const page = await resource.list();
        const items = await page.items;
        out.write({ count: page.count, items });
      }
    });

  cmd
    .command('documents <id>')
    .description('list documents in a group')
    .longDescription(
      `Enumerate the documents in the given group's library.  Use
  this for group reading lists or shared reference libraries.`,
    )
    .option('--all', 'fetch every page')
    .option('--limit <n>', 'page size', '20')
    .example('mendeley groups documents <groupId> --all')
    .example('mendeley groups documents <groupId> --limit 50')
    .example('mendeley groups documents <groupId> --format ids')
    .action(async ([id], flags, out) => {
      const session = await buildSession();
      const resource = session.groupDocuments(id);
      if (flags.all) {
        const items = await collect(resource.iter({ pageSize: parseLimit(flags.limit) }));
        out.writeList(items);
      } else {
        const page = await resource.list({ pageSize: parseLimit(flags.limit) });
        const items = await page.items;
        out.write({ count: page.count, items });
      }
    });

  cmd
    .command('files <id>')
    .description('list files in a group')
    .longDescription(`Enumerate the files attached to documents in the group.`)
    .option('--all', 'fetch every page')
    .option('--limit <n>', 'page size', '20')
    .example('mendeley groups files <groupId> --all')
    .example('mendeley groups files <groupId> --limit 50')
    .action(async ([id], flags, out) => {
      const session = await buildSession();
      const resource = session.groupFiles(id);
      if (flags.all) {
        const items = await collect(resource.iter({ pageSize: parseLimit(flags.limit) }));
        out.writeList(items);
      } else {
        const page = await resource.list({ pageSize: parseLimit(flags.limit) });
        const items = await page.items;
        out.write({ count: page.count, items });
      }
    });
}
