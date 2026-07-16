import { Module } from '@nestjs/common';
import { BlockedController } from './blocked.controller';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [CommonModule],
  controllers: [BlockedController],
})
export class BlockedModule {}
