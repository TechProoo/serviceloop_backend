import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client';

@Catch()
export class ErrorsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorsFilter.name);
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = randomUUID();
    let status = 500;
    let message: string | string[] = 'An unexpected server error occurred';
    if (error instanceof HttpException) {
      status = error.getStatus();
      const body = error.getResponse();
      message = typeof body === 'string' ? body : (body as { message?: string | string[] }).message ?? error.message;
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') { status = 409; message = 'This record already exists'; }
      if (error.code === 'P2025') { status = 404; message = 'Record not found'; }
      if (error.code === 'P2003') { status = 409; message = 'A referenced record is unavailable'; }
    } else if ((error as { type?: string })?.type === 'entity.parse.failed') { status = 400; message = 'Invalid JSON'; }
    else if ((error as { type?: string })?.type === 'entity.too.large') { status = 413; message = 'Request body is too large'; }
    if (status === 500) this.logger.error(`Request ${requestId} failed (${error instanceof Error ? error.name : 'UnknownError'})`);
    if (status === 429) res.setHeader('Retry-After', '60');
    res.setHeader('X-Request-Id', requestId);
    res.status(status).json({ statusCode: status, message, requestId });
  }
}
