import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { BookingsService } from '../src/bookings/bookings.service';

describe('ServiceLoop HTTP API with Prisma and PostgreSQL (PGlite)', () => {
  let app: INestApplication, db: PGlite, socket: PGLiteSocketServer, prisma: PrismaService;
  let owner: string, customer: string, stranger: string, admin: string, equipmentId: number, requestId: string, bookingId: string;
  const password = 'a-long-secure-password';
  beforeAll(async () => {
    db = await PGlite.create();
    // Simulate Supabase's browser roles and permissive legacy default grants.
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;');
    const migrations = join(__dirname, '../prisma/migrations');
    for (const entry of readdirSync(migrations, { withFileTypes: true }).filter(entry => entry.isDirectory()).sort((a,b) => a.name.localeCompare(b.name))) {
      await db.exec(readFileSync(join(migrations, entry.name, 'migration.sql'), 'utf8'));
    }
    socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 });
    await socket.start();
    process.env.DATABASE_URL = `postgresql://postgres:postgres@${socket.getServerConn()}/postgres`;
    process.env.DB_POOL_MAX = '1';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ bodyParser: false });
    configureApp(app); await app.init(); prisma = app.get(PrismaService);
  });
  afterAll(async () => { if (app) await app.close(); if (socket) await socket.stop(); if (db) await db.close(); });
  const api = () => request(app.getHttpServer());
  const token = (value: string) => `Bearer ${value}`;

  it('protects all application tables from direct Supabase browser-role access', async () => {
    const tables = ['User','Session','Equipment','SavedEquipment','RentalRequest','WaitlistEntry','Booking'];
    const protection = await prisma.$queryRaw<{ tablename: string; rowsecurity: boolean }[]>`SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public'`;
    for (const table of tables) {
      expect(protection.find(row => row.tablename === table)?.rowsecurity).toBe(true);
      for (const role of ['anon','authenticated']) {
        const grants = await prisma.$queryRaw<{ accessible: boolean }[]>`SELECT has_table_privilege(${role}, ${'public."' + table + '"'}, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS accessible`;
        expect(grants[0].accessible).toBe(false);
      }
    }
  });

  it('validates registration and prevents self-assigned administrator roles', async () => {
    await api().post('/api/auth/register').send({ name: 'Admin', email: 'bad@example.com', password, role: 'ADMIN' }).expect(400);
    for (const [email, role] of [['owner@example.com', 'OWNER'], ['customer@example.com', 'CUSTOMER'], ['stranger@example.com', 'OWNER'], ['admin@example.com', 'CUSTOMER']]) {
      const res = await api().post('/api/auth/register').send({ name: 'Test Account', email, password, role }).expect(201);
      if (email.startsWith('owner')) owner = res.body.accessToken;
      if (email.startsWith('customer')) customer = res.body.accessToken;
      if (email.startsWith('stranger')) stranger = res.body.accessToken;
      if (email.startsWith('admin')) admin = res.body.accessToken;
    }
    await prisma.user.update({ where: { email: 'admin@example.com' }, data: { role: 'ADMIN' } });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'owner@example.com' } });
    expect(user.passwordHash).not.toBe(password);
    expect(await prisma.session.count({ where: { tokenHash: owner } })).toBe(0);
    await api().post('/api/auth/login').send({ email: 'owner@example.com', password: 'incorrect-password' }).expect(401);
    await api().post('/api/auth/login').send({ email: 'OWNER@example.com', password }).expect(200);
  });

  it('enforces listing ownership, validation, moderation and catalog filters', async () => {
    const listing = { name: 'CAT Excavator', category: 'Heavy machinery', location: 'Lekki, Lagos', rate: 180000, capacity: '20 tonnes', operator: true, vendor: 'Atlas', description: 'Excavator for foundations' };
    await api().post('/api/equipment').set('Authorization', token(customer)).send(listing).expect(403);
    await api().post('/api/equipment').set('Authorization', token(owner)).send({ ...listing, operator: 'false' }).expect(400);
    await api().post('/api/equipment').set('Authorization', token(owner)).send({ ...listing, available: null }).expect(400);
    const created = await api().post('/api/equipment').set('Authorization', token(owner)).send(listing).expect(201);
    equipmentId = created.body.id; expect(created.body.status).toBe('PENDING');
    expect((await api().get('/api/equipment').expect(200)).body.total).toBe(0);
    await api().patch(`/api/equipment/${equipmentId}`).set('Authorization', token(stranger)).send({ rate: 1000 }).expect(403);
    await api().patch(`/api/admin/equipment/${equipmentId}`).set('Authorization', token(owner)).send({ status: 'PUBLISHED' }).expect(403);
    await api().patch(`/api/admin/equipment/${equipmentId}`).set('Authorization', token(admin)).send({ status: 'PUBLISHED' }).expect(200);
    expect((await api().get('/api/equipment?q=cat&location=Lagos&available=true&sort=price_asc').expect(200)).body.total).toBe(1);
    await api().get('/api/equipment?sort=__proto__').expect(400);
    await api().get('/api/equipment?limit=101').expect(400);
  });

  it('rejects invalid equipment IDs across public, owner, saved and admin routes', async () => {
    for (const id of ['0','-1','2147483648','999999999999999999999999','1.2','bad']) {
      await api().get(`/api/equipment/${id}`).expect(400);
      await api().patch(`/api/equipment/${id}`).set('Authorization', token(owner)).send({ rate: 1000 }).expect(400);
      await api().delete(`/api/equipment/${id}`).set('Authorization', token(owner)).expect(400);
      await api().put(`/api/me/saved/${id}`).set('Authorization', token(customer)).expect(400);
      await api().delete(`/api/me/saved/${id}`).set('Authorization', token(customer)).expect(400);
      await api().patch(`/api/admin/equipment/${id}`).set('Authorization', token(admin)).send({ status: 'PUBLISHED' }).expect(400);
    }
    await api().get('/api/equipment/2147483647').expect(404);
  });

  it('handles general project requests, ownership and admin quoting without equipment', async () => {
    const body = { title: 'Site clearing', service: 'Site clearing & preparation', location: 'Lagos', start: new Date(Date.now() + 86400000).toISOString().slice(0,10), days: 2 };
    const created = await api().post('/api/requests').set('Authorization', token(customer)).send(body).expect(201);
    expect(created.body.equipmentId).toBeNull(); expect(created.body.estimate).toBeNull();
    await api().patch(`/api/requests/${created.body.id}`).set('Authorization', token(owner)).send({ status: 'QUOTED', quotedAmount: 20000 }).expect(403);
    await api().patch(`/api/requests/${created.body.id}`).set('Authorization', token(admin)).send({ status: 'QUOTED', quotedAmount: 20000 }).expect(200);
    await api().patch(`/api/requests/${created.body.id}`).set('Authorization', token(customer)).send({ status: 'DECLINED' }).expect(200);
    expect(await prisma.booking.count({ where: { requestId: created.body.id } })).toBe(0);
  });

  it('returns validation errors for nulls, unexpected fields and oversized bodies', async () => {
    await api().get('/api/equipment?unknown=value').expect(400);
    await api().post('/api/auth/register').send({ name: null, email: 'invalid', password: null }).expect(400);
    await api().post('/api/requests').set('Authorization', token(customer)).send({ title: 'Work', location: 'Lagos', start: '2027-01-01', days: 1, notes: 'x'.repeat(70000) }).expect(413);
  });

  it('saves listings idempotently and keeps saved lists private', async () => {
    await api().put(`/api/me/saved/${equipmentId}`).set('Authorization', token(customer)).expect(200);
    await api().put(`/api/me/saved/${equipmentId}`).set('Authorization', token(customer)).expect(200);
    expect((await api().get('/api/me/saved').set('Authorization', token(customer))).body.total).toBe(1);
    expect((await api().get('/api/me/saved').set('Authorization', token(stranger))).body.total).toBe(0);
  });

  it('calculates estimates on the server and validates request ownership and state transitions', async () => {
    const brief = { equipmentId, location: 'Ikeja', start: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10), days: 3 };
    await api().post('/api/requests').set('Authorization', token(customer)).send({ ...brief, estimate: 1 }).expect(400);
    await api().post('/api/requests').set('Authorization', token(customer)).send({ ...brief, start: '2027-02-30' }).expect(400);
    const created = await api().post('/api/requests').set('Authorization', token(customer)).send(brief).expect(201);
    requestId = created.body.id; expect(created.body.estimate).toBe(540000);
    await api().get(`/api/requests/${requestId}`).set('Authorization', token(stranger)).expect(403);
    await api().patch(`/api/requests/${requestId}`).set('Authorization', token(customer)).send({ status: 'ACCEPTED' }).expect(409);
    await api().patch(`/api/requests/${requestId}`).set('Authorization', token(customer)).send({ status: 'QUOTED', quotedAmount: 600000 }).expect(403);
    await api().patch(`/api/requests/${requestId}`).set('Authorization', token(owner)).send({ status: 'QUOTED', quotedAmount: 600000, quoteNotes: 'Delivery and operator included. Fuel supplied by renter.' }).expect(200);
    const accepted = await api().patch(`/api/requests/${requestId}`).set('Authorization', token(customer)).send({ status: 'ACCEPTED' }).expect(200);
    bookingId = accepted.body.booking.id;
    expect(accepted.body.booking.reference).toMatch(/^SL-[A-F0-9]{12}$/);
    await api().patch(`/api/requests/${requestId}`).set('Authorization', token(owner)).send({ status: 'QUOTED', quotedAmount: 1 }).expect(409);
    expect((await api().get('/api/requests').set('Authorization', token(stranger))).body.total).toBe(0);
  });

  it('saves private, immutable booking details and makes acceptance retries idempotent', async () => {
    const booking = (await api().get(`/api/bookings/${bookingId}`).set('Authorization', token(customer)).expect(200)).body;
    expect(booking).toMatchObject({ requestId, equipmentId, title: 'CAT Excavator', agreedAmount: 600000, currency: 'NGN', days: 3, status: 'AWAITING_CONFIRMATION', vendor: 'Atlas', ownerEmail: 'owner@example.com', renterEmail: 'customer@example.com', terms: 'Delivery and operator included. Fuel supplied by renter.', imported: false });
    expect(Date.parse(booking.end) - Date.parse(booking.start)).toBe(2 * 86400000);
    await api().get('/api/bookings').expect(401);
    await api().get(`/api/bookings/${bookingId}`).expect(401);
    await api().get(`/api/bookings/${bookingId}`).set('Authorization', token(stranger)).expect(404);
    await api().get('/api/bookings/missing').set('Authorization', token(customer)).expect(404);
    expect((await api().get('/api/bookings').set('Authorization', token(stranger))).body.total).toBe(0);
    for (const account of [owner, customer, admin]) {
      expect((await api().get('/api/bookings?limit=1&offset=0').set('Authorization', token(account)).expect(200)).body.items[0].id).toBe(bookingId);
      expect((await api().get(`/api/bookings/${bookingId}`).set('Authorization', token(account)).expect(200)).body).toEqual({ ...booking, serverTime: expect.any(String) });
    }
    expect((await api().get('/api/bookings?limit=1&offset=1').set('Authorization', token(customer)).expect(200)).body.items).toHaveLength(0);
    await api().get('/api/bookings?limit=101').set('Authorization', token(customer)).expect(400);
    const retry = await api().patch(`/api/requests/${requestId}`).set('Authorization', token(customer)).send({ status: 'ACCEPTED' }).expect(200);
    expect(retry.body.booking.id).toBe(bookingId);
    expect(await prisma.booking.count({ where: { requestId } })).toBe(1);
    await api().patch(`/api/requests/${requestId}`).set('Authorization', token(owner)).send({ status: 'ACCEPTED' }).expect(403);
    await api().patch(`/api/bookings/${bookingId}`).set('Authorization', token(customer)).send({ agreedAmount: 1 }).expect(404);
    await prisma.equipment.update({ where: { id: equipmentId }, data: { name: 'Renamed excavator', rate: 220000, vendor: 'New vendor', operator: false } });
    expect((await api().get(`/api/bookings/${bookingId}`).set('Authorization', token(owner)).expect(200)).body).toEqual({ ...booking, serverTime: expect.any(String) });
    // A date-specific hold must not disable the listing for all other dates.
    expect((await prisma.equipment.findUniqueOrThrow({ where: { id: equipmentId } })).available).toBe(true);
  });

  it('rejects stale quote acceptance and rolls back the decision when booking creation fails', async () => {
    const created = await api().post('/api/requests').set('Authorization', token(customer)).send({ equipmentId, location: 'Lagos', start: '2028-02-28', days: 3 }).expect(201);
    const id = created.body.id;
    const earlierQuote = await api().patch(`/api/requests/${id}`).set('Authorization', token(owner)).send({ status: 'QUOTED', quotedAmount: 90000 }).expect(200);
    const quote = await api().patch(`/api/requests/${id}`).set('Authorization', token(owner)).send({ status: 'QUOTED', quotedAmount: 10000000000 }).expect(200);
    await api().patch(`/api/requests/${id}`).set('Authorization', token(customer)).send({ status: 'ACCEPTED', expectedUpdatedAt: earlierQuote.body.updatedAt }).expect(409);
    expect(await prisma.booking.count({ where: { requestId: id } })).toBe(0);
    const failing = jest.spyOn(app.get(BookingsService), 'record').mockRejectedValueOnce(new Error('Test booking write failure'));
    try { await api().patch(`/api/requests/${id}`).set('Authorization', token(customer)).send({ status: 'ACCEPTED', expectedUpdatedAt: quote.body.updatedAt }).expect(500); }
    finally { failing.mockRestore(); }
    expect((await prisma.rentalRequest.findUniqueOrThrow({ where: { id } })).status).toBe('QUOTED');
    expect(await prisma.booking.count({ where: { requestId: id } })).toBe(0);
    const accepted = await api().patch(`/api/requests/${id}`).set('Authorization', token(customer)).send({ status: 'ACCEPTED', expectedUpdatedAt: quote.body.updatedAt }).expect(200);
    const booking = (await api().get(`/api/bookings/${accepted.body.booking.id}`).set('Authorization', token(customer))).body;
    expect(booking.end).toBe('2028-03-01'); expect(booking.agreedAmount).toBe(10000000000);
  });

  it('creates one booking under concurrent acceptance and supports general service quotes', async () => {
    const created = await api().post('/api/requests').set('Authorization', token(customer)).send({ title: 'Site clearing', service: 'Site clearing & preparation', location: 'Lagos', start: '2028-12-31', days: 1 }).expect(201);
    const id = created.body.id;
    await api().patch(`/api/requests/${id}`).set('Authorization', token(admin)).send({ status: 'QUOTED', quotedAmount: 90000 }).expect(200);
    const responses = await Promise.all([1,2].map(() => api().patch(`/api/requests/${id}`).set('Authorization', token(customer)).send({ status: 'ACCEPTED' })));
    expect(responses.some(response => response.status === 200)).toBe(true);
    expect(responses.every(response => [200,409].includes(response.status))).toBe(true);
    expect(await prisma.booking.count({ where: { requestId: id } })).toBe(1);
    const booking = await prisma.booking.findUniqueOrThrow({ where: { requestId: id } });
    expect(booking).toMatchObject({ equipmentId: null, ownerId: null, vendor: 'ServiceLoop team', terms: '', start: '2028-12-31', end: '2028-12-31' });
    await api().get(`/api/bookings/${booking.id}`).set('Authorization', token(admin)).expect(200);
    await api().get(`/api/bookings/${booking.id}`).set('Authorization', token(owner)).expect(404);
  });

  it('deduplicates waitlist phone numbers without anonymous overwrites or membership disclosure', async () => {
    const first = await api().post('/api/waitlist').send({ name: 'Builder', phone: '08012345678', email: 'builder@example.com', role: 'Builder / Contractor', wantToRent: ['Crane'] }).expect(202);
    const duplicate = await api().post('/api/waitlist').send({ name: 'Other', phone: '+2348012345678' }).expect(202);
    expect(first.body).toEqual(duplicate.body);
    await api().get('/api/admin/waitlist').set('Authorization', token(customer)).expect(403);
    const entries = await api().get('/api/admin/waitlist').set('Authorization', token(admin)).expect(200);
    expect(entries.body.total).toBe(1); expect(entries.body.items[0].name).toBe('Builder');
    expect(entries.body.items[0].email).toBe('builder@example.com'); expect(entries.body.items[0].role).toBe('Builder / Contractor');
  });

  it('archives equipment while preserving quote history', async () => {
    await api().delete(`/api/equipment/${equipmentId}`).set('Authorization', token(owner)).expect(200);
    expect((await api().get('/api/equipment')).body.total).toBe(0);
    expect((await api().get(`/api/requests/${requestId}`).set('Authorization', token(customer))).body.status).toBe('ACCEPTED');
    expect((await api().get(`/api/bookings/${bookingId}`).set('Authorization', token(customer)).expect(200)).body.title).toBe('CAT Excavator');
    await api().patch(`/api/admin/equipment/${equipmentId}`).set('Authorization', token(admin)).send({ status: 'PUBLISHED' }).expect(409);
  });

  it('changes passwords atomically and revokes existing sessions', async () => {
    await api().patch('/api/auth/password').set('Authorization', token(stranger)).send({ currentPassword: password, newPassword: 'another-secure-password' }).expect(200);
    await api().get('/api/auth/me').set('Authorization', token(stranger)).expect(401);
    await api().post('/api/auth/login').send({ email: 'stranger@example.com', password }).expect(401);
    await api().post('/api/auth/login').send({ email: 'stranger@example.com', password: 'another-secure-password' }).expect(200);
    await api().post('/api/auth/logout').set('Authorization', token(customer)).expect(200);
    await api().get('/api/auth/me').set('Authorization', token(customer)).expect(401);
  });

  it('rejects expired sessions while leaving other accounts signed in', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'owner@example.com' } });
    await prisma.session.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(0) } });
    await api().get('/api/auth/me').set('Authorization', token(owner)).expect(401);
    await api().get('/api/auth/me').set('Authorization', token(admin)).expect(200);
  });

  it('restores cookie sessions after reload and blocks cookie-authenticated writes from untrusted origins', async () => {
    const login = await api().post('/api/auth/login').send({ email: 'admin@example.com', password }).expect(200);
    const cookies = login.headers['set-cookie'] as unknown as string[];
    expect(cookies[0]).toContain('HttpOnly');
    const cookie = cookies[0].split(';')[0];
    await api().get('/api/auth/me').set('Cookie', cookie).expect(200);
    await api().post('/api/auth/logout').set('Cookie', cookie).expect(403);
    await api().post('/api/auth/logout').set('Cookie', cookie).set('Origin', 'https://untrusted.example').expect(403);
    const logout = await api().post('/api/auth/logout').set('Cookie', cookie).set('Origin', 'http://localhost:5173').expect(200);
    expect(String(logout.headers['set-cookie'])).toContain('Expires=Thu, 01 Jan 1970');
    await api().get('/api/auth/me').set('Cookie', cookie).expect(401);
  });

  it('rejects malformed input, disallowed origins and excessive waitlist submissions', async () => {
    await api().post('/api/auth/login').set('Content-Type', 'application/json').send('{').expect(400);
    await api().get('/api/health').set('Origin', 'https://untrusted.example').expect(403);
    await api().get('/api/health').set('Origin', 'http://localhost:5173').expect(200);
    for (let i = 0; i < 3; i++) await api().post('/api/waitlist').send({ name: 'Builder', phone: '08012345678' }).expect(202);
    const limited = await api().post('/api/waitlist').send({ name: 'Builder', phone: '08012345678' }).expect(429);
    expect(limited.headers['retry-after']).toBe('60');
  });
});
