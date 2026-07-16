import { Module } from '@nestjs/common';
import { StatusesController } from './statuses.controller';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [CommonModule],
  controllers: [StatusesController],
})
export class StatusesModule {}
