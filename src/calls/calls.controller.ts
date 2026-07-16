import {
  Controller, Get, Post, Param, Body,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { UserId } from '../common/current-user.decorator';
import { AppException } from '../common/http.exception';

class CreateCallDto {
  @IsString() convId: string;
  @IsOptional() @IsString() type?: string;
}

@ApiTags('Calls')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('calls')
export class CallsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@UserId() userId: string) {
    const parts = await this.prisma.callParticipant.findMany({
      where: { userId },
      orderBy: { call: { startedAt: 'desc' } },
      take: 50,
      include: { call: { include: { initiator: true, participants: { include: { user: true } } } } },
    });

    const convIds = [...new Set(parts.map((p) => p.call.convId).filter(Boolean))] as string[];
    const convs = await this.prisma.conversation.findMany({ where: { id: { in: convIds } }, select: { id: true, isGroup: true, name: true } });
    const convMap = new Map<string, { id: string; isGroup: boolean; name: string | null }>(convs.map((c) => [c.id, c]));

    const calls = parts.map((p) => {
      const c = p.call;
      const others = c.participants.filter((pp) => pp.userId !== userId);
      const conv = c.convId ? convMap.get(c.convId) : null;
      const isGroup = conv?.isGroup ?? false;
      const peer = others[0]?.user;
      const peerName = isGroup ? (conv?.name ?? 'Groupe') : (peer?.pseudo ?? peer?.publicNumber ?? 'Inconnu');
      return {
        id: c.id, convId: c.convId, type: c.type, status: c.status,
        isOutgoing: c.initiatorId === userId, isGroup, peerName,
        peerNumber: isGroup ? null : (peer?.publicNumber ?? null),
        peerAvatarUrl: isGroup ? null : (peer?.avatarUrl ?? null),
        participantCount: c.participants.length,
        startedAt: c.startedAt, answeredAt: c.answeredAt, endedAt: c.endedAt,
        durationSec: c.answeredAt && c.endedAt ? Math.round((c.endedAt.getTime() - c.answeredAt.getTime()) / 1000) : null,
      };
    });

    const seen = new Set<string>();
    const unique = calls.filter((c) => { if (seen.has(c.id)) return false; seen.add(c.id); return true; });
    return { calls: unique };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@UserId() userId: string, @Body() dto: CreateCallDto) {
    const { convId, type = 'AUDIO' } = dto;

    // Cleanup stale calls
    const staleThreshold = new Date(Date.now() - 2 * 60 * 1000);
    const staleCalls = await this.prisma.callParticipant.findMany({
      where: { userId, leftAt: null, call: { status: 'RINGING', startedAt: { lt: staleThreshold } } },
      select: { callId: true },
    });
    if (staleCalls.length > 0) {
      const ids = staleCalls.map((s) => s.callId);
      await this.prisma.call.updateMany({ where: { id: { in: ids } }, data: { status: 'ENDED', endedAt: new Date() } });
      await this.prisma.callParticipant.updateMany({ where: { callId: { in: ids } }, data: { leftAt: new Date() } });
    }

    const busy = await this.prisma.callParticipant.findFirst({
      where: { userId, joinedAt: { not: null }, leftAt: null, call: { status: { in: ['RINGING', 'ONGOING'] } } },
    });
    if (busy) throw new AppException('Vous êtes déjà en appel', HttpStatus.CONFLICT, 'BUSY');

    const convParts = await this.prisma.participant.findMany({ where: { convId }, select: { userId: true } });
    const memberIds = convParts.map((p) => p.userId);

    const call = await this.prisma.call.create({
      data: {
        initiatorId: userId, convId, type: type as any, status: 'RINGING',
        participants: { create: memberIds.map((id) => ({ userId: id, joinedAt: id === userId ? new Date() : null })) },
      },
      include: { initiator: true, participants: { include: { user: true } } },
    });

    const callees = call.participants
      .filter((p) => p.userId !== userId)
      .map((p) => ({ userId: p.userId, pseudo: p.user.pseudo ?? null, publicNumber: p.user.publicNumber }));

    const conv = convId ? await this.prisma.conversation.findUnique({ where: { id: convId }, select: { isGroup: true, name: true, _count: { select: { participants: true } } } }) : null;
    return {
      id: call.id, convId: call.convId, type: call.type, status: call.status,
      isGroup: conv?.isGroup ?? false, groupName: conv?.name ?? null,
      memberCount: conv?._count?.participants ?? callees.length + 1,
      callees, callerName: call.initiator.pseudo ?? call.initiator.publicNumber,
    };
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  async accept(@UserId() userId: string, @Param('id') callId: string) {
    const call = await this.prisma.call.findUnique({ where: { id: callId } });
    if (!call) throw new AppException('Appel introuvable', HttpStatus.NOT_FOUND, 'NOT_FOUND');

    await this.prisma.callParticipant.updateMany({ where: { callId, userId }, data: { joinedAt: new Date() } });
    await this.prisma.call.update({ where: { id: callId }, data: { status: 'ONGOING', answeredAt: new Date() } });
    return { id: callId, status: 'ONGOING' };
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  async reject(@UserId() userId: string, @Param('id') callId: string) {
    await this.prisma.callParticipant.updateMany({ where: { callId, userId }, data: { leftAt: new Date() } });
    const call = await this.prisma.call.findUnique({ where: { id: callId }, include: { participants: true } });
    if (!call) throw new AppException('Appel introuvable', HttpStatus.NOT_FOUND, 'NOT_FOUND');
    const activeLeft = call.participants.filter((p) => p.userId !== call.initiatorId && p.leftAt !== null);
    if (activeLeft.length === call.participants.length - 1) {
      await this.prisma.call.update({ where: { id: callId }, data: { status: 'REJECTED', endedAt: new Date() } });
    }
    return { id: callId };
  }

  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  async end(@Param('id') callId: string) {
    await this.prisma.call.update({ where: { id: callId }, data: { status: 'ENDED', endedAt: new Date() } });
    await this.prisma.callParticipant.updateMany({ where: { callId, leftAt: null }, data: { leftAt: new Date() } });
    return { id: callId, status: 'ENDED' };
  }

  @Post(':id/leave')
  @HttpCode(HttpStatus.OK)
  async leave(@UserId() userId: string, @Param('id') callId: string) {
    await this.prisma.callParticipant.updateMany({ where: { callId, userId }, data: { leftAt: new Date() } });
    const remaining = await this.prisma.callParticipant.count({ where: { callId, leftAt: null } });
    if (remaining === 0) {
      await this.prisma.call.update({ where: { id: callId }, data: { status: 'ENDED', endedAt: new Date() } });
    }
    return { id: callId };
  }

  @Get('ice')
  getIceServers() {
    // Retourne les serveurs ICE configurés (STUN/TURN)
    const stunRaw = process.env.STUN_URLS ?? 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302';
    const servers: any[] = stunRaw.split(',').map((url) => ({ urls: url.trim() }));
    const turnUrl = process.env.TURN_URL;
    if (turnUrl) {
      const entry: any = { urls: turnUrl };
      if (process.env.TURN_USERNAME) entry.username = process.env.TURN_USERNAME;
      if (process.env.TURN_CREDENTIAL) entry.credential = process.env.TURN_CREDENTIAL;
      servers.push(entry);
    }
    return { iceServers: servers };
  }
}
