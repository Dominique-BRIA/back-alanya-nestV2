import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';

import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { GlobalExceptionFilter } from './common/global-exception.filter';

import { AuthModule } from './auth/auth.module';
import { AccountModule } from './account/account.module';
import { ContactsModule } from './contacts/contacts.module';
import { ConversationsModule } from './conversations/conversations.module';
import { CallsModule } from './calls/calls.module';
import { MediaModule } from './media/media.module';
import { StatusesModule } from './statuses/statuses.module';
import { MeetingsModule } from './meetings/meetings.module';
import { BlockedModule } from './blocked/blocked.module';
import { UsersModule } from './users/users.module';
import { PaysModule } from './pays/pays.module';
import { AiModule } from './ai/ai.module';
import { PushModule } from './push/push.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    PrismaModule,
    CommonModule,
    AuthModule,
    AccountModule,
    ContactsModule,
    ConversationsModule,
    CallsModule,
    MediaModule,
    StatusesModule,
    MeetingsModule,
    BlockedModule,
    UsersModule,
    PaysModule,
    AiModule,
    PushModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
