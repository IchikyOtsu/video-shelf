# Shelf targeted security review — 2026-10-05

Scope: source/item endpoints, account authentication and mutations, cron/digest,
RSS HTML and remote fetching, redirects, cookies, exports, and server logs.
This is a code review with local regression tests, not a production penetration test.

## Findings fixed

- **Temporary JWT accepted as a session:** the pending-TOTP token used the same
  signature and identity fields. Session validation now explicitly rejects its
  purpose; pending challenges also check the current session version.
- **Recovery-code race:** login now consumes a code with one conditional SQL
  update, so simultaneous attempts cannot both consume it.
- **TOTP setup bypass:** an already enabled factor cannot be overwritten by setup.
  Setup checks the state again in its update and all TOTP step-up routes are limited.
- **Password-reset race:** consuming the one-use token and updating the password
  now happen atomically, including an expiry check at consumption time.
- **Missing explicit CSRF checks:** all API POST/PUT/PATCH/DELETE requests must have
  an Origin equal to the actual request origin; cross-site requests are refused.
  This covers public authentication mutations as well as authenticated routes.
  API scripts must supply an Origin header. The bearer-protected cron GET is unchanged.
- **Rate-limit race:** the database counter uses one atomic upsert instead of
  reading and updating separately. Additional limits cover YouTube searches,
  source creation/editing/manual synchronization, password changes, TOTP attempts,
  exports and explicit article extraction.
- **RSS SSRF:** HTTP(S) URLs without credentials or nonstandard ports are required.
  Every redirect and all DNS answers are validated. Private, loopback, link-local,
  reserved and mapped private addresses are refused. Connections use an approved,
  pinned IP to prevent DNS rebinding. TLS still verifies the original hostname.
  DNS, headers and body share the fetch timeout; streamed bodies are size limited.
  The same transport protects explicit article fetching; it never runs on sync/open.
- **CSV injection:** all cells are quoted and formula-like values are prefixed
  with an apostrophe. OPML names, URLs and category attributes are XML escaped.

## Endpoint isolation review

| Endpoint family | Ownership boundary |
| --- | --- |
| Source list/create/batch | Session user ID defines the source owner and deduplication scope. |
| Source edit/delete/single sync | Source ID and session user ID are both required; valid UUIDs are checked. |
| Global manual sync / Shorts cleanup | Only sources owned by the session user are queried. |
| Bulk category move | One SQL statement checks that every selected source is owned before changing any. |
| Item feed / legacy videos / search | Items join sources with an explicit source owner filter. Search and every combined filter use the same condition as bulk seen changes. |
| Seen/saved/progress | Item IDs are checked through owned sources; state writes use the session user ID. |
| Reader / full-article cache | The item is joined to an owned source before reading cached content or fetching its URL. Cache keys are item IDs; source/account deletion cascades to cache rows. |
| Cron status | Only counts are returned. Source counts use persisted user ownership (with a join for legacy rows); item and email counts filter by session user ID. Recipient, body, lease and provider payload fields are never selected. |
| Exports | Source ownership is enforced; saved item state also joins the session user. Responses are private, no-store downloads. |
| Account settings / TOTP / deletion | User ID comes from the validated session; sensitive mutations require the existing password/code checks. |
| Scheduled cron | Constant expected bearer secret; run/source/email leasing and idempotency remain intact. |

## Existing protections retained

Session cookies are HttpOnly, Secure in production and SameSite=Lax. Production
requires AUTH_SECRET. Password changes invalidate old sessions through versioning.
TOTP secrets use authenticated AES-GCM encryption. Verification/reset tokens and
recovery codes are hashed in storage. Authentication redirect destinations are
fixed internal paths. YouTube resolution validates every redirect against its
host allowlist. RSS content stays inert in the database and is sanitized before
rendering: scripts, styles, iframes, forms, unsupported embeds, event attributes
and javascript URLs are removed. Reader links use noopener/noreferrer; images
use no-referrer. Source logs retain only kind, hostname, fixed error category,
HTTP status, safe SQLSTATE and duration. Digest logs retain safe delivery counts,
user ID and provider status/category, without recipients, bodies or credentials.

## Validation and limits

Regression tests exercise private/mapped address rejection, DNS and redirect
checks, fetch timeouts, Origin and JWT-purpose validation, HTML sanitization,
CSV/OPML escaping, bounded source workers, tenant-scoped cron metrics and search,
atomic category moves and rate counters. Existing digest retry/idempotency and
YouTube catch-up tests remain enabled. Production dependency audit reports zero
known advisories at the time of this review.

Browser checks use local fixture data; no production accounts, secrets or email
recipients are involved. Live pinned outbound fetching cannot be exercised in the
managed workspace because it has no direct Internet route; unit tests inject
controlled DNS/HTTP responses. Vercel's standard Node runtime must allow public
outbound TCP. Existing HTML sanitization prevents script execution but cannot
identify every visible advertising or tracking image; external images still
contact their publishers. Search uses escaped, parameterized ILIKE and is not
indexed full-text search; large libraries may eventually need an index. Explicit
extraction respects response/time limits and caching, and never bypasses paywalls
or authentication. There is no automatic source disabling: persistent failures
are signaled and the user can pause or resume a source.

Apply migration 0014 to the production database before deploying this code.
