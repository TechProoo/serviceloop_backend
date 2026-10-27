import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WaitlistDto } from '../common/dto';

@Injectable()
export class WaitlistService {
  constructor(private readonly prisma: PrismaService) {}
  async join(dto: WaitlistDto) {
    let phone = dto.phone.replace(/[\s()-]/g, '');
    if (/^0\d{10}$/.test(phone)) phone = `+234${phone.slice(1)}`;
    if (/^234\d{10}$/.test(phone)) phone = `+${phone}`;
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new BadRequestException('Use a valid phone number with country code');
    await this.prisma.waitlistEntry.upsert({
      where: { phone }, update: {},
      create: { name: dto.name, phone, email: dto.email?.toLowerCase(), role: dto.role, wantToRent: [...new Set(dto.wantToRent)], wantToList: [...new Set(dto.wantToList)] },
    });
    return { message: 'Thank you. Your interest has been recorded.' };
  }
}
