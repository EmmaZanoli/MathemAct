/**
 * Who gets an author page.
 *
 * This is its own file rather than another function in practices.ts for a bundling reason.
 * `resources.ts` does a static `import` of data/resources.json, so anything that imports it
 * carries the resource corpus — and practices.ts is imported by browser scripts, the
 * submission form among them. Tree-shaking would probably drop it; probably is not a good
 * enough reason to put a build-time-only join into a module the browser loads.
 *
 * **Practice authors and resource submitters, unioned.** Not everyone in data/profiles.json:
 * that file also holds people whose only contribution is a comment or a proposition, and
 * nothing links a name from either of those, so a page for them would be one no reader can
 * reach and Pagefind would index it as an almost-empty result. The rule is that a page exists
 * exactly where a link to it exists.
 *
 * Identity comes from whichever corpus mentioned the person, because both carry the same
 * fields — display name, pseudonym flag, and the institution triple the badge is built from.
 * A practice wins a tie only in the sense that it is read first; the rows agree, both having
 * been written by the same export from the same profile.
 */
import { listPractices } from './practices';
import type { CorpusAuthor } from './practices';
import { listResources } from './resources';

export async function listContributors(): Promise<CorpusAuthor[]> {
  const contributors = new Map<string, CorpusAuthor>();

  for (const practice of await listPractices()) {
    if (practice.author) contributors.set(practice.author.id, practice.author);
  }

  for (const resource of listResources()) {
    if (resource.submitter && !contributors.has(resource.submitter.id)) {
      contributors.set(resource.submitter.id, resource.submitter);
    }
  }

  return [...contributors.values()];
}
