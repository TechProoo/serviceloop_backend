import { ForbiddenException, INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { ErrorsFilter } from './common/errors.filter';
import { cookieOptions } from './auth/session-cookie';

export function configureApp(app: INestApplication) {
  cookieOptions();
  const days = Number(process.env.SESSION_DAYS || 7);
  if (!Number.isFinite(days) || days <= 0 || days > 30) throw new Error('SESSION_DAYS must be greater than 0 and at most 30');
  const origins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:5174').split(',').map(value => value.trim());
  app.enableCors({
    credentials: true,
    origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
      if (!origin || origins.includes(origin)) callback(null, true);
      else callback(new ForbiddenException('Origin is not allowed'), false);
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  });
  app.use(helmet());
  app.use(json({ limit: '64kb' }));
  app.use(urlencoded({ limit: '64kb', extended: false }));
  app.use((_req: unknown, res: { setHeader: (key: string, value: string) => void }, next: () => void) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ErrorsFilter());
}
