import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ZodError } from 'zod';
import { Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof ZodError) {
      return response.status(422).json({
        error: {
          message: 'Données invalides',
          code: 'VALIDATION',
          details: exception.flatten(),
        },
      });
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      // If already formatted as { error: ... }, pass it through
      if (typeof body === 'object' && body !== null && 'error' in body) {
        return response.status(status).json(body);
      }
      return response.status(status).json({ error: { message: String(body), code: 'ERROR' } });
    }

    this.logger.error('Unhandled exception', exception);
    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { message: 'Erreur interne', code: 'INTERNAL' },
    });
  }
}
