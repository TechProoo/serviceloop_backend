import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Equipment, Prisma, User } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEquipmentDto, EquipmentQueryDto, ModerateEquipmentDto, PageDto, UpdateEquipmentDto } from '../common/dto';

export const equipmentSelect = {
  id: true, name: true, category: true, location: true, rate: true, image: true,
  capacity: true, operator: true, available: true, vendor: true, description: true,
  status: true, createdAt: true, updatedAt: true,
} satisfies Prisma.EquipmentSelect;
@Injectable()
export class EquipmentService {
  constructor(private readonly prisma: PrismaService) {}
  async find(id: number) {
    const item = await this.prisma.equipment.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Equipment not found'); return item;
  }
  assertOwner(user: User, item: Equipment) {
    if (user.role !== 'ADMIN' && item.ownerId !== user.id) throw new ForbiddenException('You do not own this equipment');
  }
  async list(query: EquipmentQueryDto) {
    const where: Prisma.EquipmentWhereInput = {
      status: 'PUBLISHED', category: query.category,
      ...(query.location ? { location: { contains: query.location, mode: 'insensitive' } } : {}),
      ...(query.available ? { available: query.available === 'true' } : {}),
      rate: { gte: query.minRate, lte: query.maxRate },
      ...(query.q ? { OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { description: { contains: query.q, mode: 'insensitive' } }] } : {}),
    };
    const orderBy: Prisma.EquipmentOrderByWithRelationInput[] = query.sort === 'price_asc' ? [{ rate: 'asc' }, { id: 'desc' }] : query.sort === 'price_desc' ? [{ rate: 'desc' }, { id: 'desc' }] : [{ id: 'desc' }];
    const [items, total] = await this.prisma.$transaction([
      this.prisma.equipment.findMany({ where, select: equipmentSelect, orderBy, take: query.limit, skip: query.offset }),
      this.prisma.equipment.count({ where }),
    ]);
    return { items, total, limit: query.limit, offset: query.offset };
  }
  async detail(id: number) {
    const item = await this.find(id);
    if (item.status !== 'PUBLISHED') throw new NotFoundException('Equipment not found');
    return this.prisma.equipment.findUnique({ where: { id }, select: equipmentSelect });
  }
  create(user: User, dto: CreateEquipmentDto) {
    if (!['OWNER', 'ADMIN'].includes(user.role)) throw new ForbiddenException('An owner account is required');
    return this.prisma.equipment.create({ data: { ...dto, ownerId: user.id }, select: equipmentSelect });
  }
  async mine(user: User, query: PageDto) {
    const where = { ownerId: user.id };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.equipment.findMany({ where, select: equipmentSelect, orderBy: { id: 'desc' }, take: query.limit, skip: query.offset }),
      this.prisma.equipment.count({ where }),
    ]); return { items, total };
  }
  async update(user: User, id: number, dto: UpdateEquipmentDto) {
    const item = await this.find(id); this.assertOwner(user, item);
    if (dto.rate === undefined && dto.available === undefined) throw new BadRequestException('No changes supplied');
    if (item.status === 'ARCHIVED') throw new ConflictException('Archived equipment cannot be edited');
    return this.prisma.equipment.update({ where: { id }, data: dto, select: equipmentSelect });
  }
  async archive(user: User, id: number) {
    this.assertOwner(user, await this.find(id));
    await this.prisma.equipment.update({ where: { id }, data: { status: 'ARCHIVED', available: false } });
    return { success: true };
  }
  async saved(user: User, query: PageDto) {
    const where: Prisma.SavedEquipmentWhereInput = { userId: user.id, equipment: { status: 'PUBLISHED' } };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.savedEquipment.findMany({ where, include: { equipment: { select: equipmentSelect } }, take: query.limit, skip: query.offset, orderBy: { equipmentId: 'desc' } }),
      this.prisma.savedEquipment.count({ where }),
    ]); return { items: rows.map(row => row.equipment), total };
  }
  async save(user: User, id: number) {
    const item = await this.find(id);
    if (item.status !== 'PUBLISHED') throw new NotFoundException('Equipment not found');
    await this.prisma.savedEquipment.upsert({ where: { userId_equipmentId: { userId: user.id, equipmentId: id } }, create: { userId: user.id, equipmentId: id }, update: {} });
    return { success: true };
  }
  async unsave(user: User, id: number) {
    await this.prisma.savedEquipment.deleteMany({ where: { userId: user.id, equipmentId: id } });
    return { success: true };
  }
  async moderate(id: number, dto: ModerateEquipmentDto) {
    // Compare and update together so a concurrent archive cannot be republished.
    const changed = await this.prisma.equipment.updateMany({ where: { id, status: { not: 'ARCHIVED' } }, data: { status: dto.status } });
    if (!changed.count) { await this.find(id); throw new ConflictException('Archived equipment cannot be published'); }
    return this.prisma.equipment.findUnique({ where: { id }, select: equipmentSelect });
  }
}
