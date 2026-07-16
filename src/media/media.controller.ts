import {
  Controller, Get, Post, Delete, Param,
  UseGuards, HttpCode, HttpStatus, HttpException,
  UseInterceptors, UploadedFile, Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { Response } from 'express';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { UserId } from '../common/current-user.decorator';
import { AppException } from '../common/http.exception';
import { ConfigService } from '@nestjs/config';

const ALLOWED_MIME = new Set([
  'image/jpeg','image/png','image/gif','image/webp','image/heic','image/heif',
  'audio/mpeg','audio/mp4','audio/aac','audio/ogg','audio/webm','audio/wav',
  'video/mp4','video/webm','video/quicktime',
  'application/pdf','application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain','text/csv','application/zip','application/octet-stream',
]);

function isAllowedMime(mime: string): boolean {
  return ALLOWED_MIME.has(mime) || mime.startsWith('text/');
}

@ApiTags('Media')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('media')
export class MediaController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get storageDir(): string {
    const dir = this.config.get<string>('MEDIA_STORAGE_DIR', './storage/media');
    return path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
  }

  private get maxSizeBytes(): number {
    return Number(this.config.get<string>('MEDIA_MAX_SIZE_MB', '50')) * 1024 * 1024;
  }

  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async upload(@UserId() userId: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new AppException("Champ 'file' manquant", HttpStatus.BAD_REQUEST, 'NO_FILE');
    if (!isAllowedMime(file.mimetype)) throw new AppException(`Type non autorisé : ${file.mimetype}`, 415, 'BAD_MIME');
    if (file.size > this.maxSizeBytes) throw new AppException(`Fichier trop volumineux`, 413, 'TOO_LARGE');

    const day = new Date().toISOString().slice(0, 10);
    const ext = path.extname(file.originalname) || '';
    const storedName = `${crypto.randomUUID()}${ext}`;
    const relativeUrl = `${day}/${storedName}`;

    const dir = path.join(this.storageDir, day);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(this.storageDir, relativeUrl), file.buffer);

    const media = await this.prisma.mediaFile.create({
      data: {
        ownerId: userId,
        filename: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        url: relativeUrl,
        durationMs: null,
      },
    });

    return { id: media.id, url: `/api/media/${media.id}`, mimeType: media.mimeType, sizeBytes: media.sizeBytes, durationMs: null };
  }

  @Get(':id')
  async serve(@UserId() userId: string, @Param('id') id: string, @Res() res: Response) {
    const media = await this.prisma.mediaFile.findUnique({ where: { id } });
    if (!media) throw new AppException('Média introuvable', HttpStatus.NOT_FOUND, 'NOT_FOUND');

    // Access control: owner or participant in a conversation that has this media
    if (media.ownerId !== userId) {
      if (media.messageId) {
        const msg = await this.prisma.message.findUnique({ where: { id: media.messageId } });
        if (msg) {
          const participant = await this.prisma.participant.findUnique({ where: { convId_userId: { convId: msg.convId, userId } } });
          if (!participant) throw new AppException('Accès refusé', HttpStatus.FORBIDDEN, 'FORBIDDEN');
        }
      }
    }

    const safe = path.normalize(media.url).replace(/^(\.\.([/\\]|$))+/, '');
    const filePath = path.join(this.storageDir, safe);
    res.setHeader('Content-Type', media.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${media.filename}"`);
    return res.sendFile(filePath);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@UserId() userId: string, @Param('id') id: string) {
    const media = await this.prisma.mediaFile.findUnique({ where: { id } });
    if (!media || media.ownerId !== userId) throw new AppException('Média introuvable', HttpStatus.NOT_FOUND, 'NOT_FOUND');

    await this.prisma.mediaFile.delete({ where: { id } });
    const safe = path.normalize(media.url).replace(/^(\.\.([/\\]|$))+/, '');
    await fs.unlink(path.join(this.storageDir, safe)).catch(() => undefined);
  }
}
