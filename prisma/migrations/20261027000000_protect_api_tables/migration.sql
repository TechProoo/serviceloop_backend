-- All application access goes through the NestJS API, using its server-only
-- PostgreSQL role. Supabase browser roles must not access these tables directly.
BEGIN;
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Equipment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SavedEquipment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RentalRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WaitlistEntry" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "User", "Session", "Equipment", "SavedEquipment", "RentalRequest", "WaitlistEntry" FROM PUBLIC;
REVOKE ALL ON SEQUENCE "Equipment_id_seq" FROM PUBLIC;

DO $$
DECLARE client_role text;
BEGIN
  FOR client_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') LOOP
    EXECUTE format('REVOKE ALL ON TABLE public."User", public."Session", public."Equipment", public."SavedEquipment", public."RentalRequest", public."WaitlistEntry" FROM %I', client_role);
    EXECUTE format('REVOKE ALL ON SEQUENCE public."Equipment_id_seq" FROM %I', client_role);
    IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON TABLE public._prisma_migrations FROM %I', client_role);
    END IF;
  END LOOP;
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public._prisma_migrations FROM PUBLIC;
  END IF;
END $$;
COMMIT;
