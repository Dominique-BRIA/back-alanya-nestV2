import { Module } from '@nestjs/common';
import { AccountController } from './account.controller';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [CommonModule],
  controllers: [AccountController],
})
export class AccountModule {}
