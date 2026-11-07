import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Booking, Prisma, User } from '../../generated/prisma/client';
import { AvailabilityDto, PageDto } from '../common/dto';
import { PrismaService } from '../prisma/prisma.service';
import { rentalWindow } from '../common/rental-dates';

export const RESERVATION_HOURS = 2;

function present(booking: Booking, now: Date) {
  const reservationState = booking.status === 'CANCELLED' ? 'CANCELLED'
    : booking.equipmentId === null ? 'NOT_APPLICABLE'
    : !booking.reservationExpiresAt ? 'NONE'
    : booking.reservationExpiresAt > now ? 'HELD' : 'EXPIRED';
  return { ...booking, reservationState, serverTime: now.toISOString(), holdHours: RESERVATION_HOURS };
}

@Injectable()
export class BookingsService {
  constructor(private readonly prisma: PrismaService) {}

  private async now(tx: Prisma.TransactionClient) {
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    return clock.now;
  }

  // All hold/cancel writes lock the same equipment row, including across API
  // processes. Read committed queries after the lock see the previous winner.
  private async lockEquipment(tx: Prisma.TransactionClient, equipmentId: number) {
    // NO KEY UPDATE serializes holds without conflicting with the KEY SHARE
    // locks taken by concurrent Booking/Request foreign-key inserts.
    // https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS
    const rows = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM "Equipment" WHERE id = ${equipmentId} FOR NO KEY UPDATE`;
    if (!rows.length) throw new NotFoundException('Equipment not found');
  }

  private conflict(tx: Prisma.TransactionClient, equipmentId: number, start: string, end: string, now: Date, exceptId?: string) {
    return tx.booking.findFirst({ where: {
      equipmentId, status: 'AWAITING_CONFIRMATION', reservationExpiresAt: { gt: now },
      start: { lte: end }, end: { gte: start }, ...(exceptId ? { id: { not: exceptId } } : {}),
    }, select: { id: true } });
  }

  async assertRequestDates(tx: Prisma.TransactionClient, equipmentId: number, start: string, days: number) {
    const now = await this.now(tx), window = rentalWindow(start, days, now);
    if (await this.conflict(tx, equipmentId, window.start, window.end, now)) {
      throw new ConflictException('This equipment is reserved for some of these dates. Choose different dates or check again later.');
    }
  }

  async availability(equipmentId: number, query: AvailabilityDto) {
    return this.prisma.$transaction(async tx => {
      const now = await this.now(tx), window = rentalWindow(query.start, query.days, now);
      const item = await tx.equipment.findUnique({ where: { id: equipmentId } });
      if (!item || item.status !== 'PUBLISHED') throw new NotFoundException('Equipment not found');
      const overlap = await this.conflict(tx, equipmentId, window.start, window.end, now);
      return { equipmentId, ...window, available: item.available && !overlap,
        reason: !item.available ? 'UNAVAILABLE' : overlap ? 'RESERVED' : null,
        checkedAt: now.toISOString(), holdHours: RESERVATION_HOURS };
    });
  }

  private async hold(tx: Prisma.TransactionClient, booking: Booking) {
    if (booking.equipmentId === null) throw new BadRequestException('This service booking has no equipment to reserve');
    await this.lockEquipment(tx, booking.equipmentId);
    // Re-read after locking: a concurrent cancellation/hold may have completed.
    const current = await tx.booking.findUniqueOrThrow({ where: { id: booking.id } });
    const now = await this.now(tx);
    if (current.status === 'CANCELLED') throw new ConflictException('This booking has been cancelled. Start a new quote request.');
    // Retries never extend a live hold.
    if (current.reservationExpiresAt && current.reservationExpiresAt > now) return present(current, now);
    const window = rentalWindow(current.start, current.days, now);
    const item = await tx.equipment.findUniqueOrThrow({ where: { id: booking.equipmentId } });
    if (item.status !== 'PUBLISHED' || !item.available) throw new ConflictException('This equipment is not currently available for reservation');
    if (await this.conflict(tx, item.id, window.start, window.end, now, booking.id)) {
      throw new ConflictException('This equipment is reserved for some of these dates. Choose different dates or check again later.');
    }
    const reserved = await tx.booking.update({ where: { id: booking.id }, data: {
      reservedAt: now, reservationExpiresAt: new Date(now.getTime() + RESERVATION_HOURS * 3600000),
    } });
    return present(reserved, now);
  }

  async reserve(user: User, id: string) {
    const booking = await this.detail(user, id);
    if (user.id !== booking.renterId && user.role !== 'ADMIN') throw new ForbiddenException('Only the renter can reserve these dates');
    return this.prisma.$transaction(tx => this.hold(tx, booking), { isolationLevel: 'ReadCommitted' });
  }

  async cancel(user: User, id: string) {
    const booking = await this.detail(user, id);
    return this.prisma.$transaction(async tx => {
      if (booking.equipmentId !== null) await this.lockEquipment(tx, booking.equipmentId);
      const now = await this.now(tx);
      await tx.booking.updateMany({ where: { id, status: 'AWAITING_CONFIRMATION' }, data: { status: 'CANCELLED', cancelledAt: now } });
      return present(await tx.booking.findUniqueOrThrow({ where: { id } }), now);
    }, { isolationLevel: 'ReadCommitted' });
  }

  // Called inside the same transaction that accepts the quote.
  async record(tx: Prisma.TransactionClient, requestId: string) {
    const row = await tx.rentalRequest.findUniqueOrThrow({
      where: { id: requestId }, include: { equipment: { include: { owner: true } } },
    });
    if (row.status !== 'ACCEPTED' || row.quotedAmount === null) throw new Error('An accepted quote is required');
    const item = row.equipment;
    const { end } = rentalWindow(row.start, row.days, await this.now(tx));
    const booking = await tx.booking.create({ data: {
      reference: `SL-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
      requestId: row.id, renterId: row.userId, ownerId: item?.ownerId, equipmentId: row.equipmentId,
      title: row.title, service: row.service, equipmentCategory: item?.category,
      capacity: item?.capacity, image: item?.image ?? '', equipmentLocation: item?.location,
      operator: item?.operator, vendor: item?.vendor ?? 'ServiceLoop team',
      ownerName: item?.owner.name, ownerEmail: item?.owner.email,
      renterName: row.name, renterEmail: row.email, location: row.location,
      start: row.start, end, days: row.days,
      agreedAmount: row.quotedAmount, terms: row.quoteNotes ?? '', notes: row.notes,
      acceptedAt: row.updatedAt,
    } });
    if (item) return this.hold(tx, booking);
    return present(booking, await this.now(tx));
  }

  private scope(user: User): Prisma.BookingWhereInput {
    return user.role === 'ADMIN' ? {} : { OR: [{ renterId: user.id }, { ownerId: user.id }] };
  }

  async list(user: User, query: PageDto) {
    const where = this.scope(user);
    const [items, total, clock] = await this.prisma.$transaction([
      this.prisma.booking.findMany({ where, take: query.limit, skip: query.offset, orderBy: [{ acceptedAt: 'desc' }, { id: 'desc' }] }),
      this.prisma.booking.count({ where }),
      this.prisma.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`,
    ]);
    return { items: items.map(item => present(item, clock[0].now)), total };
  }

  async detail(user: User, id: string) {
    const [booking, clock] = await this.prisma.$transaction([
      this.prisma.booking.findFirst({ where: { id, ...this.scope(user) } }),
      this.prisma.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`,
    ]);
    if (!booking) throw new NotFoundException('Booking not found');
    return present(booking, clock[0].now);
  }
}
