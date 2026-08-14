# ORCID

An ORCID iD on a profile means the person signed in to ORCID and ORCID told us who they
are. It never means they typed sixteen digits into a form.

## Why it changed

The original design resolved a submitted iD against ORCID's public API. That proves the iD
**exists**. It proves nothing about who submitted it, so anyone could have pasted a
well-known mathematician's iD and worn a badge reading "ORCID-linked". Against this
project's own rule — *a badge states only what was verified* — that is an overclaim, and
the sort that is worse than having no badge at all.

## How it works now

ORCID is a conformant OpenID Connect provider. Verified from its discovery document at
`https://orcid.org/.well-known/openid-configuration`:

| | |
|---|---|
| Issuer | `https://orcid.org` |
| Authorization | `https://orcid.org/oauth/authorize` |
| Token | `https://orcid.org/oauth/token` |
| Scopes | `openid` |
| Response types | `code`, `id_token`, `id_token token` |
| Claims | `family_name`, `given_name`, `name`, `auth_time`, `iss`, `sub` |

**The `sub` claim is the ORCID iD**, e.g. `"sub": "0000-0002-5062-2209"`, and the `openid`
scope alone is enough to get it.

Supabase performs the authorization-code exchange, so the client secret lives in its
dashboard next to the Turnstile and Brevo secrets and never comes near this repository.
The completed identity lands in `auth.identities`, and
`private.sync_orcid_identity()` reads `identity_data->>'sub'` from it onto the profile.

`profiles.orcid` is therefore system-owned: no column grant, reverted by the guard trigger,
exactly like the institution columns. `orcid` and `orcid_verified` are tied by a constraint
so that an iD which is present but unverified cannot be represented at all.

## Configuration — the manual part

None of this is done by a migration. Until these steps are complete the trigger simply
never fires, which is inert rather than broken.

### 1. Register an ORCID client

ORCID's **Public API** credentials are free and need only an ORCID account. In ORCID, go to
your account → **Developer Tools**, and register an application. You will need:

- **Redirect URI:** `https://fgnmafmzracdytpfqpel.supabase.co/auth/v1/callback`
- Scope: `openid`

ORCID runs a sandbox at `sandbox.orcid.org` with separate credentials. Use it first — the
production redirect URI list is not somewhere to experiment.

### 2. Add the provider in Supabase

Dashboard → **Authentication → Providers → Custom** (custom OAuth/OIDC providers; the free
plan allows up to three).

| Field | Value |
|---|---|
| Identifier | `custom:orcid` |
| Type | OIDC |
| Issuer | `https://orcid.org` |
| Client ID | from ORCID |
| Client Secret | from ORCID |
| Scopes | `openid` |

The identifier **must** be `custom:orcid`, or `private.settings` must be updated to match:

```sql
update private.settings set value = 'custom:whatever', updated_at = now()
 where key = 'orcid_provider';
```

The trigger also matches on the issuer, so a rename in the dashboard degrades to the second
signal rather than silently unlinking everyone. Do not rely on that; fix the setting.

### 3. Enable manual linking

Dashboard → Authentication → **Manual linking**. Without it, `linkIdentity` fails.

## The client flow, when there is a client

Not built — there is no auth UI yet. When there is, ORCID is a **link on an existing
account**, not a way to sign up:

```ts
// Connect ORCID to the account the user is already signed in to.
await supabase.auth.linkIdentity({ provider: 'custom:orcid' });

// Disconnect it. The trigger clears profiles.orcid on the way out.
await supabase.auth.unlinkIdentity(orcidIdentity);
```

### Do not offer ORCID as a way to sign in

**ORCID's OIDC returns no email claim.** Look at the claims list above: `sub`, `name`,
`given_name`, `family_name`, `iss`, `auth_time`, and nothing else.

An account created by signing in with ORCID would therefore have no email address at all,
which means no institutional badge — that entire tier is derived from a confirmed email
domain — no password reset, and no way to reach the person. Offer only
`linkIdentity` on an account that already exists.

If ORCID sign-in is ever added anyway, the account must be forced through adding and
confirming an email before it can post, and that flow does not exist.

## Privacy consequence

Adding ORCID adds a fifth data processor. When someone links their iD, ORCID sees that they
authenticated to a client registered to this project, and learns their IP address as any
website does. It receives nothing else from us — no email address, no display name, no
content. This is disclosed in the privacy notice.

## What it is still worth being careful about

An ORCID iD is a real-name identifier, and this site permits pseudonyms at every tier for
good reason. Linking ORCID under a pseudonym reveals the connection between the two to
anyone who looks at the profile. That is the user's decision to make, but the interface
should say so plainly at the point of linking rather than afterwards.
