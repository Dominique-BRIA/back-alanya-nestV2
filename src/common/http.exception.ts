import { HttpException, HttpStatus } from '@nestjs/common';

export class AppException extends HttpException {
  constructor(
    message: string,
    status: number = HttpStatus.BAD_REQUEST,
    public readonly code?: string,
  ) {
    super({ error: { message, code } }, status);
  }
}
