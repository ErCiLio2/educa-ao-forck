import { env } from './shared/core/env';
import { z } from 'zod';
import { API_VERSION } from './version';
import { docs, registerOpenApi, validateResponses } from './shared/core/openapi';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import redis from './shared/core/redis';
import { AppError, ValidationError } from './shared/core/errors';
import authRoutes from './modules/auth/auth.routes';
import tutorRoutes from './modules/tutors/tutors.routes';
import guardianRoutes from './modules/guardians/guardians.routes';
import bookingRoutes from './modules/bookings/bookings.routes';
import paymentRoutes from './modules/payments/payments.routes';
import reputationRoutes from './modules/reputation/reputation.routes';
import adminRoutes from './modules/admin/admin.routes';
import activityRoutes from './modules/activity/activity.routes';
import contentsRoutes from './modules/contents_datalite/contents_datalite.routes';
import notificationsRoutes from './modules/notifications/notifications.routes';

export function buildApp() {
  const app = Fastify({ logger: false });

  // O contrato tem de ser registado antes das rotas
  registerOpenApi(app, API_VERSION);
  // Em testes, cada resposta é validada contra o schema documentado: o contrato não pode divergir do código
  if (env.NODE_ENV === 'test') validateResponses(app);

  app.register(helmet);
  app.register(cors, {
    origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  app.register(cookie);
  // Em testes não há Redis: o rate limit distribuído fica fora
  if (env.NODE_ENV !== 'test') {
    app.register(rateLimit, {
      redis,
      max: 200,
      timeWindow: '1 minute',
    });
  }

  // Dentro de um plugin: as rotas da raiz seriam registadas antes de o plugin do contrato carregar
  app.register(async (system) => {
    system.get(
      '/health',
      { schema: docs({ tags: ['Sistema'], operationId: 'getHealth', summary: 'Estado do serviço', security: 'none', response: { 200: z.object({ status: z.literal('ok') }) } }) },
      async () => ({ status: 'ok' as const }),
    );
    // O contrato serve-se a si próprio fora de produção (importável no Postman, Scalar, geradores de clientes…)
    if (env.NODE_ENV !== 'production') system.get('/openapi.json', async () => app.swagger());
    system.get(
      '/health/auth',
      { schema: docs({ tags: ['Sistema'], operationId: 'getAuthHealth', summary: 'Estado do módulo de autenticação', security: 'none', response: { 200: z.object({ module: z.literal('auth'), status: z.literal('ok') }) } }) },
      async () => ({ module: 'auth' as const, status: 'ok' as const }),
    );
  });

  app.register(authRoutes, { prefix: '/api/v1/auth' });
  app.register(tutorRoutes, { prefix: '/api/v1/tutors' });
  app.register(guardianRoutes, { prefix: '/api/v1/guardians' });
  app.register(bookingRoutes, { prefix: '/api/v1/bookings' });
  app.register(paymentRoutes, { prefix: '/api/v1/payments' });
  app.register(reputationRoutes, { prefix: '/api/v1/reputation' });
  app.register(adminRoutes, { prefix: '/api/v1/admin' });
  app.register(activityRoutes, { prefix: '/api/v1/activity' });
  app.register(contentsRoutes, { prefix: '/api/v1/contents' });
  app.register(notificationsRoutes, { prefix: '/api/v1/notifications' });

  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof ValidationError) {
      return reply.status(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details },
      });
    }
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({
        error: { code: err.code, message: err.message },
      });
    }
    // Erros do próprio Fastify/plugins (JSON inválido, rate-limit, 404...) trazem statusCode 4xx
    const status = (err as { statusCode?: number }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return reply.status(status).send({
        error: {
          code: (err as { code?: string }).code ?? 'BAD_REQUEST',
          message: err instanceof Error ? err.message : 'Pedido inválido',
        },
      });
    }
    console.error('[Unhandled]', err);
    return reply.status(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Erro interno do servidor' },
    });
  });

  return app;
}
