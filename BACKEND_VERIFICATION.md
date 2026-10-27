# ServiceLoop backend verification — October 27, 2026

All checks below passed after the fixes described here. This records observed results, not a guarantee that every possible defect has been eliminated.

## Issues resolved

- The configured Supabase database had no application tables. Applied the initial schema, waitlist contact fields, and API-table protection migrations. No application records were deleted or seeded into Supabase.
- Equipment route parameters accepted integers outside PostgreSQL's supported ID range. Added a shared validation pipe across public, owner, saved-equipment and moderation routes. Invalid IDs now return 400 instead of reaching Prisma.
- Protected the six application tables with row-level security and revoked direct table/sequence privileges from Supabase browser roles. The Nest API's server connection remains functional. Migration metadata is protected too.
- Updated compatible NestJS 11 packages and pinned Multer to 2.5.0 through an npm override to resolve its runtime advisory.

## Results

| Check | Result |
| --- | --- |
| Prisma client generation and backend TypeScript build | Passed |
| Backend HTTP integration suite using real Prisma/PostgreSQL (PGlite) | 14 tests passed |
| Frontend production build and ESLint | Passed |
| Connected marketplace and both waitlist browser suites | 6 tests passed |
| npm installation dependency audit after patch | 0 known vulnerabilities |
| Supabase transaction-mode runtime connection | Passed |
| Supabase session-mode migration connection | Passed |
| Expected application tables | All six present |
| Migration history | All three applied; none failed, pending or checksum-mismatched |
| RLS and browser-role privileges on application tables | Enabled; no direct browser-role table access |
| Live Nest API read-only checks | 8 responses matched expected 200/400/401 statuses |
| Live Prisma model queries | All six succeeded |

Live checks covered health, equipment, service/category metadata, validation and authentication rejection. Account creation, passwords, sessions, quote transitions, saved lists, moderation and waitlist submissions were exercised against disposable PostgreSQL databases. No synthetic accounts or listings were inserted into the live Supabase database.

## Scope

This verifies the implemented API and connected browser workflows. It does not constitute a load test, a penetration test, or verification of production HTTPS/reverse-proxy hosting. Payments, confirmed rental reservations, identity verification, uploads, password recovery and outbound provider notifications remain outside the current implementation as documented in README.md.

The test runner prints a Node VM-modules experimental notice, and browser tooling may print color-environment notices; these are tooling warnings, not test failures.

Database access controls follow the [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security). Database credentials were neither printed nor added to version control.
