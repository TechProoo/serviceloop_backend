import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { PrismaService } from './prisma/prisma.service';
import { AuthModule } from './auth/auth.module';
import { EquipmentModule } from './equipment/equipment.module';
import { RequestsModule } from './requests/requests.module';
import { WaitlistModule } from './waitlist/waitlist.module';
import { AdminModule } from './admin/admin.module';
import { CATEGORIES, SERVICES } from './common/dto';

@Controller()
class AppController {
  constructor(private readonly prisma: PrismaService) {}
  @Get('health') async health() { await this.prisma.$queryRaw`SELECT 1`; return { status: 'ok', service: 'serviceloop' }; }
  @Get('categories') categories() { return { items: CATEGORIES }; }
  @Get('services') services() { return { items: SERVICES }; }
}
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 120 }]),
    PrismaModule, AuthModule, EquipmentModule, RequestsModule, WaitlistModule, AdminModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
