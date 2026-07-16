import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [CommonModule],
  controllers: [UsersController],
})
export class UsersModule {}
