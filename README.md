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

The requester can then send `{ "status": "ACCEPTED" }`, `DECLINED` or `CANCELLED`. Submitted requests can also be cancelled before quoting. Terminal states cannot be changed. Updates check the prior version so concurrent changes cannot silently overwrite each other. Acceptance records a quote decision; it does not collect payment or reserve dates.

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

Payments/escrow, confirmed rental reservations, identity verification, file uploads, password recovery and provider notifications are not implemented. No emails or provider messages are sent when a request is submitted.
#   s e r v i c e l o o p _ b a c k e n d  
 