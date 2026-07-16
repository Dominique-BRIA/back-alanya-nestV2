import {
  Controller, Post, Delete, Body,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { UserId } from '../common/current-user.decorator';

class RegisterPushDto {
  @IsString() @MaxLength(512) token: string;
  @IsString() @MaxLength(16) platform: string; // android | ios | web
}

class UnregisterPushDto {
  @IsString() @MaxLength(512) token: string;
}

@ApiTags('Push')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('push')
export class PushController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('register')
  @HttpCode(HttpStatus.OK)
  async register(@UserId() userId: string, @Body() dto: RegisterPushDto) {
    await this.prisma.pushDevice.upsert({
      where: { token: dto.token },
      create: { userId, token: dto.token, platform: dto.platform },
      update: { userId, platform: dto.platform, updatedAt: new Date() },
    });
    return { registered: true };
  }

  @Delete('register')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unregister(@UserId() userId: string, @Body() dto: UnregisterPushDto) {
    await this.prisma.pushDevice.deleteMany({ where: { userId, token: dto.token } });
  }
}
