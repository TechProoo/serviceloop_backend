import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, User } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRequestDto, PageDto, UpdateRequestDto } from '../common/dto';

export const requestSelect = {
  id: true, equipmentId: true, title: true, service: true, location: true,
  start: true, days: true, name: true, email: true, notes: true, estimate: true,
  status: true, quotedAmount: true, quoteNotes: true, createdAt: true, updatedAt: true,
} satisfies Prisma.RentalRequestSelect;
@Injectable()
export class RequestsService {
  constructor(private readonly prisma: PrismaService) {}
  async create(user: User, dto: CreateRequestDto) {
    const time = Date.parse(`${dto.start}T00:00:00Z`);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== dto.start || dto.start < today) throw new BadRequestException('start must be a valid date today or later (Nigeria time)');
    if (dto.equipmentId === undefined && !dto.title) throw new BadRequestException('title is required for a general request');
    return this.prisma.$transaction(async tx => {
      const item = dto.equipmentId === undefined ? null : await tx.equipment.findUnique({ where: { id: dto.equipmentId } });
      if (dto.equipmentId !== undefined && !item) throw new NotFoundException('Equipment not found');
      if (item && (item.status !== 'PUBLISHED' || !item.available)) throw new ConflictException('Equipment is not available for requests');
      if (item?.ownerId === user.id) throw new BadRequestException('You cannot request your own equipment');
      return tx.rentalRequest.create({ data: {
        userId: user.id, equipmentId: item?.id, title: item?.name ?? dto.title!,
        service: dto.service, location: dto.location, start: dto.start, days: dto.days,
        name: dto.name ?? user.name, email: dto.email ?? user.email, notes: dto.notes,
        estimate: item ? item.rate * dto.days : null,
      }, select: requestSelect });
    });
  }
  async list(user: User, query: PageDto) {
    const where: Prisma.RentalRequestWhereInput = { OR: [{ userId: user.id }, { equipment: { ownerId: user.id } }] };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.rentalRequest.findMany({ where, select: requestSelect, take: query.limit, skip: query.offset, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      this.prisma.rentalRequest.count({ where }),
    ]); return { items, total };
  }
  async detail(user: User, id: string) {
    const row = await this.prisma.rentalRequest.findUnique({ where: { id }, include: { equipment: { select: { ownerId: true } } } });
    if (!row) throw new NotFoundException('Request not found');
    if (row.userId !== user.id && row.equipment?.ownerId !== user.id && user.role !== 'ADMIN') throw new ForbiddenException('This request belongs to another account');
    return row;
  }
  async view(user: User, id: string) { await this.detail(user, id); return this.prisma.rentalRequest.findUnique({ where: { id }, select: requestSelect }); }
  async update(user: User, id: string, dto: UpdateRequestDto) {
    const row = await this.detail(user, id);
    const data: Prisma.RentalRequestUpdateManyMutationInput = { status: dto.status };
    if (dto.status === 'QUOTED') {
      if (row.equipment?.ownerId !== user.id && user.role !== 'ADMIN') throw new ForbiddenException('Only the equipment owner or administrator may quote');
      if (!['SUBMITTED', 'QUOTED'].includes(row.status)) throw new ConflictException('Request can no longer be quoted');
      if (dto.quotedAmount === undefined) throw new BadRequestException('quotedAmount is required');
      data.quotedAmount = dto.quotedAmount; data.quoteNotes = dto.quoteNotes ?? '';
    } else {
      if (dto.quotedAmount !== undefined || dto.quoteNotes !== undefined) throw new BadRequestException('Quote fields require QUOTED status');
      if (row.userId !== user.id) throw new ForbiddenException('Only the requester may respond to a quote');
      const allowed = row.status === 'QUOTED' ? ['ACCEPTED', 'DECLINED', 'CANCELLED'] : row.status === 'SUBMITTED' ? ['CANCELLED'] : [];
      if (!allowed.includes(dto.status)) throw new ConflictException('Invalid request status transition');
    }
    // Optimistic concurrency: a response must not overwrite a newer quote or cancellation.
    const changed = await this.prisma.rentalRequest.updateMany({ where: { id, status: row.status, updatedAt: row.updatedAt }, data });
    if (!changed.count) throw new ConflictException('Request changed. Reload and try again.');
    return this.prisma.rentalRequest.findUnique({ where: { id }, select: requestSelect });
  }
}
