import { Module } from '@nestjs/common';
import { CallsController } from './calls.controller';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [CommonModule],
  controllers: [CallsController],
})
export class CallsModule {}
