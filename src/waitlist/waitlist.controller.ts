import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { WaitlistDto } from '../common/dto';
import { WaitlistService } from './waitlist.service';

@Controller('waitlist')
export class WaitlistController {
  constructor(private readonly service: WaitlistService) {}
  @Post() @HttpCode(202) @Throttle({ default: { limit: 5, ttl: 60000 } })
  join(@Body() dto: WaitlistDto) { return this.service.join(dto); }
}
