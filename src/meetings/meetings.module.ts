import { Module } from '@nestjs/common';
import { MeetingsController } from './meetings.controller';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [CommonModule],
  controllers: [MeetingsController],
})
export class MeetingsModule {}
