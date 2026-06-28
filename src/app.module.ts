import { Module } from '@nestjs/common';
import { MessengerController } from './messenger.controller';
import { MessengerService } from './messenger.service';
import { BotiaService } from './botia.service';

@Module({
  controllers: [MessengerController],
  providers: [MessengerService, BotiaService],
})
export class AppModule {}