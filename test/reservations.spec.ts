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

describe('Equipment date reservations', () => {
  let app: INestApplication, db: PGlite, socket: PGLiteSocketServer, prisma: PrismaService;
  let owner: string, renter: string, other: string, ownerId: string;
  const date = (offset: number) => new Date(Date.now() + (10 + offset) * 86400000).toISOString().slice(0,10);
  const api = () => request(app.getHttpServer());
  const auth = (token: string) => `Bearer ${token}`;

  beforeAll(async () => {
    db = await PGlite.create();
    const migrations = join(__dirname, '../prisma/migrations');
    for (const entry of readdirSync(migrations, { withFileTypes: true }).filter(entry => entry.isDirectory()).sort((a,b) => a.name.localeCompare(b.name))) {
      await db.exec(readFileSync(join(migrations, entry.name, 'migration.sql'), 'utf8'));
    }
    socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 }); await socket.start();
    process.env.DATABASE_URL = `postgresql://postgres:postgres@${socket.getServerConn()}/postgres`;
    process.env.DB_POOL_MAX = '1';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ bodyParser: false }); configureApp(app); await app.init(); prisma = app.get(PrismaService);
    for (const email of ['owner@dates.test','renter@dates.test','other@dates.test']) {
      const result = await api().post('/api/auth/register').send({ name: email.split('@')[0], email, password: 'reservation-test-password', role: email.startsWith('owner') ? 'OWNER' : 'CUSTOMER' }).expect(201);
      if (email.startsWith('owner')) { owner = result.body.accessToken; ownerId = result.body.user.id; }
      else if (email.startsWith('renter')) renter = result.body.accessToken;
      else other = result.body.accessToken;
    }
  });
  afterAll(async () => { if (app) await app.close(); if (socket) await socket.stop(); if (db) await db.close(); });
  async function equipment() {
    return prisma.equipment.create({ data: { ownerId, name: 'Reservation excavator', category: 'Heavy machinery', location: 'Lagos', rate: 100000, capacity: '20 tonnes', vendor: 'Atlas', description: 'Reservation test equipment', status: 'PUBLISHED' } });
  }
  async function quote(equipmentId: number, offset = 0, days = 3, account = renter) {
    const created = await api().post('/api/requests').set('Authorization', auth(account)).send({ equipmentId, start: date(offset), days, location: 'Lagos' }).expect(201);
    await api().patch(`/api/requests/${created.body.id}`).set('Authorization', auth(owner)).send({ status: 'QUOTED', quotedAmount: 400000, quoteNotes: 'Delivery included' }).expect(200);
    return created.body.id as string;
  }
  const accept = (id: string, account = renter) => api().patch(`/api/requests/${id}`).set('Authorization', auth(account)).send({ status: 'ACCEPTED' });
  const availability = (id: number, offset = 0, days = 3) => api().get(`/api/equipment/${id}/availability?start=${date(offset)}&days=${days}`);
  const detail = (id: string) => api().get(`/api/bookings/${id}`).set('Authorization', auth(renter));

  it('holds all inclusive rental dates for exactly two hours and blocks every overlapping shape', async () => {
    const item = await equipment();
    const main = await quote(item.id);
    const overlaps = await Promise.all([[0,3],[1,1],[2,2],[-1,5]].map(([start, days]) => quote(item.id, start, days, other)));
    const adjacent = await quote(item.id, 3, 1, other);
    const accepted = await accept(main).expect(200), id = accepted.body.booking.id;
    const booking = (await detail(id).expect(200)).body;
    expect(booking.reservationState).toBe('HELD'); expect(booking.holdHours).toBe(2);
    expect(Date.parse(booking.reservationExpiresAt) - Date.parse(booking.reservedAt)).toBe(7200000);
    expect((await availability(item.id).expect(200)).body).toMatchObject({ available: false, reason: 'RESERVED' });
    expect(Object.keys((await availability(item.id).expect(200)).body).sort()).toEqual(['available','checkedAt','end','equipmentId','holdHours','reason','start'].sort());
    for (const requestId of overlaps) {
      await accept(requestId, other).expect(409);
      expect((await prisma.rentalRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe('QUOTED');
      expect(await prisma.booking.count({ where: { requestId } })).toBe(0);
    }
    await api().post('/api/requests').set('Authorization', auth(other)).send({ equipmentId: item.id, start: date(1), days: 1, location: 'Lagos' }).expect(409);
    expect((await availability(item.id, 3, 1)).body.available).toBe(true);
    await accept(adjacent, other).expect(200);
    const independent = await equipment();
    expect((await availability(independent.id)).body.available).toBe(true);
    const repeated = await api().post(`/api/bookings/${id}/reserve`).set('Authorization', auth(renter)).expect(201);
    expect(repeated.body.reservationExpiresAt).toBe(booking.reservationExpiresAt);
    await accept(main).expect(200);
    expect((await detail(id)).body.reservationExpiresAt).toBe(booking.reservationExpiresAt);
  });

  it('chooses one winner when two renters accept competing quotes at the same time', async () => {
    const item = await equipment(), first = await quote(item.id), second = await quote(item.id, 0, 3, other);
    const results = await Promise.all([accept(first), accept(second, other)]);
    expect(results.map(result => result.status).sort()).toEqual([200,409]);
    expect(await prisma.booking.count({ where: { equipmentId: item.id } })).toBe(1);
    const loser = results[0].status === 409 ? first : second;
    expect((await prisma.rentalRequest.findUniqueOrThrow({ where: { id: loser } })).status).toBe('QUOTED');
  });

  it('expires holds without browser activity and rechecks availability before allowing another hold', async () => {
    const item = await equipment(), first = await quote(item.id), second = await quote(item.id, 0, 3, other);
    const accepted = await accept(first).expect(200), id = accepted.body.booking.id;
    await prisma.booking.update({ where: { id }, data: { reservedAt: new Date(Date.now() - 7200001), reservationExpiresAt: new Date(Date.now() - 1) } });
    expect((await detail(id)).body.reservationState).toBe('EXPIRED');
    expect((await availability(item.id)).body.available).toBe(true);
    const winner = await accept(second, other).expect(200);
    await api().post(`/api/bookings/${id}/reserve`).set('Authorization', auth(renter)).expect(409);
    await api().post(`/api/bookings/${winner.body.booking.id}/cancel`).set('Authorization', auth(owner)).expect(201);
    const renewed = await api().post(`/api/bookings/${id}/reserve`).set('Authorization', auth(renter)).expect(201);
    expect(renewed.body.reservationState).toBe('HELD');
    expect(Date.parse(renewed.body.reservationExpiresAt) - Date.parse(renewed.body.reservedAt)).toBe(7200000);
  });

  it('restricts reservation changes and releases dates immediately when either party cancels', async () => {
    const item = await equipment(), quoted = await quote(item.id), accepted = await accept(quoted).expect(200);
    const id = accepted.body.booking.id;
    await api().post(`/api/bookings/${id}/reserve`).expect(401);
    await api().post(`/api/bookings/${id}/cancel`).expect(401);
    await api().post(`/api/bookings/${id}/reserve`).set('Authorization', auth(other)).expect(404);
    await api().post(`/api/bookings/${id}/cancel`).set('Authorization', auth(other)).expect(404);
    await api().post(`/api/bookings/${id}/reserve`).set('Authorization', auth(owner)).expect(403);
    const cancelled = await api().post(`/api/bookings/${id}/cancel`).set('Authorization', auth(renter)).expect(201);
    expect(cancelled.body).toMatchObject({ status: 'CANCELLED', reservationState: 'CANCELLED', agreedAmount: 400000, terms: 'Delivery included' });
    expect((await availability(item.id)).body.available).toBe(true);
    const repeat = await api().post(`/api/bookings/${id}/cancel`).set('Authorization', auth(owner)).expect(201);
    expect(repeat.body.cancelledAt).toBe(cancelled.body.cancelledAt);
    await api().post(`/api/bookings/${id}/reserve`).set('Authorization', auth(renter)).expect(409);
    await accept(quoted).expect(200);
    expect((await detail(id)).body.status).toBe('CANCELLED');
  });

  it('handles older unreserved bookings and rejects unavailable inventory or past rental dates', async () => {
    const item = await equipment(), quoted = await quote(item.id), accepted = await accept(quoted).expect(200);
    const id = accepted.body.booking.id;
    await prisma.booking.update({ where: { id }, data: { reservedAt: null, reservationExpiresAt: null } });
    expect((await detail(id)).body.reservationState).toBe('NONE');
    await prisma.equipment.update({ where: { id: item.id }, data: { available: false } });
    expect((await availability(item.id)).body.reason).toBe('UNAVAILABLE');
    await api().post(`/api/bookings/${id}/reserve`).set('Authorization', auth(renter)).expect(409);
    await prisma.equipment.update({ where: { id: item.id }, data: { available: true, status: 'ARCHIVED' } });
    await availability(item.id).expect(404);
    await api().post(`/api/bookings/${id}/reserve`).set('Authorization', auth(renter)).expect(409);
    await prisma.equipment.update({ where: { id: item.id }, data: { status: 'PUBLISHED' } });
    await api().post(`/api/bookings/${id}/reserve`).set('Authorization', auth(renter)).expect(201);
    await prisma.booking.update({ where: { id }, data: { start: '2020-01-01', end: '2020-01-03', reservedAt: null, reservationExpiresAt: null } });
    await api().post(`/api/bookings/${id}/reserve`).set('Authorization', auth(renter)).expect(400);
  });

  it('validates availability queries and does not reserve an unavailable item during acceptance', async () => {
    const item = await equipment();
    for (const query of ['start=2027-02-30&days=1','start=2020-01-01&days=1',`start=${date(0)}&days=0`,`start=${date(0)}&days=366`,`start=${date(0)}&days=1.5`,'start=9999-12-31&days=365']) {
      await api().get(`/api/equipment/${item.id}/availability?${query}`).expect(400);
    }
    await api().get(`/api/equipment/${item.id}/availability`).expect(400);
    const quoted = await quote(item.id);
    await prisma.equipment.update({ where: { id: item.id }, data: { available: false } });
    await accept(quoted).expect(409);
    expect((await prisma.rentalRequest.findUniqueOrThrow({ where: { id: quoted } })).status).toBe('QUOTED');
    expect(await prisma.booking.count({ where: { requestId: quoted } })).toBe(0);
  });
});
