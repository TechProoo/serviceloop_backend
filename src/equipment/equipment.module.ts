import { Module } from '@nestjs/common';
import { EquipmentController, MyEquipmentController } from './equipment.controller';
import { EquipmentService } from './equipment.service';
import { BookingsModule } from '../bookings/bookings.module';

@Module({ imports: [BookingsModule], controllers: [EquipmentController, MyEquipmentController], providers: [EquipmentService], exports: [EquipmentService] })
export class EquipmentModule {}
