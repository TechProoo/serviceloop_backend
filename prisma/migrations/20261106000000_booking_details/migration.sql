BEGIN;

CREATE TYPE "BookingStatus" AS ENUM ('AWAITING_CONFIRMATION');
CREATE TABLE "Booking" (
  "id" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "renterId" TEXT NOT NULL,
  "ownerId" TEXT,
  "equipmentId" INTEGER,
  "title" TEXT NOT NULL,
  "service" TEXT NOT NULL,
  "equipmentCategory" TEXT,
  "capacity" TEXT,
  "image" TEXT NOT NULL DEFAULT '',
  "equipmentLocation" TEXT,
  "operator" BOOLEAN,
  "vendor" TEXT NOT NULL,
  "ownerName" TEXT,
  "ownerEmail" TEXT,
  "renterName" TEXT NOT NULL,
  "renterEmail" TEXT NOT NULL,
  "location" TEXT NOT NULL,
  "start" TEXT NOT NULL,
  "end" TEXT NOT NULL,
  "days" INTEGER NOT NULL,
  "agreedAmount" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'NGN',
  "terms" TEXT NOT NULL DEFAULT '',
  "notes" TEXT NOT NULL DEFAULT '',
  "status" "BookingStatus" NOT NULL DEFAULT 'AWAITING_CONFIRMATION',
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "imported" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "Booking_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Booking_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "RentalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Booking_renterId_fkey" FOREIGN KEY ("renterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Booking_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Booking_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Booking_reference_key" ON "Booking"("reference");
CREATE UNIQUE INDEX "Booking_requestId_key" ON "Booking"("requestId");
CREATE INDEX "Booking_renterId_acceptedAt_idx" ON "Booking"("renterId", "acceptedAt");
CREATE INDEX "Booking_ownerId_acceptedAt_idx" ON "Booking"("ownerId", "acceptedAt");
CREATE INDEX "Booking_equipmentId_idx" ON "Booking"("equipmentId");

-- Earlier accepted quotes retain their agreed price, dates and terms. Their
-- equipment/contact snapshots reflect migration time, as labelled in the UI.
INSERT INTO "Booking" (
  "id", "reference", "requestId", "renterId", "ownerId", "equipmentId",
  "title", "service", "equipmentCategory", "capacity", "image", "equipmentLocation", "operator",
  "vendor", "ownerName", "ownerEmail", "renterName", "renterEmail", "location",
  "start", "end", "days", "agreedAmount", "terms", "notes", "acceptedAt", "imported"
)
SELECT 'legacy_' || r."id", 'SL-' || upper(substr(md5(r."id"), 1, 12)), r."id", r."userId", e."ownerId", r."equipmentId",
  r."title", r."service", e."category", e."capacity", coalesce(e."image", ''), e."location", e."operator",
  coalesce(e."vendor", 'ServiceLoop team'), u."name", u."email", r."name", r."email", r."location",
  r."start", to_char(r."start"::date + (r."days" - 1), 'YYYY-MM-DD'), r."days", r."quotedAmount",
  coalesce(r."quoteNotes", ''), r."notes", r."updatedAt", true
FROM "RentalRequest" r
LEFT JOIN "Equipment" e ON e."id" = r."equipmentId"
LEFT JOIN "User" u ON u."id" = e."ownerId"
WHERE r."status" = 'ACCEPTED' AND r."quotedAmount" IS NOT NULL;

ALTER TABLE "Booking" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "Booking" FROM PUBLIC;
DO $$
DECLARE client_role text;
BEGIN
  FOR client_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format('REVOKE ALL ON TABLE public."Booking" FROM %I', client_role);
  END LOOP;
END $$;
COMMIT;
