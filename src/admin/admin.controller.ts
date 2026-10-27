import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { AdminGuard, AuthGuard } from '../auth/auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { EquipmentService, equipmentSelect } from '../equipment/equipment.service';
import { requestSelect } from '../requests/requests.service';
import { ModerateEquipmentDto, PageDto } from '../common/dto';

@Controller('admin') @UseGuards(AuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly prisma: PrismaService, private readonly equipment: EquipmentService) {}
  @Get('equipment') async listings(@Query() query: PageDto) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.equipment.findMany({ select: equipmentSelect, take: query.limit, skip: query.offset, orderBy: { id: 'desc' } }),
      this.prisma.equipment.count(),
    ]); return { items, total };
  }
  @Patch('equipment/:id') moderate(@Param('id', ParseIntPipe) id: number, @Body() dto: ModerateEquipmentDto) { return this.equipment.moderate(id, dto); }
  @Get('requests') async requests(@Query() query: PageDto) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.rentalRequest.findMany({ select: requestSelect, take: query.limit, skip: query.offset, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      this.prisma.rentalRequest.count(),
    ]); return { items, total };
  }
  @Get('waitlist') async waitlist(@Query() query: PageDto) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.waitlistEntry.findMany({ take: query.limit, skip: query.offset, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      this.prisma.waitlistEntry.count(),
    ]); return { items, total };
  }
}
