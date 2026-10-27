import { Module } from '@nestjs/common';
import { EquipmentModule } from '../equipment/equipment.module';
import { AdminController } from './admin.controller';
@Module({ imports: [EquipmentModule], controllers: [AdminController] })
export class AdminModule {}
