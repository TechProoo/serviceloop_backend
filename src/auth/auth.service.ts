import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes, createHash, scrypt as deriveKey, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto, LoginDto, RegisterDto } from './auth.dto';
import { Prisma, User } from '../../generated/prisma/client';

const scrypt = promisify(deriveKey);
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const publicUser = (user: User) => ({ id: user.id, name: user.name, email: user.email, role: user.role });
async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await scrypt(password, salt, 64) as Buffer).toString('hex')}`;
}
async function verify(password: string, stored: string) {
  const [salt, digest] = stored.split(':');
  return timingSafeEqual(await scrypt(password, salt, 64) as Buffer, Buffer.from(digest, 'hex'));
}
@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}
  async register(dto: RegisterDto) {
    let user: User;
    try { user = await this.prisma.user.create({ data: { name: dto.name, email: dto.email, role: dto.role, passwordHash: await passwordHash(dto.password) } }); }
    catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('An account already uses this email'); throw error; }
    return this.issue(user);
  }
  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    const valid = await verify(dto.password, user?.passwordHash ?? `${'0'.repeat(32)}:${'0'.repeat(128)}`);
    if (!user || !valid) throw new UnauthorizedException('Invalid email or password');
    return this.issue(user);
  }
  private async issue(user: User) {
    const accessToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + Number(process.env.SESSION_DAYS || 7) * 86400000);
    await this.prisma.$transaction(async tx => {
      // Lock and compare the credential so a concurrent password reset cannot be followed by a stale login.
      const valid = await tx.user.updateMany({ where: { id: user.id, passwordHash: user.passwordHash }, data: { passwordHash: user.passwordHash } });
      if (!valid.count) throw new UnauthorizedException('Credentials changed. Sign in again.');
      await tx.session.deleteMany({ where: { userId: user.id, expiresAt: { lte: new Date() } } });
      await tx.session.create({ data: { tokenHash: tokenHash(accessToken), userId: user.id, expiresAt } });
    });
    return { user: publicUser(user), accessToken, expiresAt };
  }
  async logout(hash: string) { await this.prisma.session.deleteMany({ where: { tokenHash: hash } }); return { success: true }; }
  async logoutAll(userId: string) { await this.prisma.session.deleteMany({ where: { userId } }); return { success: true }; }
  async changePassword(user: User, dto: ChangePasswordDto) {
    if (!await verify(dto.currentPassword, user.passwordHash)) throw new UnauthorizedException('Current password is incorrect');
    const nextHash = await passwordHash(dto.newPassword);
    await this.prisma.$transaction(async tx => {
      const changed = await tx.user.updateMany({ where: { id: user.id, passwordHash: user.passwordHash }, data: { passwordHash: nextHash } });
      if (!changed.count) throw new ConflictException('Password was already changed. Sign in again.');
      await tx.session.deleteMany({ where: { userId: user.id } });
    });
    return { success: true, message: 'Password changed. Sign in again on all devices.' };
  }
}
