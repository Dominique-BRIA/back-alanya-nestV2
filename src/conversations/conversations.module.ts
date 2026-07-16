import { Module } from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [CommonModule],
  controllers: [ConversationsController],
})
export class ConversationsModule {}
