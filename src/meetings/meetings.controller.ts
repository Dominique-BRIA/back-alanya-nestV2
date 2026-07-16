import {
  Controller, Get, Post, Patch, Delete, Param, Body,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import {
  IsString, IsInt, IsOptional, Min, Max,
  IsArray, MinLength, MaxLength,
} from 'class-validator';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { UserId } from '../common/current-user.decorator';
import { AppException } from '../common/http.exception';

class CreateMeetingDto {
  @IsString() @MinLength(1) @MaxLength(200) objet: string;
  @IsInt() @Min(1) @Max(2) type_media: number;
  @IsOptional() @IsString() start_time?: string;
  @IsOptional() @IsInt() @Min(1) @Max(86400) duree?: number;
  @IsOptional() @IsString() @MaxLength(200) room?: string;
  @IsOptional() @IsArray() participantNumbers?: string[];
}

class UpdateMeetingParticipantDto {
  @IsOptional() @IsInt() @Min(0) @Max(2) status?: number;
}

@ApiTags('Meetings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('meetings')
export class MeetingsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@UserId() userId: string) {
    const meetings = await this.prisma.meeting.findMany({
      where: { OR: [{ idOrganiser: userId }, { participants: { some: { IDparticipant: userId } } }] },
      orderBy: { start_time: 'desc' },
      include: { organiser: true, participants: { include: { user: true } } },
    });
    return {
      meetings: meetings.map((m) => ({
        idMeeting: m.idMeeting, objet: m.objet, type_media: m.type_media,
        room: m.room, isEnd: m.isEnd, start_time: m.start_time, duree: m.duree,
        organiser: { id: m.organiser.id, pseudo: m.organiser.pseudo ?? null, publicNumber: m.organiser.publicNumber, avatarUrl: m.organiser.avatarUrl ?? null },
        participants: m.participants.map((p) => ({
          ID: p.ID, IDparticipant: p.IDparticipant,
          pseudo: p.user.pseudo ?? null, publicNumber: p.user.publicNumber,
          avatarUrl: p.user.avatarUrl ?? null, status: p.status,
          connecte: p.connecte, start_time: p.start_time, duree: p.duree,
        })),
      })),
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@UserId() userId: string, @Body() dto: CreateMeetingDto) {
    let participantIds: string[] = [];
    if (dto.participantNumbers?.length) {
      const users = await this.prisma.user.findMany({
        where: { publicNumber: { in: dto.participantNumbers } },
        select: { id: true, publicNumber: true },
      });
      const foundNumbers = new Set(users.map((u) => u.publicNumber));
      const missing = dto.participantNumbers.filter((n) => !foundNumbers.has(n));
      if (missing.length > 0)
        throw new AppException(`Numéro(s) introuvable(s) : ${missing.join(', ')}`, HttpStatus.NOT_FOUND, 'NOT_FOUND');
      participantIds = users.map((u) => u.id).filter((id) => id !== userId);
    }

    const room = dto.room ?? `room-${randomUUID().slice(0, 8)}`;
    const meeting = await this.prisma.meeting.create({
      data: {
        idOrganiser: userId, objet: dto.objet, type_media: dto.type_media,
        start_time: dto.start_time ? new Date(dto.start_time) : new Date(),
        duree: dto.duree ?? 3600, room, isEnd: 0,
        participants: { create: participantIds.map((id) => ({ IDparticipant: id, status: 0 })) },
      },
      include: { participants: true },
    });
    return {
      idMeeting: meeting.idMeeting, objet: meeting.objet, type_media: meeting.type_media,
      room: meeting.room, start_time: meeting.start_time, duree: meeting.duree,
      isEnd: meeting.isEnd, participantCount: meeting.participants.length,
    };
  }

  @Get(':id')
  async getOne(@UserId() userId: string, @Param('id') idStr: string) {
    const idMeeting = parseInt(idStr, 10);
    const meeting = await this.prisma.meeting.findUnique({
      where: { idMeeting },
      include: { organiser: true, participants: { include: { user: true } } },
    });
    if (!meeting) throw new AppException('Réunion introuvable', HttpStatus.NOT_FOUND, 'NOT_FOUND');
    const isMember = meeting.idOrganiser === userId || meeting.participants.some((p) => p.IDparticipant === userId);
    if (!isMember) throw new AppException('Accès refusé', HttpStatus.FORBIDDEN, 'FORBIDDEN');
    return meeting;
  }

  @Post(':id/join')
  @HttpCode(HttpStatus.OK)
  async join(@UserId() userId: string, @Param('id') idStr: string) {
    const idMeeting = parseInt(idStr, 10);
    await this.prisma.meetingParticipant.updateMany({
      where: { idMeeting, IDparticipant: userId },
      data: { connecte: 1, start_time: new Date() },
    });
    return { idMeeting };
  }

  @Post(':id/leave')
  @HttpCode(HttpStatus.OK)
  async leave(@UserId() userId: string, @Param('id') idStr: string) {
    const idMeeting = parseInt(idStr, 10);
    const part = await this.prisma.meetingParticipant.findFirst({ where: { idMeeting, IDparticipant: userId } });
    const durationSec = part?.start_time ? Math.round((Date.now() - part.start_time.getTime()) / 1000) : null;
    await this.prisma.meetingParticipant.updateMany({
      where: { idMeeting, IDparticipant: userId },
      data: { connecte: 0, duree: durationSec },
    });
    return { idMeeting };
  }

  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  async end(@UserId() userId: string, @Param('id') idStr: string) {
    const idMeeting = parseInt(idStr, 10);
    const meeting = await this.prisma.meeting.findUnique({ where: { idMeeting } });
    if (!meeting || meeting.idOrganiser !== userId)
      throw new AppException('Non autorisé', HttpStatus.FORBIDDEN, 'FORBIDDEN');
    await this.prisma.meeting.update({ where: { idMeeting }, data: { isEnd: 1 } });
    return { idMeeting, isEnd: 1 };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@UserId() userId: string, @Param('id') idStr: string) {
    const idMeeting = parseInt(idStr, 10);
    const meeting = await this.prisma.meeting.findUnique({ where: { idMeeting } });
    if (!meeting || meeting.idOrganiser !== userId)
      throw new AppException('Non autorisé', HttpStatus.FORBIDDEN, 'FORBIDDEN');
    await this.prisma.meeting.delete({ where: { idMeeting } });
  }
}
