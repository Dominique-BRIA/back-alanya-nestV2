import {
  Controller, Get, Post, Delete, Param, Body,
  UseGuards, HttpCode, HttpStatus, Query, Patch,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, IsArray, MaxLength, MinLength, Matches, IsUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { UserId } from '../common/current-user.decorator';
import { AppException } from '../common/http.exception';

const NUM_RE = /^(\d{6}|\d{8})$/;

class CreateConversationDto {
  @IsOptional() @IsString() @Matches(NUM_RE) publicNumber?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(150) name?: string;
  @IsOptional() @IsArray() memberNumbers?: string[];
}

class SendMessageDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(8000) content?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsUUID() mediaId?: string;
  @IsOptional() @IsUUID() replyToId?: string;
}

async function assertParticipant(prisma: PrismaService, convId: string, userId: string) {
  const p = await prisma.participant.findUnique({ where: { convId_userId: { convId, userId } } });
  if (!p) throw new AppException('Vous ne participez pas à cette conversation', HttpStatus.FORBIDDEN, 'FORBIDDEN');
  return p;
}

@ApiTags('Conversations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly prisma: PrismaService) {}

  // ── GET /conversations ─────────────────────────────────────────────────────
  @Get()
  async list(@UserId() userId: string) {
    const parts = await this.prisma.participant.findMany({
      where: { userId },
      include: {
        conv: {
          include: {
            participants: { include: { user: true } },
            messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        },
      },
    });

    parts.sort((a, b) => {
      const da = a.conv.messages[0]?.createdAt ?? a.conv.createdAt;
      const db = b.conv.messages[0]?.createdAt ?? b.conv.createdAt;
      return db.getTime() - da.getTime();
    });

    const conversations = await Promise.all(
      parts.map(async (p) => {
        const conv = p.conv;
        const last = conv.messages[0] ?? null;
        const unread = await this.prisma.message.count({
          where: {
            convId: conv.id,
            senderId: { not: userId },
            createdAt: p.lastReadAt ? { gt: p.lastReadAt } : undefined,
          },
        });
        const others = conv.participants.filter((pp) => pp.userId !== userId);
        const title = conv.isGroup ? conv.name : (others[0]?.user.pseudo ?? others[0]?.user.publicNumber ?? 'Inconnu');
        return {
          id: conv.id, isGroup: conv.isGroup, title,
          avatarUrl: conv.isGroup ? conv.avatarUrl : (others[0]?.user.avatarUrl ?? null),
          members: conv.participants.map((pp) => ({
            id: pp.userId, pseudo: pp.user.pseudo ?? null,
            publicNumber: pp.user.publicNumber,
            isOnline: pp.user.isOnline, lastSeen: pp.user.lastSeen ?? null,
          })),
          lastMessage: last ? { id: last.id, content: last.content, type: last.type, senderId: last.senderId, createdAt: last.createdAt } : null,
          unread,
          updatedAt: last?.createdAt ?? conv.createdAt,
        };
      }),
    );
    return { conversations };
  }

  // ── POST /conversations ────────────────────────────────────────────────────
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@UserId() userId: string, @Body() dto: CreateConversationDto) {
    if (dto.publicNumber) {
      const target = await this.prisma.user.findUnique({ where: { publicNumber: dto.publicNumber } });
      if (!target) throw new AppException('Aucun utilisateur avec ce numéro', HttpStatus.NOT_FOUND, 'NOT_FOUND');
      if (target.id === userId) throw new AppException('Conversation avec soi-même impossible', HttpStatus.BAD_REQUEST, 'SELF');

      const existing = await this.prisma.conversation.findFirst({
        where: { isGroup: false, AND: [{ participants: { some: { userId } } }, { participants: { some: { userId: target.id } } }] },
        include: { participants: true },
      });
      const conv = (existing && existing.participants.length === 2)
        ? existing
        : await this.prisma.conversation.create({
            data: { isGroup: false, participants: { create: [{ userId }, { userId: target.id }] } },
            include: { participants: true },
          });
      return { id: conv.id, isGroup: false };
    }

    if (!dto.name || !dto.memberNumbers?.length) {
      throw new AppException('Fournir publicNumber ou name+memberNumbers', HttpStatus.BAD_REQUEST, 'INVALID');
    }

    const members = await this.prisma.user.findMany({ where: { publicNumber: { in: dto.memberNumbers } }, select: { id: true } });
    const memberIds = new Set(members.map((m) => m.id));
    memberIds.add(userId);

    const conv = await this.prisma.conversation.create({
      data: {
        isGroup: true, name: dto.name,
        participants: { create: Array.from(memberIds).map((id) => ({ userId: id, role: id === userId ? 'ADMIN' : 'MEMBER' })) },
      },
    });
    return { id: conv.id, isGroup: true };
  }

  // ── GET /conversations/:id/messages ───────────────────────────────────────
  @Get(':id/messages')
  async getMessages(
    @UserId() userId: string,
    @Param('id') convId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitStr?: string,
  ) {
    await assertParticipant(this.prisma, convId, userId);
    const limit = Math.min(Number(limitStr ?? 50), 100);

    const messages = await this.prisma.message.findMany({
      where: { convId, hides: { none: { userId } } },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { media: true },
    });

    const hasMore = messages.length > limit;
    const page = hasMore ? messages.slice(0, limit) : messages;

    const replyIds = [...new Set(page.map((m) => m.replyToId).filter(Boolean))] as string[];
    const replyTargets = replyIds.length > 0
      ? await this.prisma.message.findMany({ where: { id: { in: replyIds } }, select: { id: true, senderId: true, content: true, type: true, deletedAt: true } })
      : [];
    const replyMap = new Map<string, { id: string; senderId: string; content: string | null; type: string; deletedAt: Date | null }>(replyTargets.map((t) => [t.id, t]));

    return {
      messages: page.map((m) => {
        let replyTo = null;
        if (m.replyToId && replyMap.has(m.replyToId)) {
          const t = replyMap.get(m.replyToId)!;
          replyTo = { id: m.replyToId, senderId: t.senderId, type: t.type, content: t.deletedAt ? null : t.content, isDeleted: t.deletedAt !== null };
        }
        return {
          id: m.id, convId: m.convId, senderId: m.senderId, content: m.content,
          type: m.type, status: m.status, replyToId: m.replyToId, replyTo,
          deletedAt: m.deletedAt,
          media: m.media.map((f) => ({ id: f.id, url: `/api/media/${f.id}`, filename: f.filename, mimeType: f.mimeType, sizeBytes: f.sizeBytes, durationMs: f.durationMs })),
          createdAt: m.createdAt,
        };
      }),
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    };
  }

  // ── POST /conversations/:id/messages ──────────────────────────────────────
  @Post(':id/messages')
  @HttpCode(HttpStatus.CREATED)
  async sendMessage(@UserId() userId: string, @Param('id') convId: string, @Body() dto: SendMessageDto) {
    await assertParticipant(this.prisma, convId, userId);

    const message = await this.prisma.message.create({
      data: {
        convId, senderId: userId,
        content: dto.content ?? null,
        type: (dto.type ?? 'TEXT') as any,
        replyToId: dto.replyToId,
        status: 'SENT',
        ...(dto.mediaId ? { media: { connect: { id: dto.mediaId } } } : {}),
      },
      include: { media: true },
    });

    await this.prisma.conversation.update({ where: { id: convId }, data: { updatedAt: new Date() } });

    return {
      id: message.id, convId: message.convId, senderId: message.senderId,
      content: message.content, type: message.type, status: message.status,
      replyToId: message.replyToId,
      media: message.media.map((f) => ({ id: f.id, url: `/api/media/${f.id}`, filename: f.filename, mimeType: f.mimeType, sizeBytes: f.sizeBytes, durationMs: f.durationMs })),
      createdAt: message.createdAt,
    };
  }

  // ── PATCH /conversations/:id/messages/:messageId ───────────────────────────
  @Patch(':id/messages/:messageId')
  async editMessage(
    @UserId() userId: string,
    @Param('id') convId: string,
    @Param('messageId') messageId: string,
    @Body() body: { content?: string },
  ) {
    await assertParticipant(this.prisma, convId, userId);
    const message = await this.prisma.message.findFirst({ where: { id: messageId, convId, senderId: userId } });
    if (!message) throw new AppException('Message introuvable', HttpStatus.NOT_FOUND, 'NOT_FOUND');

    return this.prisma.message.update({
      where: { id: messageId },
      data: { content: body.content, editedAt: new Date() },
    });
  }

  // ── DELETE /conversations/:id/messages/:messageId ──────────────────────────
  @Delete(':id/messages/:messageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMessage(
    @UserId() userId: string,
    @Param('id') convId: string,
    @Param('messageId') messageId: string,
    @Query('forMe') forMe?: string,
  ) {
    await assertParticipant(this.prisma, convId, userId);
    if (forMe === '1' || forMe === 'true') {
      await this.prisma.messageHide.upsert({
        where: { userId_messageId: { userId, messageId } },
        create: { userId, messageId },
        update: {},
      });
    } else {
      const message = await this.prisma.message.findFirst({ where: { id: messageId, convId, senderId: userId } });
      if (!message) throw new AppException('Message introuvable', HttpStatus.NOT_FOUND, 'NOT_FOUND');
      await this.prisma.message.update({ where: { id: messageId }, data: { deletedAt: new Date(), content: null } });
    }
  }

  // ── POST /conversations/:id/messages/forward ──────────────────────────────
  @Post(':id/messages/forward')
  @HttpCode(HttpStatus.CREATED)
  async forwardMessage(
    @UserId() userId: string,
    @Param('id') targetConvId: string,
    @Body() body: { messageId: string },
  ) {
    await assertParticipant(this.prisma, targetConvId, userId);
    const original = await this.prisma.message.findUnique({ where: { id: body.messageId }, include: { media: true } });
    if (!original) throw new AppException('Message introuvable', HttpStatus.NOT_FOUND, 'NOT_FOUND');

    const forwarded = await this.prisma.message.create({
      data: {
        convId: targetConvId, senderId: userId,
        content: original.content, type: original.type, status: 'SENT',
        ...(original.media.length ? { media: { connect: original.media.map((f) => ({ id: f.id })) } } : {}),
      },
      include: { media: true },
    });
    return { id: forwarded.id };
  }

  // ── POST /conversations/:id/read ──────────────────────────────────────────
  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markRead(@UserId() userId: string, @Param('id') convId: string) {
    await assertParticipant(this.prisma, convId, userId);
    await this.prisma.participant.update({
      where: { convId_userId: { convId, userId } },
      data: { lastReadAt: new Date() },
    });
  }
}
