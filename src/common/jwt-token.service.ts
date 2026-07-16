import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

export type TokenScope = 'access' | 'refresh' | 'setup';

export interface TokenPayload {
  sub: string;
  scope: TokenScope;
}

@Injectable()
export class JwtTokenService {
  constructor(private readonly config: ConfigService) {}

  private get accessSecret(): string {
    return this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
  }

  private get refreshSecret(): string {
    return this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
  }

  private get accessTtl(): string {
    return this.config.get<string>('JWT_ACCESS_TTL', '15m');
  }

  private get refreshTtl(): string {
    return this.config.get<string>('JWT_REFRESH_TTL', '7d');
  }

  signAccessToken(userId: string): string {
    return jwt.sign({ sub: userId, scope: 'access' }, this.accessSecret, {
      expiresIn: this.accessTtl,
    } as jwt.SignOptions);
  }

  signRefreshToken(userId: string): string {
    return jwt.sign({ sub: userId, scope: 'refresh' }, this.refreshSecret, {
      expiresIn: this.refreshTtl,
    } as jwt.SignOptions);
  }

  signSetupToken(userId: string): string {
    return jwt.sign({ sub: userId, scope: 'setup' }, this.accessSecret, {
      expiresIn: '15m',
    } as jwt.SignOptions);
  }

  verifyAccessToken(token: string): TokenPayload {
    return jwt.verify(token, this.accessSecret) as TokenPayload;
  }

  verifyRefreshToken(token: string): TokenPayload {
    return jwt.verify(token, this.refreshSecret) as TokenPayload;
  }
}
