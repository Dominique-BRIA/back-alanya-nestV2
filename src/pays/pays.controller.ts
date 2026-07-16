import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';

@ApiTags('Pays')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('pays')
export class PaysController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    const pays = await this.prisma.pays.findMany({
      orderBy: { libelle: 'asc' },
      select: { idPays: true, libelle: true, prefix: true, timeZone: true, decalageHoraire: true },
    });
    return { pays };
  }
}
