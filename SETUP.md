# SETUP — wiring Sous to live services

The repo builds and tests green without any of this (placeholder keys are in
`.env.local`), but sign-in cannot round-trip until these steps are done once.

## 1. Clerk application

1. [dashboard.clerk.com](https://dashboard.clerk.com) → Create application
   ("Sous"). Enable **Email** (and whatever else she'll sign in with).
2. **Enable Organizations**: Configure → Organizations → turn on. Keep the two
   default roles (`org:admin`, `org:member`) — Sous maps admin → owner,
   member → staff, and uses nothing else.
3. API keys → copy the **Publishable key** and **Secret key** into
   `.env.local` (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`).

## 2. Tell Clerk to mint Convex-shaped tokens

Clerk offers two ways to do this and Convex's client supports both — it
checks `sessionClaims.aud === "convex"` and falls back to a named JWT
template otherwise (`ConvexProviderWithClerk.js`). Use whichever your
dashboard shows; **A** is the current one.

### A. Customize session token (current Clerk dashboard)

Configure → Sessions → **Customize session token** → add these claims:

```json
{
  "aud": "convex",
  "org_id": "{{org.id}}",
  "org_slug": "{{org.slug}}",
  "org_role": "{{org.role}}"
}
```

`aud: "convex"` is what routes the client down the session-token path, and it
must match `applicationID: "convex"` in `convex/auth.config.ts`. The three
`org_*` claims are exactly what the tenancy boundary reads
(`convex/lib/functions.ts` — `resolveOrg`). Clerk may also list defaults like
`picture` and `updated_at`; leave them, they're harmless.

**Press Save.** The claims do nothing until you do.

### B. JWT template (older dashboards)

Configure → JWT templates → **New template → Convex**, named exactly
`convex`, with the same three `org_*` claims (`aud` is set for you).

## 3. Convex deployment

```bash
npx convex dev
```

Log in / create the project when prompted. This writes `CONVEX_DEPLOYMENT`
and `NEXT_PUBLIC_CONVEX_URL` into `.env.local` and pushes the functions.

## 4. Tell Convex to trust Clerk

Convex dashboard → Settings → Environment variables:

- `CLERK_JWT_ISSUER_DOMAIN` = your Clerk **Frontend API** origin,
  `https://<your-slug>.clerk.accounts.dev`.

Find it in Clerk under API keys (the JWT-template page also shows it as
"Issuer", but the session-token page doesn't — hence spelling it out here).
It's also encoded in your publishable key: everything after `pk_test_` is
base64 of the domain. For this project that resolves to:

```
CLERK_JWT_ISSUER_DOMAIN=https://optimal-anteater-60.clerk.accounts.dev
```

(`convex/auth.config.ts` reads it.)

## 5. Super user

- Clerk dashboard → Users → copy your user ID (`user_...`).
- Put it in `SOUS_SUPER_USER_IDS` in `.env.local` **and** in the Convex
  dashboard env vars (Convex functions read their own copy).

## 6. First kitchen

### 6.1 The Clerk organization

It exists already if the chef created it during sign-up — Clerk prompts for
an organization on first sign-in, so **this step is usually done for you**.
Otherwise: Clerk dashboard → Organizations → Create.

Either way, two things matter: the **slug** becomes the URL
(`/kitchen-slug/...`), and the chef must be **Admin** (Sous maps admin →
owner). A quick check that it's right: the owner sees nine nav items; staff
see three.

Note the organization's **ID** (`org_...`) — you need it next. It's on the
org's page in the Clerk dashboard, or:

```bash
curl -s https://api.clerk.com/v1/organizations \
  -H "Authorization: Bearer $(grep '^CLERK_SECRET_KEY=' .env.local | cut -d= -f2)"
```

### 6.2 The Convex org row

Clerk holds identity; this row holds everything Sous knows about the kitchen
(colours, invoice numbering, tax, overhead rate). Until it exists, Settings
throws "This kitchen has not been set up yet" and the welcome screen never
appears — `OnboardingGate` requires `provisioned === true`.

`admin:provisionOrg` is a `superMutation`, so it needs a caller identity.
The Convex dashboard's function runner and a bare `npx convex run` are both
**unauthenticated** — `ctx.auth.getUserIdentity()` returns null and you get
`NOT_FOUND`. Pass the identity explicitly instead:

```bash
npx convex run admin:provisionOrg \
  '{"orgId":"org_…","slug":"kitchen-slug","name":"Kitchen name","foundingMember":true}' \
  --identity '{"subject":"user_…"}'
```

- `subject` is the super user's Clerk ID — the same one in
  `SOUS_SUPER_USER_IDS`.
- `foundingMember: true` for the pilot kitchen (free forever, CONTEXT.md);
  omit it otherwise. Everything else — USD, tax off, drift 10%, invoice
  prefix `INV` — comes from the mutation's defaults.

Confirm with `npx convex data orgs`.

Then reload the app as the chef: you'll be redirected to
`/kitchen-slug/welcome` for the four-field setup (name, colours, currency,
stocktake day). Finishing it stamps `onboardedAt`, and the redirect stops.

(This is what the `/admin` provisioning UI will replace in a later slice.)

## 6. Resend — invoice email (optional)

Skip this entirely and everything still works: the invoice card hides the
Email action and offers Share, WhatsApp and the link instead. Nothing breaks,
nothing errors — `lib/mailer.ts` treats "no key" as a normal state, not a
failure.

**Sous always sends from its own domain, never from hers.** Putting her Gmail
in `From:` is spoofing — it fails DMARC and lands in spam, which is worse than
not sending. Her address goes in `reply-to`, so a customer who hits reply
still reaches her.

### 6a. Try it in two minutes, without touching DNS

Resend gives every account a shared test sender that needs no domain. It will
**only deliver to the email address you signed up with**, which is exactly
what you want for a first check.

1. Create a Resend account → **API Keys** → **Create API Key**, permission
   **Sending access**. Copy it (shown once).
2. Fill the two slots already waiting in `.env.local`:

   ```
   RESEND_API_KEY=re_xxxxxxxxxxxx
   SOUS_MAIL_FROM=Sous <onboarding@resend.dev>
   ```

3. Restart `npm run dev` — env vars are read at boot, so the Email button
   stays hidden until you do.
4. Put your own Resend signup address on a test customer, open that order, and
   press **Email**.

If it arrives, the whole path works: PDF render, attachment, reply-to. Move on
to 6b to send to real customers.

### 6b. Your own domain, for real customers

`onboarding@resend.dev` cannot deliver to anyone but you. For customers you
need a verified domain.

1. Resend → **Domains** → **Add Domain**. Use a subdomain you do not send
   personal mail from — `mail.yourdomain.com` or `invoices.yourdomain.com` —
   so a deliverability problem here can never affect your normal email.
2. Resend shows three records. Add them at your registrar exactly as given:

   | Type | What it does | Note |
   |---|---|---|
   | `TXT` (SPF) | says Resend may send as you | must be the only SPF record on that host |
   | `TXT` (DKIM) | signs each message | long value — paste, don't retype |
   | `TXT` (DMARC) | tells inboxes what to do with fakes | start at `p=none` |

   Verification is usually minutes, occasionally hours. Resend shows
   **Verified** when it is done; do not send before then.
3. Change `SOUS_MAIL_FROM` to an address **on that exact domain**:

   ```
   SOUS_MAIL_FROM=Rutendo's Kitchen <invoices@mail.yourdomain.com>
   ```

   The display name is what customers see in their inbox. The address must
   match the verified domain or Resend rejects the send with a 403.
4. Restart the dev server.

### 6c. Where a reply goes

Settings → Business profile → **Reply-to**. Falls back to the org's public
email if unset; with neither, replies land at the Sous domain, where nobody
reads them.

### 6d. Check it properly

Send one to yourself from a real order and confirm three things:

- it arrives, and not in spam;
- the PDF attachment opens and reads correctly;
- **hitting reply addresses her, not Sous.**

The third is the one people forget, and it is the one that costs a customer.

### When it goes wrong

| What you see | Almost always |
|---|---|
| No Email button at all | Blank `RESEND_API_KEY` or `SOUS_MAIL_FROM`, or the dev server wasn't restarted |
| "This customer has no email address" | True — phone is the identity key and email is optional. Share the link instead |
| "Couldn't send it: … Nothing was sent" | `SOUS_MAIL_FROM` is not on a verified domain, or the key lacks Sending access |
| Nothing arrives, no error | Using `onboarding@resend.dev` to a customer address. It only delivers to your own |
| Arrives in spam | DMARC still `p=none` and the domain is young. Warm it up gradually |
| Reply goes to Sous | Reply-to unset in Settings → Business profile |

Resend → **Logs** shows every attempt with its outcome, which settles most of
these in one look.

## Verify

- Sign in as the chef → lands on `/kitchen-slug` (Home).
- Sign in as staff → lands on `/kitchen-slug/calendar`; Pantry/Settings 404.
- Visit another slug → 404, not a permission error.
- `/admin` as anyone not in `SOUS_SUPER_USER_IDS` → 404.
- `npm test` — the same rules, proven offline.

The `org_*` claims are only populated while the session has an **active
organization**. A signed-in user without one gets `NOT_FOUND` from `withOrg`
— that's correct, not a bug; `components/shell/org-sync.tsx` sets the active
org from the route on every org page.
