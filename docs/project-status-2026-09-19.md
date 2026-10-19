# Elts. implementation audit — 19 September 2026

This report describes the source present in this workspace at the start of the
19 September audit. It does not certify production readiness. Authentication,
private media delivery, and upload fixes are being implemented in parallel;
items marked **in progress** require a final verification update before release.

The audit did not inspect environment values, query customer records, reset
credentials, run the former seed, or modify deployed data. Existing architecture
documents describe intent; the source evidence below establishes implementation
status.

## Implementation status

| Area | Status from source | Evidence and remaining work |
| --- | --- | --- |
| Framework and styling | Implemented | Next.js App Router, TypeScript, Tailwind, Radix-based reusable UI, Lucide, local fonts, and server components are present in `package.json`, `src/app/layout.tsx`, and `src/components/ui/`. This is not a clean-build assertion. |
| Homepage | Implemented | `src/app/(public)/page.tsx` composes hero, trust text, about preview, services, featured work, CTA, and the shared public layout. |
| Portfolio | Implemented | `src/components/portfolio/portfolio-grid.tsx` has category filtering, responsive columns, Radix lightbox, keyboard arrows, swipe, and focus restoration. Portfolio content is static in `src/content/photography.ts`; no admin portfolio editor exists. |
| Services, About, Contact | Implemented with content caveats | All three public routes exist. Services include images, descriptions, inclusions, and WhatsApp links. Contact builds a WhatsApp message; it does not submit a booking to a database. About currently includes unverified business statistics; replace or substantiate them before launch. |
| Public SEO | Partial | Metadata, canonical URLs, robots, Open Graph, and Twitter metadata exist. `src/app/sitemap.ts` only lists the homepage; the other public routes are missing from the sitemap. No social preview image is configured in the root metadata. |
| Admin access | Implemented, repair in progress | Admin layout/pages/actions call `requireAdmin`; the root agent is checking authentication and session handling. Do not infer working live login from the existence of the form. |
| Admin overview | Placeholder | `src/app/admin/(dashboard)/page.tsx` renders hardcoded metrics and an activity placeholder, rather than database totals or recent projects. |
| Projects | Partial | List, create, detail, and status controls exist. Missing search/filter/pagination, project editing, expiry/download/watermark controls, PIN reset, project deletion, and functional credential copy. The Copy button currently has `onClick={undefined}`. |
| Customers | Partial | List and create exist. No customer detail, edit, archive action, or total-project count is implemented. The chevron in the list has no action. |
| Media upload and management | Implemented but repair in progress | Upload and per-project media screens exist. The upload agent is correcting the transport/private storage implementation; this report does not certify large-file upload, original preservation, or production deployment limits. |
| Client access | Unsafe at audit start; repair in progress | The form verifies a PIN but originally set a literal cookie value. It did not call the persistent limiter or create a database session. Root is replacing this with authenticated, project-scoped sessions. |
| Gallery and video viewer | UI implemented; security repair in progress | Cover, image/video counts, responsive grid, lightbox, keyboard/swipe controls, and on-open video playback exist. Gallery security, watermark selection, and authenticated media delivery require the root/upload fixes. |
| Favorites | Partial and broken at audit start | Heart controls and server actions exist, but the old code writes the literal cookie value into a UUID session foreign key. The UI also discards action errors. No favorites-only client view, admin favorites route, or filename export exists. |
| Expiration | Partial | The schema has expiry and gallery/download code checks project expiry. Admin configuration and authenticated session revocation enforcement were not wired through the application at audit start. |
| Watermarks | Schema only at audit start | The project flag and variant columns exist, but the old gallery selects normal thumbnail/preview columns regardless of the flag. Private preview generation and delivery are in progress. |
| Database controls | Foundation implemented | Two initial migrations contain tables, foreign keys, RLS, admin policies, opaque-session storage, a persistent rate-limit RPC, and private storage buckets. The application must actually use these controls. New security migration work is in progress. |
| Mobile administration | Partial | The admin sidebar is hidden below the `md` breakpoint with no replacement mobile navigation or logout control in `src/app/admin/(dashboard)/layout.tsx`. |
| Accessibility and notifications | Partial | Public portfolio uses Radix dialog; client lightbox only focuses its container and does not trap/restore focus. Client grid controls appear on hover only. Toasts and admin/gallery loading skeletons are not wired comprehensively. |
| Analytics, download-all, booking, invoice, payment | Not implemented | These remain later-phase features. There is no admin Analytics or Favorites route, all-media route, or background archive-generation workflow. |
| Deployment | Not verified | A GitHub Actions validation workflow exists. No local `.git` or `.vercel` metadata was present at the audit snapshot. No GitHub push, hosted migration application, Vercel deployment, domain, or production behavior was verified. Environment-file presence does not establish working credentials. |

## Security findings at the audit snapshot

### P0 — Gallery authentication bypass (repair in progress)

`src/app/client/actions.ts` originally wrote
`client_session_${project.slug}=authenticated`. The gallery page and
`src/app/actions/client-gallery.ts` accepted any nonempty cookie without
verifying a signature or looking up its hash in `private.gallery_sessions`.
A caller can forge a request cookie; `HttpOnly` does not authenticate its value.
This exposes a ready gallery without completing code/PIN verification.

The same actions separately accept `slug` and `projectId`, without binding the
authenticated session to the requested project. Checking that a media record
belongs to a supplied project is insufficient when the supplied project itself
is not authorized. Root is implementing database-backed opaque sessions and
authorization at each action/gateway boundary.

### P1 — Public delivery defeats private-gallery controls (repair in progress)

The old `src/services/cloudinary.ts` and download action construct normal
Cloudinary `/upload/` delivery URLs. The gallery sends those URLs to the browser.
Access to such a URL does not require the application session; removing a
transformation also exposes an unwatermarked asset. Hiding the download button,
archiving a project, or expiring a cookie does not revoke public URL access.

The upload agent and root are coordinating authenticated storage and a gateway.
Existing assets previously uploaded publicly require a separate inventory and
approved remediation before anyone claims they became private. Changing code
alone does not change those stored assets.

### P1 — Project creation and access use incompatible PIN algorithms (repair in progress)

`src/app/actions/admin-projects.ts` originally imports the development helper
from `src/lib/security/tokens.ts`: SHA-256 disguised as an `scrypt-v1` envelope.
Client access uses real scrypt from `src/lib/security/credentials.ts`. Consequently
a newly created project's correct PIN cannot pass that verifier. Project creation
also accepts 4–12 characters while the real verifier requires exactly six digits.

Use the real server-only credential helper consistently. Root is handling
compatible legacy verification and upgrade; do not reset existing PINs or
silently change stored hashes without successfully verifying the credential.

### P1 — Brute-force limiter and server revocation were not connected (repair in progress)

The SQL limiter and session-revocation trigger exist, but no original client
access call consumes rate-limit buckets or registers a session. Browser cookie
expiry is not server-side expiry. Settings nevertheless displays rate limiting
and scrypt as enabled. Those labels must follow verified implementation rather
than act as security evidence.

### P2 — Favorite persistence is not functioning

The old action assigns the cookie string `authenticated` to `favorites.session_id`,
which is a UUID referencing `private.gallery_sessions`. Normal inserts therefore
fail. The grid invokes `useOptimistic` outside a transition, never updates its
underlying favorite state from the result, and suppresses errors. Restore
authorized session ownership, persist the result, and expose failures to users.

## Changes owned by this audit

`scripts/seed.ts` was replaced with an explicit refusal to provision default
accounts. The previous script contained fixed credentials, automatically granted
admin membership, and wrote an incompatible hash and schema-invalid fixture.
The replacement reads no environment values, creates no accounts, performs no
network calls, and exits unsuccessfully with setup instructions. It does not
remove existing data, revoke existing accounts, or reset their credentials.

Initial administrators should be created through Supabase Auth with unique
credentials and granted `public.admins` membership by an authorized owner.
Automated fixtures require a disposable test database and a separately reviewed
workflow; production defaults must not be embedded in source or logged.

Verification for this audit-owned change: targeted ESLint on `scripts/seed.ts`
passed. Invoking the replacement with `node --import=tsx scripts/seed.ts`
printed only the refusal/setup instructions and exited with the intended code 1.
The original seed was never executed by this audit. The TypeScript runner needed
an approved sandbox retry because Node's OS user lookup failed inside the sandbox.

## Verification boundaries and release gate

The existing tests exercise the foundation's cryptography/access helpers and
PostgreSQL constraints/RLS in PGlite. They do not establish that the application
actions actually call those helpers. This is why a passing foundation suite can
coexist with the application defects above.

Before marking the affected flows ready:

1. Run lint, typecheck, security/database tests, and a production build against
   the final combined changes.
2. Test gallery requests with no cookie, a forged cookie, an expired/revoked
   session, and a valid session requesting another project's media/favorites.
3. Verify ready/draft/archive/expiry changes and download permission at both
   gallery and media-delivery boundaries, including video Range requests.
4. Verify persistent rate limiting, generic invalid-credential errors, working
   PIN creation/access, and any legacy-hash upgrade without credential reset.
5. Verify originals cannot be reached through public URLs or preview variants,
   and that watermark-enabled projects never fall back to plain previews.
6. Test real upload progress, partial failures, favorites persistence, mobile
   navigation, keyboard focus, and error messages using synthetic test records.
7. Verify the hosted migrations, configured environment, storage access rules,
   and deployment separately. Record actual results and remaining limitations.

Until those checks complete, classify the private client platform as **under
repair**, even where the interface renders successfully.

## Follow-up status — source repair

The source now uses an opaque, project-bound gallery session with compatible
legacy PIN verification and server-side revocation. Gallery preview and
download requests resolve that session before fetching authenticated Cloudinary
assets. The admin upload UI sends files directly to Cloudinary in 6 MiB chunks,
with a 100 MiB image limit, a 2 GiB video limit, retries, progress, and
per-file failure handling. Cloudinary account limits still govern the true
maximum.

The hosted read-only check found three existing projects and no
`cloudinary_delivery_type` column or gallery-session RPCs. Run
`supabase/migrations/202609190001_gallery_access_and_delivery.sql` in the
Supabase SQL Editor before testing the repaired login. Existing legacy PINs are
upgraded only after a successful verification; they do not need to be reset.
