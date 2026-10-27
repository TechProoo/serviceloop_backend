import { CanActivate, createParamDecorator, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { tokenHash } from './auth.service';
import { User } from '../../generated/prisma/client';

export type AuthRequest = Request & { user: User; sessionHash: string };
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): User => context.switchToHttp().getRequest<AuthRequest>().user);
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const bearer = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    const cookie = req.headers.cookie?.match(/(?:^|;\s*)sl_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    const token = bearer ?? cookie;
    if (!token) throw new UnauthorizedException('Sign in to continue');
    if (!bearer && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const allowed = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:5174').split(',').map(value => value.trim());
      if (!req.headers.origin || !allowed.includes(req.headers.origin)) throw new ForbiddenException('A trusted browser origin is required');
    }
    const session = await this.prisma.session.findUnique({ where: { tokenHash: tokenHash(token) }, include: { user: true } });
    if (!session || session.expiresAt <= new Date()) throw new UnauthorizedException('Session expired or revoked');
    req.user = session.user; req.sessionHash = session.tokenHash;
    return true;
  }
}
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    if (context.switchToHttp().getRequest<AuthRequest>().user?.role !== 'ADMIN') throw new ForbiddenException('Administrator access required');
    return true;
  }
}
