import { Module } from '@nestjs/common';
import { PushController } from './push.controller';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [CommonModule],
  controllers: [PushController],
})
export class PushModule {}
