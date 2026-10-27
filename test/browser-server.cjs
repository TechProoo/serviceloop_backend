// Ephemeral PostgreSQL and real Nest API for browser integration tests. Never uses .env credentials.
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
require('reflect-metadata');

async function main() {
  const db = await PGlite.create();
  const migrations = join(__dirname, '../prisma/migrations');
  for (const entry of readdirSync(migrations, { withFileTypes: true }).filter(entry => entry.isDirectory()).sort((a,b) => a.name.localeCompare(b.name))) {
    await db.exec(readFileSync(join(migrations, entry.name, 'migration.sql'), 'utf8'));
  }
  const socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 }); await socket.start();
  process.env.DATABASE_URL = `postgresql://postgres:postgres@${socket.getServerConn()}/postgres`;
  delete process.env.DIRECT_URL;
  process.env.DB_POOL_MAX = '1'; process.env.NODE_ENV = 'test';
  process.env.CORS_ORIGINS = 'http://127.0.0.1:5182,http://127.0.0.1:5183,http://127.0.0.1:5184';
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../dist/src/app.module.js');
  const { configureApp } = require('../dist/src/setup.js');
  const { PrismaService } = require('../dist/src/prisma/prisma.service.js');
  const { AuthService } = require('../dist/src/auth/auth.service.js');
  const app = await NestFactory.create(AppModule, { bodyParser: false, logger: false });
  configureApp(app); await app.init();
  const auth = app.get(AuthService), prisma = app.get(PrismaService);
  const owner = await auth.register({ name: 'Test Owner', email: 'owner@browser.test', password: 'browser-test-password', role: 'OWNER' });
  await prisma.equipment.create({ data: { ownerId: owner.user.id, name: 'CAT 320 Excavator', category: 'Heavy machinery', location: 'Lekki, Lagos', rate: 180000, capacity: '20 tonnes', operator: true, vendor: 'Atlas Equipment', description: 'Equipment for foundations', status: 'PUBLISHED' } });
  await app.listen(3017, '127.0.0.1'); console.log('Browser test API ready on port 3017');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); await socket.stop(); await db.close(); process.exit(0); });
}
main().catch(error => { console.error(error); process.exit(1); });
