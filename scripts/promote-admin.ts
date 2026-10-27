import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || !email.includes('@')) throw new Error('Usage: npm run admin:promote -- registered-account@example.com');
  const prisma = new PrismaService();
  try {
    const result = await prisma.user.updateMany({ where: { email }, data: { role: 'ADMIN' } });
    if (!result.count) throw new Error('Account not found. Register it first.');
    console.log('Administrator access granted.');
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
