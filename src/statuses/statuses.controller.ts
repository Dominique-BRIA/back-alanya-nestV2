import {
  Controller, Get, Post, Delete, Param, Body,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, IsUUID, Matches } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { UserId } from '../common/current-user.decorator';
import { AppException } from '../common/http.exception';

const DAY_MS = 24 * 60 * 60 * 1000;

class CreateStatusDto {
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() text?: string;
  @IsOptional() @IsString() @Matches(/^#?[0-9a-fA-F]{6,8}$/) bgColor?: string;
  @IsOptional() @IsUUID() mediaId?: string;
}

@ApiTags('Statuses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('statuses')
export class StatusesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@UserId() userId: string) {
    const myContacts = await this.prisma.contact.findMany({
      where: { userId, isBlocked: false },
      select: { contactId: true },
    });
    const contactIds = myContacts.map((c) => c.contactId);
    const now = new Date();

    const statuses = await this.prisma.status.findMany({
      where: { userId: { in: [userId, ...contactIds] }, expiresAt: { gt: now } },
      orderBy: { createdAt: 'asc' },
      include: {
        user: true,
        views: { where: { viewerId: userId }, select: { id: true } },
        _count: { select: { views: true } },
      },
    });

    const byUser = new Map<string, typeof statuses>();
    for (const s of statuses) {
      if (!byUser.has(s.userId)) byUser.set(s.userId, []);
      byUser.get(s.userId)!.push(s);
    }

    const mapStatus = (s: (typeof statuses)[0]) => ({
      id: s.id, type: s.type, text: s.text, mediaUrl: s.mediaUrl,
      bgColor: s.bgColor, createdAt: s.createdAt, expiresAt: s.expiresAt,
      viewed: s.views.length > 0, viewsCount: s._count.views,
    });

    const buildGroup = (uid: string) => {
      const list = byUser.get(uid) ?? [];
      if (!list.length) return null;
      const u = list[0]!.user;
      return {
        userId: uid, pseudo: u.pseudo ?? null, avatarUrl: u.avatarUrl ?? null,
        publicNumber: u.publicNumber, hasUnviewed: list.some((s) => s.views.length === 0),
        statuses: list.map(mapStatus),
      };
    };

    const me = buildGroup(userId);
    const others = contactIds
      .map(buildGroup)
      .filter((g): g is NonNullable<typeof g> => g !== null)
      .sort((a, b) => Number(b.hasUnviewed) - Number(a.hasUnviewed));

    return { me, others };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@UserId() userId: string, @Body() dto: CreateStatusDto) {
    const type = dto.type ?? 'TEXT';

    let mediaUrl: string | null = null;
    if (dto.mediaId) {
      const media = await this.prisma.mediaFile.findUnique({ where: { id: dto.mediaId } });
      if (!media || media.ownerId !== userId)
        throw new AppException('Média introuvable', HttpStatus.NOT_FOUND, 'NOT_FOUND');
      mediaUrl = `/api/media/${media.id}`;
    }

    if (type === 'TEXT' && !dto.text)
      throw new AppException("Un statut TEXT requiert 'text'", HttpStatus.BAD_REQUEST, 'INVALID');
    if (type !== 'TEXT' && !dto.mediaId)
      throw new AppException("IMAGE/VIDEO requiert 'mediaId'", HttpStatus.BAD_REQUEST, 'INVALID');

    const bg = dto.bgColor ? (dto.bgColor.startsWith('#') ? dto.bgColor : `#${dto.bgColor}`) : null;

    const status = await this.prisma.status.create({
      data: {
        userId, type: type as any,
        text: dto.text ?? null, bgColor: bg, mediaUrl,
        expiresAt: new Date(Date.now() + DAY_MS),
      },
    });
    return { id: status.id, expiresAt: status.expiresAt };
  }

  @Post(':id/view')
  @HttpCode(HttpStatus.NO_CONTENT)
  async view(@UserId() userId: string, @Param('id') statusId: string) {
    const status = await this.prisma.status.findUnique({ where: { id: statusId } });
    if (!status || status.expiresAt < new Date())
      throw new AppException('Statut introuvable', HttpStatus.NOT_FOUND, 'NOT_FOUND');

    await this.prisma.statusView.upsert({
      where: { statusId_viewerId: { statusId, viewerId: userId } },
      create: { statusId, viewerId: userId },
      update: {},
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@UserId() userId: string, @Param('id') id: string) {
    const status = await this.prisma.status.findFirst({ where: { id, userId } });
    if (!status) throw new AppException('Statut introuvable', HttpStatus.NOT_FOUND, 'NOT_FOUND');
    await this.prisma.status.delete({ where: { id } });
  }
}
