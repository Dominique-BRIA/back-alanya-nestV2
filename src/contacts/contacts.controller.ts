import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, MaxLength, IsBoolean, Matches } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { UserId } from '../common/current-user.decorator';
import { AppException } from '../common/http.exception';

const PUBLIC_NUMBER_REGEX = /^(\d{6}|\d{8})$/;

class AddContactDto {
  @IsString() @Matches(PUBLIC_NUMBER_REGEX, { message: 'Numéro invalide (6 ou 8 chiffres)' })
  publicNumber: string;
  @IsOptional() @IsString() @MaxLength(100) alias?: string;
}

class UpdateContactDto {
  @IsOptional() @IsString() @MaxLength(100) alias?: string | null;
  @IsOptional() @IsBoolean() isBlocked?: boolean;
}

@ApiTags('Contacts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('contacts')
export class ContactsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@UserId() userId: string) {
    const contacts = await this.prisma.contact.findMany({
      where: { userId },
      include: {
        contact: {
          select: { id: true, publicNumber: true, pseudo: true, avatarUrl: true, isOnline: true, lastSeen: true },
        },
      },
    });
    return {
      contacts: contacts.map((c) => ({
        id: c.id,
        alias: c.alias,
        isBlocked: c.isBlocked,
        createdAt: c.createdAt,
        user: c.contact,
      })),
    };
  }

  @Post()
  async add(@UserId() userId: string, @Body() dto: AddContactDto) {
    const target = await this.prisma.user.findUnique({ where: { publicNumber: dto.publicNumber } });
    if (!target) throw new AppException('Aucun utilisateur avec ce numéro', HttpStatus.NOT_FOUND, 'NOT_FOUND');
    if (target.id === userId) throw new AppException('Impossible de s\'ajouter soi-même', HttpStatus.BAD_REQUEST, 'SELF');

    const contact = await this.prisma.contact.upsert({
      where: { userId_contactId: { userId, contactId: target.id } },
      create: { userId, contactId: target.id, alias: dto.alias ?? null },
      update: { alias: dto.alias ?? null },
    });
    return { id: contact.id, contactId: target.id };
  }

  @Patch(':id')
  async update(@UserId() userId: string, @Param('id') id: string, @Body() dto: UpdateContactDto) {
    const contact = await this.prisma.contact.findFirst({ where: { id, userId } });
    if (!contact) throw new AppException('Contact introuvable', HttpStatus.NOT_FOUND, 'NOT_FOUND');

    const data: Record<string, unknown> = {};
    if (dto.alias !== undefined) data.alias = dto.alias;
    if (dto.isBlocked !== undefined) data.isBlocked = dto.isBlocked;

    return this.prisma.contact.update({ where: { id }, data });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@UserId() userId: string, @Param('id') id: string) {
    const contact = await this.prisma.contact.findFirst({ where: { id, userId } });
    if (!contact) throw new AppException('Contact introuvable', HttpStatus.NOT_FOUND, 'NOT_FOUND');
    await this.prisma.contact.delete({ where: { id } });
  }
}
