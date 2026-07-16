import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [CommonModule],
  controllers: [AiController],
})
export class AiModule {}
