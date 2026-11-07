import { Module } from '@nestjs/common';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';
import { BookingsModule } from '../bookings/bookings.module';
@Module({ imports: [BookingsModule], controllers: [RequestsController], providers: [RequestsService] })
export class RequestsModule {}
