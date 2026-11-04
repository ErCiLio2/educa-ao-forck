import type { FastifyPluginAsync } from 'fastify';
import * as controller from './guardians.controller';
import { authenticate, authorize } from '../auth/auth.middleware';
import { guardiansDocs } from './guardians.docs';

const guardianRoutes: FastifyPluginAsync = async (fastify) => {
  const guard = { preHandler: [authenticate, authorize('GUARDIAN')] };

  fastify.post('/dependents', { ...guard, schema: guardiansDocs.createDependent }, controller.createDependent);
  fastify.get('/dependents', { ...guard, schema: guardiansDocs.listDependents }, controller.listDependents);

  fastify.post(
    '/dependents/:studentId/password',
    { ...guard, schema: guardiansDocs.resetDependentPassword, config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    controller.resetDependentPassword,
  );

  fastify.get('/dependents/:studentId/consent', { ...guard, schema: guardiansDocs.listConsents }, controller.listConsents);
  fastify.post('/dependents/:studentId/consent', { ...guard, schema: guardiansDocs.grantConsent }, controller.grantConsent);
  fastify.delete('/dependents/:studentId/consent', { ...guard, schema: guardiansDocs.revokeConsent }, controller.revokeConsent);

  // O próprio aluno consulta se já pode usar a plataforma
  fastify.get(
    '/consent/me',
    { preHandler: [authenticate, authorize('STUDENT')], schema: guardiansDocs.myConsent },
    controller.myConsentStatus,
  );
};

export default guardianRoutes;
