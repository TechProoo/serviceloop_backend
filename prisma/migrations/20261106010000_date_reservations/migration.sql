BEGIN;
ALTER TYPE "BookingStatus" ADD VALUE 'CANCELLED';
ALTER TABLE "Booking"
  ADD COLUMN "reservedAt" TIMESTAMP(3),
  ADD COLUMN "reservationExpiresAt" TIMESTAMP(3),
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD CONSTRAINT "Booking_reservation_window_check" CHECK (
    ("reservedAt" IS NULL AND "reservationExpiresAt" IS NULL) OR
    ("reservedAt" IS NOT NULL AND "reservationExpiresAt" IS NOT NULL AND "equipmentId" IS NOT NULL AND "reservationExpiresAt" > "reservedAt")
  );
CREATE INDEX "Booking_equipmentId_status_reservationExpiresAt_idx"
  ON "Booking"("equipmentId", "status", "reservationExpiresAt");
-- Earlier accepted quotes remain unreserved. Reserving them requires a fresh
-- availability check; silently backfilling holds could create overlaps.
COMMIT;
