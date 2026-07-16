import { Module } from '@nestjs/common';
import { PaysController } from './pays.controller';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [CommonModule],
  controllers: [PaysController],
})
export class PaysModule {}
