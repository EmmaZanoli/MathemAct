/**
 * Site-wide constants: the things that appear in more than one place and must not drift
 * between them.
 *
 * Navigation lives here rather than inside the layout so that adding a section is one
 * edit, and so the set of real destinations is auditable at a glance. Nothing goes in
 * these lists until the page it points at exists — a nav link to a 404 costs more trust
 * than a short nav does.
 */

export const SITE = {
  name: 'MathemAct',
  mission: 'Collectively shaping the future of mathematical research in the age of AI.',
  description:
    'Structured, first-hand accounts of how AI tools are actually used in mathematical ' +
    'work, and a record of where the community agrees and disagrees about how they ' +
    'should be used.',
  contactEmail: 'matesimpatica@gmail.com',
  repository: 'https://github.com/EmmaZanoli/MathemAct',
} as const;

export const LICENCE = {
  name: 'CC BY 4.0',
  fullName: 'Creative Commons Attribution 4.0 International',
  url: 'https://creativecommons.org/licenses/by/4.0/',
} as const;

/**
 * The Leiden Declaration on AI and Mathematics supplies the principles this project
 * works under. MathemAct is an independent response to it and carries no endorsement
 * from its authors or from the International Mathematical Union. Any copy referring to
 * the Declaration must keep that distinction explicit.
 */
export const LEIDEN = {
  name: 'Leiden Declaration on Artificial Intelligence and Mathematics',
  shortName: 'Leiden Declaration',
  url: 'https://leidendeclaration.ai/',
  published: 'June 2026',
  /** Verbatim, from the Declaration. Quoted on the home page and the about page — do not
   *  paraphrase these into the quotation marks. */
  quotes: {
    disclosure: "Include a 'Tool and computational resource disclosure' section in your papers",
    evolving: 'though the precise form of such a section will necessarily evolve, we encourage authors to live up to the spirit',
  },
} as const;

export interface NavLink {
  readonly label: string;
  readonly href: string;
}

/** Header navigation. Grows as sections ship. */
export const NAV: readonly NavLink[] = [{ label: 'About', href: '/about/' }];

/** Footer navigation, internal pages only. The licence and contact are rendered
 *  separately because one is an external link and the other is a mailto. */
export const FOOTER_NAV: readonly NavLink[] = [
  { label: 'About', href: '/about/' },
  { label: 'Code of conduct', href: '/code-of-conduct/' },
  { label: 'Privacy', href: '/privacy/' },
];
