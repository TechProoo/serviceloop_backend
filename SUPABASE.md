# Supabase connection

Prisma is already installed and initialized. The backend uses Prisma 7 with the PostgreSQL driver adapter; do not run `prisma init` again.

The backend reads `backend/.env`, not `.env.local`. A project-specific `.env` has been prepared using the supplied transaction pooler (6543) and session pooler (5432) URLs. Replace `[YOUR-PASSWORD]` in **both** URLs with your URL-encoded Supabase database password. This is the PostgreSQL password, not an anon, publishable or service-role API key.

`src/prisma/prisma.service.ts` uses `DATABASE_URL` for runtime traffic. `prisma.config.ts` prefers `DIRECT_URL` for migration commands. Browser apps continue to call the Nest API and do not need database credentials.

After entering the password, run from `backend/`:

```powershell
npm run db:deploy
npm run build
npm start
```

The committed migrations create the ServiceLoop tables. Check that this is the intended database before applying them. The optional local Docker database remains available through the original `.env.example`.

Verified October 27, 2026: both Supabase connection modes work and all three ServiceLoop migrations have been applied. The six application tables have row-level security enabled and no direct browser-role access. See BACKEND_VERIFICATION.md for the test results.

References: [Supabase Prisma guide](https://supabase.com/docs/guides/database/prisma), [pooler connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres).
