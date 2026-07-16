import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { TokenPayload } from './jwt-auth.guard';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TokenPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as TokenPayload;
  },
);

export const UserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return (request.user as TokenPayload).sub;
  },
);
