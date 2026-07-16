import {
  Controller, Get, Post, Delete, Param, Body,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { UserId } from '../common/current-user.decorator';
import { AppException } from '../common/http.exception';

class BlockUserDto {
  @IsString()
  @Matches(/^(\d{6}|\d{8})$/, { message: 'Numéro invalide' })
  publicNumber: string;
}

@ApiTags('Blocked')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('blocked')
export class BlockedController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@UserId() userId: string) {
    const blocked = await this.prisma.blocked.findMany({
      where: { alanyaID: userId },
      include: {
        blockedUser: {
          select: { id: true, publicNumber: true, pseudo: true, avatarUrl: true },
        },
      },
      orderBy: { dateBlock: 'desc' },
    });
    return {
      blocked: blocked.map((b) => ({
        idBlock: b.idBlock, dateBlock: b.dateBlock, user: b.blockedUser,
      })),
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async block(@UserId() userId: string, @Body() dto: BlockUserDto) {
    const target = await this.prisma.user.findUnique({ where: { publicNumber: dto.publicNumber } });
    if (!target) throw new AppException('Utilisateur introuvable', HttpStatus.NOT_FOUND, 'NOT_FOUND');
    if (target.id === userId) throw new AppException('Impossible de se bloquer soi-même', HttpStatus.BAD_REQUEST, 'SELF');

    const existing = await this.prisma.blocked.findFirst({
      where: { alanyaID: userId, idCallerBlock: target.id },
    });
    if (existing) return { idBlock: existing.idBlock };

    const b = await this.prisma.blocked.create({
      data: { alanyaID: userId, idCallerBlock: target.id },
    });
    return { idBlock: b.idBlock };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unblock(@UserId() userId: string, @Param('id') idStr: string) {
    const idBlock = parseInt(idStr, 10);
    const b = await this.prisma.blocked.findFirst({ where: { idBlock, alanyaID: userId } });
    if (!b) throw new AppException('Entrée introuvable', HttpStatus.NOT_FOUND, 'NOT_FOUND');
    await this.prisma.blocked.delete({ where: { idBlock } });
  }
}
