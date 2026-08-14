-- The ORCID iD comes from a completed OAuth flow and from nowhere else.
--
-- auth.identities rows are inserted here directly, which is what Supabase's OAuth callback
-- does after it has exchanged the code and validated the id_token. What is under test is
-- everything that happens on our side of that.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public, pg_catalog;

select plan(14);

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'someone@example.test', '{}'::jsonb, '{}'::jsonb, now(), now());

-- Nothing linked yet ------------------------------------------------------------------

select is(
  (select orcid from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  null::text,
  'a new account has no ORCID iD'
);

select is(
  (select orcid_verified from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  false,
  'and is not marked as verified'
);

-- A user cannot type one --------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select throws_ok(
  $$ update public.profiles set orcid = '0000-0002-5062-2209'
      where id = '11111111-1111-1111-1111-111111111111' $$,
  '42501'::text, null::text,
  'a signed-in user cannot write orcid: the column grant was revoked'
);

reset role;

-- ...and cannot even with the grant wide open, which is the point of the guard.
grant update on public.profiles to authenticated;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

update public.profiles
   set orcid = '0000-0002-5062-2209', orcid_verified = true, display_name = 'Changed'
 where id = '11111111-1111-1111-1111-111111111111';

reset role;

select is(
  (select orcid from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  null::text,
  'the guard reverts a self-declared iD even when the column grant is widened'
);

select is(
  (select display_name from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'Changed'::text,
  'while the rest of the same statement still applies'
);

-- Linking an ORCID identity -----------------------------------------------------------

insert into auth.identities (id, provider_id, user_id, provider, identity_data, created_at, updated_at)
values (
  gen_random_uuid(), '0000-0002-5062-2209', '11111111-1111-1111-1111-111111111111',
  'custom:orcid',
  jsonb_build_object('sub', '0000-0002-5062-2209', 'iss', 'https://orcid.org',
                     'name', 'A. Mathematician'),
  now(), now()
);

select is(
  (select orcid from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  '0000-0002-5062-2209'::text,
  'linking an ORCID identity records the iD from the sub claim'
);

select is(
  (select orcid_verified from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  true,
  'and marks it verified, because it could not have arrived any other way'
);

-- Unlinking ----------------------------------------------------------------------------

delete from auth.identities
 where user_id = '11111111-1111-1111-1111-111111111111' and provider = 'custom:orcid';

select is(
  (select orcid from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  null::text,
  'unlinking the identity removes the iD'
);

select is(
  (select orcid_verified from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  false,
  'and the verified flag with it'
);

-- Identities that are not ORCID ---------------------------------------------------------

insert into auth.identities (id, provider_id, user_id, provider, identity_data, created_at, updated_at)
values (
  gen_random_uuid(), 'someone@example.test', '11111111-1111-1111-1111-111111111111',
  'email',
  jsonb_build_object('sub', '11111111-1111-1111-1111-111111111111',
                     'email', 'someone@example.test'),
  now(), now()
);

select is(
  (select orcid from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  null::text,
  'an email identity does not produce an ORCID iD'
);

-- A provider claiming to be ORCID but whose subject is not an iD must be refused: it means
-- the provider is not what the configuration thinks it is, and a badge invented from it
-- would be worse than none.
insert into auth.identities (id, provider_id, user_id, provider, identity_data, created_at, updated_at)
values (
  gen_random_uuid(), 'not-an-orcid', '11111111-1111-1111-1111-111111111111',
  'custom:orcid',
  jsonb_build_object('sub', 'not-an-orcid', 'iss', 'https://orcid.org'),
  now(), now()
);

select is(
  (select orcid from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  null::text,
  'a subject that is not shaped like an ORCID iD is refused'
);

-- Matched on the issuer even if the provider identifier is renamed ----------------------

insert into auth.identities (id, provider_id, user_id, provider, identity_data, created_at, updated_at)
values (
  gen_random_uuid(), '0000-0001-5109-3700', '11111111-1111-1111-1111-111111111111',
  'custom:orcid-renamed-in-the-dashboard',
  jsonb_build_object('sub', '0000-0001-5109-3700', 'iss', 'https://orcid.org'),
  now(), now()
);

select is(
  (select orcid from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  '0000-0001-5109-3700'::text,
  'the issuer is a second signal, so a dashboard rename does not unlink everyone'
);

-- The invariant is enforced, not merely intended -----------------------------------------

select throws_ok(
  $$ update public.profiles set orcid_verified = false
      where id = '11111111-1111-1111-1111-111111111111' $$,
  '23514'::text, null::text,
  'an iD that is present but unverified is not representable'
);

select throws_ok(
  $$ insert into public.profiles (id, display_name, orcid, orcid_verified)
     values (gen_random_uuid(), 'Ghost', '0000-0002-1825-0097', false) $$,
  '23514'::text, null::text,
  'nor can one be inserted that way'
);

select * from finish();

rollback;
