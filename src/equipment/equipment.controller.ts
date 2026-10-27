import { EquipmentIdPipe } from '../common/equipment-id.pipe';
import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { User } from '../../generated/prisma/client';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { CreateEquipmentDto, EquipmentQueryDto, PageDto, UpdateEquipmentDto } from '../common/dto';
import { EquipmentService } from './equipment.service';

@Controller('equipment')
export class EquipmentController {
  constructor(private readonly service: EquipmentService) {}
  @Get() list(@Query() query: EquipmentQueryDto) { return this.service.list(query); }
  @Get(':id') detail(@Param('id', EquipmentIdPipe) id: number) { return this.service.detail(id); }
  @Post() @UseGuards(AuthGuard)
  create(@CurrentUser() user: User, @Body() dto: CreateEquipmentDto) { return this.service.create(user, dto); }
  @Patch(':id') @UseGuards(AuthGuard)
  update(@CurrentUser() user: User, @Param('id', EquipmentIdPipe) id: number, @Body() dto: UpdateEquipmentDto) { return this.service.update(user, id, dto); }
  @Delete(':id') @UseGuards(AuthGuard)
  archive(@CurrentUser() user: User, @Param('id', EquipmentIdPipe) id: number) { return this.service.archive(user, id); }
}
@Controller('me') @UseGuards(AuthGuard)
export class MyEquipmentController {
  constructor(private readonly service: EquipmentService) {}
  @Get('equipment') mine(@CurrentUser() user: User, @Query() query: PageDto) { return this.service.mine(user, query); }
  @Get('saved') saved(@CurrentUser() user: User, @Query() query: PageDto) { return this.service.saved(user, query); }
  @Put('saved/:id') save(@CurrentUser() user: User, @Param('id', EquipmentIdPipe) id: number) { return this.service.save(user, id); }
  @Delete('saved/:id') unsave(@CurrentUser() user: User, @Param('id', EquipmentIdPipe) id: number) { return this.service.unsave(user, id); }
}
