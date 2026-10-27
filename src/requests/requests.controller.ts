import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { User } from '../../generated/prisma/client';
import { CreateRequestDto, PageDto, UpdateRequestDto } from '../common/dto';
import { RequestsService } from './requests.service';

@Controller('requests') @UseGuards(AuthGuard)
export class RequestsController {
  constructor(private readonly service: RequestsService) {}
  @Post() create(@CurrentUser() user: User, @Body() dto: CreateRequestDto) { return this.service.create(user, dto); }
  @Get() list(@CurrentUser() user: User, @Query() query: PageDto) { return this.service.list(user, query); }
  @Get(':id') detail(@CurrentUser() user: User, @Param('id') id: string) { return this.service.view(user, id); }
  @Patch(':id') update(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: UpdateRequestDto) { return this.service.update(user, id, dto); }
}
