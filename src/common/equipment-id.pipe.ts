import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

@Injectable()
export class EquipmentIdPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    const id = Number(value);
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(id) || id > 2147483647) {
      throw new BadRequestException('Equipment ID must be an integer between 1 and 2147483647');
    }
    return id;
  }
}
