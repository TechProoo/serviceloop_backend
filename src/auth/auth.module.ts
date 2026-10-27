import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AdminGuard, AuthGuard } from './auth.guard';

@Global()
@Module({ controllers: [AuthController], providers: [AuthService, AuthGuard, AdminGuard], exports: [AuthGuard, AdminGuard] })
export class AuthModule {}
