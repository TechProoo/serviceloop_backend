import { BadRequestException } from '@nestjs/common';

const nigeriaDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' });
export function rentalWindow(start: string, days: number, now = new Date()) {
  const time = Date.parse(`${start}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== start || start < nigeriaDate.format(now)) {
    throw new BadRequestException('Choose a valid start date today or later (Nigeria time)');
  }
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new BadRequestException('Rental duration must be 1–365 days');
  const end = new Date(time + (days - 1) * 86400000).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new BadRequestException('Rental end date is out of range');
  return { start, end };
}
