import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { Request } from 'express';

export interface TokenPayload {
  sub: string;
  scope: 'access' | 'refresh' | 'setup';
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractBearer(request);
    if (!token) throw new UnauthorizedException('Token manquant');

    try {
      const secret = this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
      const payload = jwt.verify(token, secret) as TokenPayload;
      if (payload.scope !== 'access') throw new UnauthorizedException('Scope de token invalide');
      (request as any).user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Token invalide ou expiré');
    }
  }

  private extractBearer(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    return header.slice('Bearer '.length).trim();
  }
}

/** Setup-scope guard (étape post-vérification email) */
@Injectable()
export class SetupJwtGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (!token) throw new UnauthorizedException('Token manquant');

    try {
      const secret = this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
      const payload = jwt.verify(token, secret) as TokenPayload;
      if (payload.scope !== 'setup') throw new UnauthorizedException('Scope setup requis');
      (request as any).user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Token invalide ou expiré');
    }
  }
}
