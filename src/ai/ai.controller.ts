import {
  Controller, Get, Post, Body, Param,
  UseGuards, HttpCode, HttpStatus, HttpException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { UserId } from '../common/current-user.decorator';
import { AppException } from '../common/http.exception';
import { ConfigService } from '@nestjs/config';

class AiChatDto {
  @IsString() @MinLength(1, { message: 'Message vide' }) @MaxLength(8000) message: string;
}

const SYSTEM_PREAMBLE =
  "Tu es l'assistant intégré à Alanya, une messagerie. Réponds de façon concise, " +
  'utile et chaleureuse, en français par défaut (ou dans la langue de l\'utilisateur).';

@ApiTags('AI')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class AiController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** GET /ai/messages — liste les threads IA de l'utilisateur */
  @Get('ai/messages')
  async listThreads(@UserId() userId: string) {
    const threads = await this.prisma.aiThread.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, createdAt: true, updatedAt: true, _count: { select: { messages: true } } },
    });
    return { threads };
  }

  /** POST /ai/chat — envoie un message au thread IA (crée si absent) */
  @Post('ai/chat')
  @HttpCode(HttpStatus.OK)
  async chat(@UserId() userId: string, @Body() dto: AiChatDto) {
    // Récupère ou crée un thread
    let thread = await this.prisma.aiThread.findFirst({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: { messages: { orderBy: { createdAt: 'asc' }, take: 20 } },
    });

    if (!thread) {
      thread = await this.prisma.aiThread.create({
        data: { userId, title: dto.message.slice(0, 50) },
        include: { messages: true },
      });
    }

    // Persiste le message utilisateur
    await this.prisma.aiMessage.create({
      data: { threadId: thread.id, role: 'USER', content: dto.message },
    });

    // Historique pour Gemini
    const history = thread.messages.map((m) => ({
      role: m.role.toLowerCase() as 'user' | 'model',
      text: m.content,
    }));
    history.push({ role: 'user', text: dto.message });

    const reply = await this.generateGeminiReply(history);

    // Persiste la réponse IA
    const aiMsg = await this.prisma.aiMessage.create({
      data: { threadId: thread.id, role: 'MODEL', content: reply },
    });

    // Mise à jour du thread
    await this.prisma.aiThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });

    return { threadId: thread.id, message: { id: aiMsg.id, role: 'MODEL', content: reply, createdAt: aiMsg.createdAt } };
  }

  private async generateGeminiReply(history: { role: 'user' | 'model'; text: string }[]): Promise<string> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY', '');
    const model = this.config.get<string>('GEMINI_MODEL', 'gemini-2.5-flash');

    if (!apiKey) {
      const userMsgs = history.filter((t) => t.role === 'user');
      const last = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1]?.text ?? '' : '';
      return `🔌 (Mode démo — clé Gemini non configurée)\nConfigure GEMINI_API_KEY pour activer.\n\nTu as écrit : « ${last} »`;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PREAMBLE }] },
      contents: history.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
      generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
    };

    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new AppException(`Erreur Gemini ${res.status}: ${detail.slice(0, 200)}`, HttpStatus.BAD_GATEWAY, 'GEMINI_ERROR');
    }

    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    return text.trim() || '(réponse vide)';
  }
}
