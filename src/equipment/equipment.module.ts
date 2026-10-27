import { Module } from '@nestjs/common';
import { EquipmentController, MyEquipmentController } from './equipment.controller';
import { EquipmentService } from './equipment.service';

@Module({ controllers: [EquipmentController, MyEquipmentController], providers: [EquipmentService], exports: [EquipmentService] })
export class EquipmentModule {}
