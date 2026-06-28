import { Controller, Get, Post, Query, Body } from '@nestjs/common';
import { MessengerService } from './messenger.service';

@Controller('webhook')
export class MessengerController {
  constructor(private readonly messengerService: MessengerService) {}

  @Get()
  verify(@Query() query: any) {
    return this.messengerService.verify(query);
  }

  @Post()
  async receive(@Body() body: any) {
    return this.messengerService.handleMessage(body);
  }
}