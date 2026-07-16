import {
  Injectable,
  HttpStatus,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../common/mailer.service';
import { JwtTokenService } from '../common/jwt-token.service';
import { AppException } from '../common/http.exception';
import { RegisterDto } from './dto/register.dto';
import { VerifyDto } from './dto/verify.dto';
import { SetupDto } from './dto/setup.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ConfigService } from '@nestjs/config';

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function generateOtpCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function hashOtp(code: string): Promise<string> {
  return bcrypt.hash(code, 10);
}

async function verifyOtp(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash);
}

async function hashPassword(pwd: string): Promise<string> {
  return bcrypt.hash(pwd, 10);
}

async function verifyPassword(pwd: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pwd, hash);
}

/** Génère un numéro public unique à 8 chiffres */
async function generateUniquePublicNumber(prisma: PrismaService): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const num = (10000000 + Math.floor(Math.random() * 90000000)).toString();
    const existing = await prisma.user.findUnique({ where: { publicNumber: num } });
    if (!existing) return num;
  }
  throw new Error('Impossible de générer un numéro public unique');
}

const REFRESH_TTL_DAYS = 7;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly jwt: JwtTokenService,
    private readonly config: ConfigService,
  ) {}

  private get otpTtlMinutes(): number {
    return Number(this.config.get<string>('OTP_TTL_MINUTES', '10'));
  }

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing?.emailVerified && existing.passwordHash) {
      throw new AppException('Un compte existe déjà avec cet email', HttpStatus.CONFLICT, 'EMAIL_TAKEN');
    }

    const code = generateOtpCode();
    const codeHash = await hashOtp(code);
    const expiresAt = new Date(Date.now() + this.otpTtlMinutes * 60 * 1000);

    await this.prisma.emailVerification.updateMany({
      where: { email, consumed: false },
      data: { consumed: true },
    });
    await this.prisma.emailVerification.create({ data: { email, codeHash, expiresAt } });

    await this.mailer.sendOtpEmail(email, code);

    return { message: 'Code de confirmation envoyé', email };
  }

  async verify(dto: VerifyDto) {
    const email = dto.email.trim().toLowerCase();

    const record = await this.prisma.emailVerification.findFirst({
      where: { email, consumed: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) {
      throw new AppException('Code invalide ou expiré', HttpStatus.BAD_REQUEST, 'BAD_OTP');
    }
    if (record.attempts >= 5) {
      throw new AppException('Trop de tentatives', HttpStatus.TOO_MANY_REQUESTS, 'MAX_ATTEMPTS');
    }

    const valid = await verifyOtp(dto.code, record.codeHash);
    if (!valid) {
      await this.prisma.emailVerification.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw new AppException('Code incorrect', HttpStatus.BAD_REQUEST, 'BAD_OTP');
    }

    await this.prisma.emailVerification.update({ where: { id: record.id }, data: { consumed: true } });

    // Upsert user
    let user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      const publicNumber = await generateUniquePublicNumber(this.prisma);
      user = await this.prisma.user.create({ data: { email, emailVerified: true, publicNumber } });
    } else {
      user = await this.prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } });
    }

    const setupToken = this.jwt.signSetupToken(user.id);
    return { setupToken, email: user.email };
  }

  async setup(userId: string, dto: SetupDto) {
    const passwordHash = await hashPassword(dto.password);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        pseudo: dto.pseudo,
        passwordHash,
        nom: dto.nom ?? null,
        idPays: dto.idPays ?? null,
      },
    });

    const tokens = await this.issueTokenPair(user.id);
    return {
      user: {
        id: user.id,
        email: user.email,
        publicNumber: user.publicNumber,
        pseudo: user.pseudo ?? null,
        avatarUrl: user.avatarUrl ?? null,
      },
      ...tokens,
    };
  }

  async login(dto: LoginDto) {
    const identifier = dto.identifier.trim();
    const isPublicNumber = /^(\d{6}|\d{8})$/.test(identifier);

    const user = await this.prisma.user.findFirst({
      where: isPublicNumber
        ? { publicNumber: identifier }
        : { email: identifier.toLowerCase() },
    });

    if (!user || !user.passwordHash) {
      throw new AppException('Identifiants incorrects', HttpStatus.UNAUTHORIZED, 'BAD_CREDENTIALS');
    }
    const valid = await verifyPassword(dto.password, user.passwordHash);
    if (!valid) {
      throw new AppException('Identifiants incorrects', HttpStatus.UNAUTHORIZED, 'BAD_CREDENTIALS');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { isOnline: 1, lastSeen: new Date() },
    });

    const tokens = await this.issueTokenPair(user.id);
    return {
      user: {
        id: user.id,
        email: user.email,
        publicNumber: user.publicNumber,
        pseudo: user.pseudo ?? null,
        avatarUrl: user.avatarUrl ?? null,
        isOnline: 1,
      },
      ...tokens,
    };
  }

  async logout(refreshToken: string) {
    await this.prisma.refreshToken
      .updateMany({ where: { tokenHash: sha256(refreshToken) }, data: { revoked: true } })
      .catch(() => undefined);
  }

  async refresh(refreshToken: string) {
    let payload: { sub: string; scope: string };
    try {
      payload = this.jwt.verifyRefreshToken(refreshToken) as any;
    } catch {
      throw new AppException('Refresh token invalide', HttpStatus.UNAUTHORIZED, 'INVALID_REFRESH');
    }

    if (payload.scope !== 'refresh') {
      throw new AppException('Token invalide', HttpStatus.UNAUTHORIZED, 'INVALID_REFRESH');
    }

    const stored = await this.prisma.refreshToken.findFirst({
      where: { userId: payload.sub, tokenHash: sha256(refreshToken) },
    });
    if (!stored || stored.revoked || stored.expiresAt < new Date()) {
      throw new AppException('Refresh token invalide ou expiré', HttpStatus.UNAUTHORIZED, 'INVALID_REFRESH');
    }

    await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revoked: true } });
    return this.issueTokenPair(payload.sub);
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Ne pas révéler si le compte existe
      return { message: 'Si un compte existe, un email a été envoyé' };
    }

    const code = generateOtpCode();
    const codeHash = await hashOtp(code);
    const expiresAt = new Date(Date.now() + this.otpTtlMinutes * 60 * 1000);

    await this.prisma.emailVerification.updateMany({
      where: { email, consumed: false },
      data: { consumed: true },
    });
    await this.prisma.emailVerification.create({ data: { email, codeHash, expiresAt } });
    await this.mailer.sendOtpEmail(email, code);

    return { message: 'Si un compte existe, un email a été envoyé' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const email = dto.email.trim().toLowerCase();
    const record = await this.prisma.emailVerification.findFirst({
      where: { email, consumed: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) {
      throw new AppException('Code invalide ou expiré', HttpStatus.BAD_REQUEST, 'BAD_OTP');
    }

    const valid = await verifyOtp(dto.code, record.codeHash);
    if (!valid) {
      await this.prisma.emailVerification.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw new AppException('Code incorrect', HttpStatus.BAD_REQUEST, 'BAD_OTP');
    }

    await this.prisma.emailVerification.update({ where: { id: record.id }, data: { consumed: true } });

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new AppException('Utilisateur introuvable', HttpStatus.NOT_FOUND, 'NOT_FOUND');

    const passwordHash = await hashPassword(dto.password);
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

    return { message: 'Mot de passe mis à jour' };
  }

  // -------------------------------------------------------------------------
  private async issueTokenPair(userId: string) {
    const accessToken = this.jwt.signAccessToken(userId);
    const refreshToken = this.jwt.signRefreshToken(userId);
    const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: sha256(refreshToken), expiresAt },
    });
    return { accessToken, refreshToken };
  }
}
