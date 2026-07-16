import { Module } from '@nestjs/common';
import { ContactsController } from './contacts.controller';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [CommonModule],
  controllers: [ContactsController],
})
export class ContactsModule {}
