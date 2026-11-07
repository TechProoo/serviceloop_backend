import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, User } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRequestDto, PageDto, UpdateRequestDto } from '../common/dto';
import { BookingsService } from '../bookings/bookings.service';
import { rentalWindow } from '../common/rental-dates';

export const requestSelect = {
  id: true, equipmentId: true, title: true, service: true, location: true,
  start: true, days: true, name: true, email: true, notes: true, estimate: true,
  status: true, quotedAmount: true, quoteNotes: true, createdAt: true, updatedAt: true,
  booking: { select: { id: true, reference: true } },
} satisfies Prisma.RentalRequestSelect;
@Injectable()
export class RequestsService {
  constructor(private readonly prisma: PrismaService, private readonly bookings: BookingsService) {}
  async create(user: User, dto: CreateRequestDto) {
    rentalWindow(dto.start, dto.days);
    if (dto.equipmentId === undefined && !dto.title) throw new BadRequestException('title is required for a general request');
    return this.prisma.$transaction(async tx => {
      const item = dto.equipmentId === undefined ? null : await tx.equipment.findUnique({ where: { id: dto.equipmentId } });
      if (dto.equipmentId !== undefined && !item) throw new NotFoundException('Equipment not found');
      if (item && (item.status !== 'PUBLISHED' || !item.available)) throw new ConflictException('Equipment is not available for requests');
      if (item?.ownerId === user.id) throw new BadRequestException('You cannot request your own equipment');
      if (item) await this.bookings.assertRequestDates(tx, item.id, dto.start, dto.days);
      return tx.rentalRequest.create({ data: {
        userId: user.id, equipmentId: item?.id, title: item?.name ?? dto.title!,
        service: dto.service, location: dto.location, start: dto.start, days: dto.days,
        name: dto.name ?? user.name, email: dto.email ?? user.email, notes: dto.notes,
        estimate: item ? item.rate * dto.days : null,
      }, select: requestSelect });
    }, { isolationLevel: 'ReadCommitted' });
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
    if (dto.expectedUpdatedAt !== undefined && dto.status !== 'ACCEPTED') throw new BadRequestException('A quote version is only used when accepting a quote');
    // A retried acceptance returns the same booking, including after a lost response.
    if (dto.status === 'ACCEPTED' && row.status === 'ACCEPTED' && row.userId === user.id && dto.quotedAmount === undefined && dto.quoteNotes === undefined) {
      return this.prisma.rentalRequest.findUniqueOrThrow({ where: { id }, select: requestSelect });
    }
    if (dto.status === 'ACCEPTED' && dto.expectedUpdatedAt !== undefined && dto.expectedUpdatedAt !== row.updatedAt.toISOString()) {
      throw new ConflictException('This quote has changed. Refresh your workspace and review it again before accepting.');
    }
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
    return this.prisma.$transaction(async tx => {
      const changed = await tx.rentalRequest.updateMany({ where: { id, status: row.status, updatedAt: row.updatedAt }, data });
      if (!changed.count) throw new ConflictException('Request changed. Reload and try again.');
      if (dto.status === 'ACCEPTED') await this.bookings.record(tx, id);
      return tx.rentalRequest.findUniqueOrThrow({ where: { id }, select: requestSelect });
    }, { isolationLevel: 'ReadCommitted' });
  }
}
