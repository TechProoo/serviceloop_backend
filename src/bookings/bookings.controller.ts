import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { User } from '../../generated/prisma/client';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { PageDto } from '../common/dto';
import { BookingsService } from './bookings.service';

@Controller('bookings')
@UseGuards(AuthGuard)
export class BookingsController {
  constructor(private readonly service: BookingsService) {}
  @Get() list(@CurrentUser() user: User, @Query() query: PageDto) { return this.service.list(user, query); }
  @Get(':id') detail(@CurrentUser() user: User, @Param('id') id: string) { return this.service.detail(user, id); }
  @Post(':id/reserve') reserve(@CurrentUser() user: User, @Param('id') id: string) { return this.service.reserve(user, id); }
  @Post(':id/cancel') cancel(@CurrentUser() user: User, @Param('id') id: string) { return this.service.cancel(user, id); }
}
