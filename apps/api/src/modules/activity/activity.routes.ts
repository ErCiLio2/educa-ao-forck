import type { FastifyPluginAsync } from 'fastify';
import * as controller from './activity.controller';
import { authenticate, authorize, requireMfa } from '../auth/auth.middleware';
import { requireConsent } from '../guardians/guardians.middleware';
import { activityDocs as d } from './activity.docs';

const activityRoutes: FastifyPluginAsync = async (fastify) => {
  // Cada perfil só vê o que é seu (RNF-SEG-02). O aluno dependente precisa de consentimento activo (RN-02).
  const student = { preHandler: [authenticate, authorize('STUDENT'), requireConsent] };
  const guardian = { preHandler: [authenticate, authorize('GUARDIAN')] };
  const tutor = { preHandler: [authenticate, authorize('TUTOR')] };
  const admin = { preHandler: [authenticate, authorize('ADMIN'), requireMfa] };

  fastify.get('/me/summary', { ...student, schema: d.mySummary }, controller.mySummary);
  fastify.get('/me/history', { ...student, schema: d.myHistory }, controller.myHistory);

  // Encarregado (RF-ENC-03): a propriedade e o consentimento são verificados no serviço
  fastify.get('/dependents', { ...guardian, schema: d.dependents }, controller.dependentsOverview);
  fastify.get('/dependents/:studentId/summary', { ...guardian, schema: d.dependentSummary }, controller.dependentSummary);
  fastify.get('/dependents/:studentId/history', { ...guardian, schema: d.dependentHistory }, controller.dependentHistory);

  fastify.get('/tutor/summary', { ...tutor, schema: d.tutorSummary }, controller.tutorSummary);
  fastify.get('/tutor/history', { ...tutor, schema: d.tutorHistory }, controller.tutorHistory);

  fastify.get('/admin/metrics', { ...admin, schema: d.adminMetrics }, controller.adminMetrics);
};

export default activityRoutes;
