import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { UserId } from '../common/current-user.decorator';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /users/search?q=<pseudo|number> */
  @Get('search')
  async search(@UserId() userId: string, @Query('q') q: string) {
    if (!q || q.trim().length < 2) return { users: [] };

    const term = q.trim();
    const users = await this.prisma.user.findMany({
      where: {
        id: { not: userId },
        OR: [
          { publicNumber: { contains: term } },
          { pseudo: { contains: term, mode: 'insensitive' } },
          { email: { contains: term, mode: 'insensitive' } },
        ],
      },
      select: { id: true, publicNumber: true, pseudo: true, avatarUrl: true, isOnline: true },
      take: 20,
    });
    return { users };
  }

  /** GET /users/match?numbers[]=xxx&numbers[]=yyy
   * Trouve les utilisateurs Alanya parmi une liste de numéros publics.
   */
  @Get('match')
  async match(@UserId() userId: string, @Query('numbers') numbers: string | string[]) {
    const list = Array.isArray(numbers) ? numbers : [numbers].filter(Boolean);
    if (!list.length) return { users: [] };

    const users = await this.prisma.user.findMany({
      where: {
        publicNumber: { in: list },
        id: { not: userId },
      },
      select: { id: true, publicNumber: true, pseudo: true, avatarUrl: true, isOnline: true },
    });
    return { users };
  }
}
