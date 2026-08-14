-- private.match_institution() -- the longest-suffix matcher behind every badge.
--
-- The ROR identifiers below are fixtures, not real ROR records. The real dump is loaded
-- in a later task; what is under test here is the matching rule, so synthetic ids that
-- satisfy the format constraint are both sufficient and clearer about being fabricated.
--
-- The whole file runs inside a transaction that is rolled back, so the fixtures never
-- persist.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public, pg_catalog;

select plan(16);

-- Fixtures ---------------------------------------------------------------------------

insert into private.ror_institutions (ror_id, name, country_code, country_name) values
  ('0oxford01', 'University of Oxford',                                 'GB', 'United Kingdom'),
  ('0enspari1', 'Ecole normale superieure',                             'FR', 'France'),
  ('0mpgsoc01', 'Max Planck Society',                                   'DE', 'Germany'),
  ('0mpgmis01', 'Max Planck Institute for Mathematics in the Sciences', 'DE', 'Germany'),
  ('0weizman1', 'Weizmann Institute of Science',                        'IL', 'Israel');

insert into private.ror_domains (domain, ror_id) values
  ('ox.ac.uk',       '0oxford01'),
  ('ens.fr',         '0enspari1'),
  ('mpg.de',         '0mpgsoc01'),
  ('mis.mpg.de',     '0mpgmis01'),
  ('weizmann.ac.il', '0weizman1');

-- The institutions named in the brief -------------------------------------------------

select is(
  private.match_institution('maths.ox.ac.uk'), '0oxford01'::text,
  'maths.ox.ac.uk resolves to Oxford via its parent domain'
);

select is(
  private.match_institution('ox.ac.uk'), '0oxford01'::text,
  'ox.ac.uk resolves to Oxford exactly'
);

select is(
  private.match_institution('ens.fr'), '0enspari1'::text,
  'ens.fr resolves to ENS -- a two-label domain with no academic marker in it'
);

select is(
  private.match_institution('weizmann.ac.il'), '0weizman1'::text,
  'weizmann.ac.il resolves to the Weizmann Institute'
);

-- The point of longest-suffix matching: the specific institute must beat its parent
-- society, and an unlisted sibling must still fall back to the parent.

select is(
  private.match_institution('mis.mpg.de'), '0mpgmis01'::text,
  'mis.mpg.de resolves to the institute, not to the Max Planck Society'
);

select is(
  private.match_institution('fritz-haber-institut.mpg.de'), '0mpgsoc01'::text,
  'an mpg.de subdomain with no record of its own falls back to the parent society'
);

select is(
  private.match_institution('a.b.c.mis.mpg.de'), '0mpgmis01'::text,
  'a deeply nested subdomain still finds the longest matching record'
);

-- Consumer providers earn nothing -----------------------------------------------------

select is(
  private.match_institution('gmail.com'), null::text,
  'gmail.com resolves to no institution'
);

select is(
  private.match_institution('anything.gmail.com'), null::text,
  'a subdomain of a blocked provider is also blocked'
);

-- The strongest form of this test: even if a bad upstream ROR release claimed a consumer
-- domain, the block list wins, because it is consulted before the lookup.
insert into private.ror_institutions (ror_id, name, country_code, country_name)
values ('0badrec01', 'Spurious ROR Record', 'US', 'United States');
insert into private.ror_domains (domain, ror_id) values ('gmail.com', '0badrec01');

select is(
  private.match_institution('gmail.com'), null::text,
  'the block list overrides a ROR record that wrongly claims a consumer domain'
);

-- Normalisation and malformed input ---------------------------------------------------

select is(
  private.match_institution('MATHS.OX.AC.UK'), '0oxford01'::text,
  'matching is case-insensitive'
);

select is(
  private.match_institution('  maths.ox.ac.uk.  '), '0oxford01'::text,
  'surrounding whitespace and a trailing dot are normalised away'
);

select is(
  private.match_institution('nothing-here.example.org'), null::text,
  'an unknown domain resolves to null'
);

select is(
  private.match_institution(null::text), null::text,
  'null in, null out'
);

select is(
  private.match_institution('localhost'), null::text,
  'a single-label domain resolves to null'
);

-- The rule CLAUDE.md forbids, asserted as absent: no TLD is ever a match, even when a
-- record for a domain under it exists.
select is(
  private.match_institution('some-company.uk'), null::text,
  'a TLD is never a candidate, so an unrelated .uk domain earns nothing'
);

select * from finish();

rollback;
