import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [CommonModule],
  controllers: [MediaController],
})
export class MediaModule {}
