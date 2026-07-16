import { Controller, Get, Patch, Body, UseGuards, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, MaxLength, MinLength, Matches } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { UserId } from '../common/current-user.decorator';
import { AppException } from '../common/http.exception';

class UpdateProfileDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) pseudo?: string;
  @IsOptional() @IsString() @MaxLength(2048)
  @Matches(/^(https?:\/\/[^\s]+|\/api\/media\/[a-zA-Z0-9-]+)$/, { message: 'avatarUrl invalide' })
  avatarUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(255) statusMsg?: string | null;
}

@ApiTags('Account')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class AccountController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  async getMe(@UserId() userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, publicNumber: true, pseudo: true, avatarUrl: true,
        statusMsg: true, isOnline: true, lastSeen: true, createdAt: true,
        nom: true, idPays: true, typeCompte: true,
      },
    });
    if (!user) throw new AppException('Utilisateur introuvable', HttpStatus.NOT_FOUND, 'NOT_FOUND');
    return user;
  }

  @Get('account/profile')
  async getProfile(@UserId() userId: string) {
    return this.getMe(userId);
  }

  @Patch('account/profile')
  async updateProfile(@UserId() userId: string, @Body() dto: UpdateProfileDto) {
    const data: Record<string, unknown> = {};
    if (dto.pseudo !== undefined) data.pseudo = dto.pseudo;
    if (dto.avatarUrl !== undefined) data.avatarUrl = dto.avatarUrl ?? null;
    if (dto.statusMsg !== undefined) data.statusMsg = dto.statusMsg ?? null;

    const user = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true, pseudo: true, avatarUrl: true, statusMsg: true },
    });
    return user;
  }
}
