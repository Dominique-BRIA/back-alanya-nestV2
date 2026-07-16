import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtTokenService } from './jwt-token.service';
import { MailerService } from './mailer.service';
import { JwtAuthGuard, SetupJwtGuard } from './jwt-auth.guard';

@Module({
  imports: [ConfigModule],
  providers: [JwtTokenService, MailerService, JwtAuthGuard, SetupJwtGuard],
  exports: [JwtTokenService, MailerService, JwtAuthGuard, SetupJwtGuard],
})
export class CommonModule {}
