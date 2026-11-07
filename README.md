# ServiceLoop backend

NestJS + Prisma + PostgreSQL API for the ServiceLoop equipment rental marketplace and launch waitlist. Separate from the PropertyLoop backend. Includes accounts, revocable sessions, equipment search, owner inventory, saved listings, quote workflows, listing moderation and waitlist administration.

## Local setup

Requires Node.js 22.12+ and PostgreSQL (or Docker).

```powershell
cd backend
npm install
Copy-Item .env.example .env
docker compose up -d
npm run db:deploy
npm run build
npm start
```

If PostgreSQL is already running, set `DATABASE_URL` in `.env` instead of using Docker. The local Compose service uses port 5433 to avoid conflicting with another PostgreSQL server. Replace the development password before deploying. The API defaults to `http://127.0.0.1:3001/api`. `npm run start:dev` runs the TypeScript entry point directly after `npm run prisma:generate`.

The Prisma 7 client is generated in `generated/prisma`, and the application connects through `@prisma/adapter-pg`. `prisma.config.ts` supplies the migration connection; optional `DIRECT_URL` overrides `DATABASE_URL` for migration commands. Run `npm run db:migrate -- --name change_name` when changing the schema and commit the generated SQL migration. `db:deploy` applies existing committed migrations without resetting data.

## Tests

```powershell
npm run build
npm test
```

HTTP integration tests boot the real Nest application, generated Prisma client and PostgreSQL adapter against a temporary in-memory PGlite PostgreSQL server, applying the committed migration first. They do not touch the configured production database. Tests cover validation, access controls, server-side pricing, quote state transitions, moderation, password/session revocation, waitlist deduplication and rate limits.

## Authentication

`POST /api/auth/register`:

```json
{
  "name": "Atlas Equipment",
  "email": "owner@example.com",
  "password": "choose-a-long-unique-password",
  "role": "OWNER"
}
```

Registration accepts `CUSTOMER` (default) or `OWNER`; clients cannot grant themselves administrator access. `POST /api/auth/login` takes `email` and `password`. Both return `{ user, accessToken, expiresAt }`. Send `Authorization: Bearer <accessToken>` on authenticated routes. Session tokens are cryptographically random, only their SHA-256 hashes are stored, and validity is checked in PostgreSQL on every authenticated request. Passwords use salted scrypt. Passwords require 12–128 characters.

The browser keeps access tokens in memory and restores sessions using an HttpOnly cookie. Cookie-authenticated writes require a trusted Origin. Password recovery email is not implemented. No shared secrets or default administrator accounts are installed.

To promote an existing account locally on the server:

```powershell
npm run admin:promote -- admin@example.com
```

## API

| Method | Endpoint | Access / behavior |
| --- | --- | --- |
| GET | `/api/health` | Database health |
| GET | `/api/categories` | Equipment categories |
| GET | `/api/services` | Project support services |
| POST | `/api/auth/register` | Register |
| POST | `/api/auth/login` | Sign in |
| GET | `/api/auth/me` | Current account |
| POST | `/api/auth/logout` | Revoke current session immediately |
| POST | `/api/auth/logout-all` | Revoke every account session |
| PATCH | `/api/auth/password` | `{ currentPassword, newPassword }`; revokes all sessions |
| GET | `/api/equipment` | Public approved inventory |
| GET | `/api/equipment/:id` | Public approved listing |
| POST | `/api/equipment` | Owner creates pending listing |
| PATCH | `/api/equipment/:id` | Owner changes `rate` and/or `available` |
| DELETE | `/api/equipment/:id` | Owner archives listing |
| GET | `/api/me/equipment` | Your pending, published and archived inventory |
| GET | `/api/me/saved` | Your saved public listings |
| PUT | `/api/me/saved/:id` | Save idempotently |
| DELETE | `/api/me/saved/:id` | Unsave |
| POST | `/api/requests` | Submit authenticated quote request |
| GET | `/api/requests` | Requests you made or received for your equipment |
| GET | `/api/requests/:id` | Requester, equipment owner or admin only |
| PATCH | `/api/requests/:id` | Quote, accept, decline or cancel |
| POST | `/api/waitlist` | Public signup |
| GET | `/api/admin/equipment` | Admin inventory review |
| PATCH | `/api/admin/equipment/:id` | Admin publishes or rejects |
| GET | `/api/admin/requests` | Admin request queue |
| GET | `/api/admin/waitlist` | Admin signup list |

List routes return `{ items, total }` and accept `limit` (1–100; default 20) and `offset`. Equipment search also returns the pagination values and accepts `q`, `category`, `location`, `available=true|false`, `minRate`, `maxRate`, and `sort=newest|price_asc|price_desc`. IDs for equipment are integers; account and request IDs are strings. Prices are whole Nigerian naira.

### Equipment

```json
{
  "name": "CAT 320 Excavator",
  "category": "Heavy machinery",
  "location": "Lekki, Lagos",
  "rate": 180000,
  "image": "",
  "capacity": "20 tonnes",
  "operator": true,
  "available": true,
  "vendor": "Atlas Equipment",
  "description": "20-tonne excavator for foundations and earthmoving."
}
```

Rates must be integers between 1,000 and 10,000,000. Optional image references must use HTTPS; uploads are not implemented. New inventory starts as `PENDING`. Admin sends `{ "status": "PUBLISHED" }` or `{ "status": "REJECTED" }` to the moderation endpoint. Archiving hides a listing while retaining quote history, and cannot be undone by moderation. Approval is an inventory review status, not a claim of identity verification.

### Quotes

```json
{
  "equipmentId": 1,
  "location": "Ikeja, Lagos",
  "start": "2027-01-20",
  "days": 3,
  "name": "Project Contact",
  "email": "contact@example.com",
  "notes": "Please include mobilisation."
}
```

Name/email default to the authenticated account. Start must be a valid date today or later in Nigeria. Duration is 1–365 days. The server snapshots the equipment title and computes `estimate = rate × days`; client-supplied estimates are rejected. Equipment must be published and available. For a general project request, omit `equipmentId`, supply `title`, and optionally set `service` to `Equipment rental`, `Multiple equipment & services`, or a title from `/api/services`. General requests appear in the admin queue.

Equipment owners or admins quote using:

```json
{ "status": "QUOTED", "quotedAmount": 600000, "quoteNotes": "Includes delivery" }
```

The requester can then send `{ "status": "ACCEPTED", "expectedUpdatedAt": "<quote updatedAt>" }`, `DECLINED` or `CANCELLED`. The optional version is supplied by the frontend to prevent accepting a quote revised since it was displayed. Submitted requests can also be cancelled before quoting. Terminal states cannot be changed; retrying acceptance returns the same booking. Updates check the prior version so concurrent changes cannot silently overwrite each other.

### Booking details

Accepting a quote creates its booking in the same database transaction. A failed booking write leaves the request quoted. Each request has at most one booking, and acceptance returns `booking: { id, reference }` alongside the request. Request list/detail responses include this link (`null` before acceptance).

- `GET /api/bookings?limit=20&offset=0` lists bookings belonging to the signed-in renter or owner. Administrators can list all bookings.
- `GET /api/bookings/:id` returns the agreed details to those same parties. Other accounts and nonexistent IDs receive 404; unauthenticated requests receive 401.
- Booking references use `SL-` followed by 12 uppercase hexadecimal characters. Internal IDs remain opaque strings.
- Equipment specifications, provider/renter contacts, location, agreed price (whole NGN), quote terms and project notes are stored as snapshots. Later listing edits or archiving do not alter them.
- `start` and `end` are inclusive calendar dates: `end = start + days - 1`. Handover times are not assumed. General service quotes have no equipment/owner ID and use ServiceLoop as provider.
- Status starts as `AWAITING_CONFIRMATION`. Cancelling changes it to `CANCELLED` and preserves the accepted quote details. Equipment bookings also have a separate temporary date-reservation state; payment and final rental confirmation are not implemented yet.

Deploy migration `20261106000000_booking_details` with `npm run db:deploy` before starting the new API/frontend. It also creates booking records for earlier accepted quotes. Their `imported` flag indicates equipment/contact details reflect migration-time data; the agreed quote amount, dates and terms are retained. Booking tables have the same RLS and browser-role restrictions as the other API tables.

Tests cover access controls, pagination, retained details after listing changes/archiving, duplicate and concurrent acceptance, stale quotes, transaction rollback, leap-year/single-day dates, general service quotes and migration of older agreements.

### Date reservations

Accepting an equipment quote creates a **2-hour hold** on every rental day, including the first and last day. Requests themselves do not reserve equipment. Acceptance rechecks listing availability and overlapping holds; if a conflict is found it returns 409 and the request stays quoted, with no booking created. The equipment's general `available` flag is not changed, so other dates remain bookable.

- `GET /api/equipment/:id/availability?start=YYYY-MM-DD&days=3` is public and checks the full interval. It returns `available`, `reason` (`RESERVED`, `UNAVAILABLE`, or `null`), the requested start/end, `checkedAt`, and `holdHours: 2`. It never returns another renter's booking or contact details. This is an availability check, not a guarantee or reservation.
- `POST /api/bookings/:id/reserve` lets the renter (or an administrator) reserve an older unreserved booking or retry after expiry. It checks dates and availability again. Retrying a live hold returns its original deadline; it does not extend the hold. Cancelled bookings cannot be reserved again. Owners cannot initiate holds on behalf of renters.
- `POST /api/bookings/:id/cancel` lets the renter, owner, or administrator cancel and release the dates immediately. Repeating cancellation preserves the original cancellation time. The original request remains accepted as a record of the quote decision.
- Responses include `reservedAt`, `reservationExpiresAt`, `cancelledAt`, `reservationState`, `serverTime`, and `holdHours`. States are `NONE`, `HELD`, `EXPIRED`, `CANCELLED`, and `NOT_APPLICABLE` (general service quotes without equipment).

Expiry is based on the database clock: only uncancelled holds whose deadline is still in the future block availability. No browser, timer job, or background worker is required to release expired dates. The frontend shows a countdown using server time and refreshes when the window regains focus. A new hold after expiry is subject to availability.

Hold/cancel mutations serialize on the equipment row using `FOR NO KEY UPDATE` in a `READ COMMITTED` transaction. This lock conflicts with other holds while allowing the key-share locks from request/booking foreign keys. The overlap query runs after acquiring the lock, using fresh database time. Future payment/confirmation code must use this same locking path when turning a temporary hold into a confirmed reservation.

Apply `20261106010000_date_reservations` with `npm run db:deploy`, then rebuild/restart the API before using the updated frontend. Existing accepted bookings remain unreserved and can request a hold explicitly; migrating them does not silently block dates. Date validation uses Nigeria time and whole inclusive calendar days. Rentals on the day immediately after another rental ends do not overlap.

Reservation integration tests cover overlapping ranges, shared end dates, adjacent rentals, competing acceptances, exactly two-hour deadlines, idempotent retries, expiry without browser activity, cancellation, authorization, archived/unavailable inventory, and earlier unreserved records. They use a disposable PGlite database; no live data is modified.

### Waitlist

```json
{
  "name": "Project Builder",
  "phone": "08012345678",
  "wantToRent": ["Excavators", "Generators"],
  "wantToList": ["Cranes"]
}
```

Matches the existing waitlist form. Nigerian local phone numbers are normalized to `+234`; international numbers require a country code. Duplicate numbers receive the same generic 202 response and cannot anonymously overwrite the original signup. Signup details are available only through the authenticated admin list.

## Frontend integration

The marketplace and both waitlist entry points now call this API. Vite proxies local /api requests to port 3001. Set VITE_API_URL to the HTTPS backend URL for production and add frontend origins to CORS_ORIGINS. Browser sessions use HttpOnly cookies; SESSION_COOKIE_SAMESITE defaults to lax. Use none only with production HTTPS for cross-site hosting. Public inventory contains approved database listings; demo fixtures are not served.

Supabase setup is pending. Add the server-only PostgreSQL connection string as DATABASE_URL in backend/.env when ready. An optional DIRECT_URL can supply a direct or session-pooler connection for Prisma migrations. No Supabase anon or service-role API key is required for this Prisma connection.

## Deployment

Use a persistent PostgreSQL database and HTTPS reverse proxy. Set `DATABASE_URL`, `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT`, and explicit comma-separated `CORS_ORIGINS`. Configure `SESSION_DAYS` (greater than 0, at most 30; default 7) and optional `DB_POOL_MAX` (default 10). `npm run start:prod` applies migrations then starts the compiled server; run the build first. Back up PostgreSQL and test restoration.

Validation rejects unknown fields and invalid types. JSON bodies are limited to 64 KiB. Helmet adds security headers. Rate limits are in memory per process: use edge limits or shared storage when scaling. The application does not trust arbitrary forwarding headers, so configure proxy-aware limits at your edge. Errors omit internal database details. CORS restricts browser origins; it is not authentication.

Payments/escrow, conversion of temporary holds into confirmed rentals, identity verification, file uploads, password recovery and provider notifications are not implemented. No emails or provider messages are sent when a request is submitted.
#   s e r v i c e l o o p _ b a c k e n d  
 
