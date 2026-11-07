import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

it('backfills earlier accepted equipment and service quotes without changing their agreements', async () => {
  const db = await PGlite.create();
  try {
    const root = join(__dirname, '../prisma/migrations');
    const latest = '20261106000000_booking_details';
    for (const migration of readdirSync(root).filter(name => name < latest && name.startsWith('20')).sort()) {
      await db.exec(readFileSync(join(root, migration, 'migration.sql'), 'utf8'));
    }
    await db.exec(`
      INSERT INTO "User" ("id", "name", "email", "passwordHash", "role") VALUES
        ('owner', 'Original Owner', 'owner@test.local', 'unused', 'OWNER'),
        ('renter', 'Original Renter', 'renter@test.local', 'unused', 'CUSTOMER');
      INSERT INTO "Equipment" ("id", "ownerId", "name", "category", "location", "rate", "capacity", "vendor", "description", "status", "updatedAt")
        VALUES (1, 'owner', 'Excavator', 'Heavy machinery', 'Lagos', 90000, '20 tonnes', 'Atlas', 'Site equipment', 'ARCHIVED', NOW());
      INSERT INTO "RentalRequest" ("id", "userId", "equipmentId", "title", "service", "location", "start", "days", "name", "email", "status", "quotedAmount", "quoteNotes", "updatedAt") VALUES
        ('old-rental', 'renter', 1, 'Original excavator', 'Equipment rental', 'Ikeja', '2028-02-28', 3, 'Site Contact', 'site@test.local', 'ACCEPTED', 250000, 'Delivery included', '2026-11-01T12:00:00Z'),
        ('old-service', 'renter', NULL, 'Site clearing', 'Site clearing & preparation', 'Ikeja', '2028-12-31', 1, 'Site Contact', 'site@test.local', 'ACCEPTED', 75000, NULL, '2026-11-02T12:00:00Z'),
        ('not-accepted', 'renter', 1, 'Excavator', 'Equipment rental', 'Ikeja', '2028-02-28', 3, 'Site Contact', 'site@test.local', 'DECLINED', 250000, 'Delivery included', NOW());
    `);
    await db.exec(readFileSync(join(root, latest, 'migration.sql'), 'utf8'));
    const { rows } = await db.query<Record<string, unknown>>('SELECT * FROM "Booking" ORDER BY "requestId"');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ requestId: 'old-rental', title: 'Original excavator', renterName: 'Site Contact', ownerId: 'owner', ownerEmail: 'owner@test.local', end: '2028-03-01', days: 3, agreedAmount: 250000, terms: 'Delivery included', status: 'AWAITING_CONFIRMATION', imported: true });
    expect(rows[1]).toMatchObject({ requestId: 'old-service', equipmentId: null, ownerId: null, vendor: 'ServiceLoop team', end: '2028-12-31', days: 1, terms: '', imported: true });
    expect(rows[0].reference).toMatch(/^SL-[A-F0-9]{12}$/);
    expect(rows[0].reference).not.toBe(rows[1].reference);
    await db.exec(readFileSync(join(root, '20261106010000_date_reservations', 'migration.sql'), 'utf8'));
    const migrated = await db.query<{ reservedAt: null; reservationExpiresAt: null; cancelledAt: null }>('SELECT "reservedAt", "reservationExpiresAt", "cancelledAt" FROM "Booking"');
    expect(migrated.rows).toEqual([{ reservedAt: null, reservationExpiresAt: null, cancelledAt: null }, { reservedAt: null, reservationExpiresAt: null, cancelledAt: null }]);
  } finally { await db.close(); }
});
