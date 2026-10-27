import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { clearSessionCookie, setSessionCookie } from './session-cookie';
import { Throttle } from '@nestjs/throttler';
import { AuthService, publicUser } from './auth.service';
import { AuthGuard, AuthRequest, CurrentUser } from './auth.guard';
import { ChangePasswordDto, LoginDto, RegisterDto } from './auth.dto';
import { User } from '../../generated/prisma/client';

@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}
  @Post('register') @Throttle({ default: { limit: 10, ttl: 60000 } })
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) { const result = await this.service.register(dto); setSessionCookie(res, result); return result; }
  @Post('login') @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60000 } })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) { const result = await this.service.login(dto); setSessionCookie(res, result); return result; }
  @Get('me') @UseGuards(AuthGuard)
  me(@CurrentUser() user: User) { return publicUser(user); }
  @Post('logout') @HttpCode(200) @UseGuards(AuthGuard)
  async logout(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) { const result = await this.service.logout(req.sessionHash); clearSessionCookie(res); return result; }
  @Post('logout-all') @HttpCode(200) @UseGuards(AuthGuard)
  async logoutAll(@CurrentUser() user: User, @Res({ passthrough: true }) res: Response) { const result = await this.service.logoutAll(user.id); clearSessionCookie(res); return result; }
  @Patch('password') @UseGuards(AuthGuard) @Throttle({ default: { limit: 5, ttl: 60000 } })
  async password(@CurrentUser() user: User, @Body() dto: ChangePasswordDto, @Res({ passthrough: true }) res: Response) { const result = await this.service.changePassword(user, dto); clearSessionCookie(res); return result; }
}
