import type { FastifyPluginAsync } from 'fastify';
import * as controller from './payments.controller';
import { authenticate, authorize, requireMfa, requireRecentMfa } from '../auth/auth.middleware';
import { requireConsent } from '../guardians/guardians.middleware';
import { paymentsDocs as d } from './payments.docs';
import { env } from '../../shared/core/env';

const paymentRoutes: FastifyPluginAsync = async (fastify) => {
  const admin = { preHandler: [authenticate, authorize('ADMIN'), requireMfa] };
  const sensitive = { preHandler: [authenticate, authorize('ADMIN'), requireRecentMfa()] };
  // Aluno (com consentimento, se dependente) ou Encarregado (RF-PAG-01)
  const payer = { preHandler: [authenticate, authorize('STUDENT', 'GUARDIAN'), requireConsent] };

  // ── Catálogo de pacotes ─────────────────────────────────────────────────────
  fastify.get('/offers', { schema: d.listOffers }, controller.listOffers);
  fastify.get('/offers/all', { ...admin, schema: d.listAllOffers }, controller.listAllOffers);
  fastify.post('/offers', { ...admin, schema: d.createOffer }, controller.createOffer);
  fastify.patch('/offers/:id', { ...admin, schema: d.updateOffer }, controller.updateOffer);

  // ── Compra por referência e saldo ───────────────────────────────────────────
  fastify.post(
    '/references',
    { ...payer, schema: d.createReference, config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } },
    controller.createReference,
  );
  fastify.get('/mine', { ...payer, schema: d.mine }, controller.listMyPayments);
  fastify.get('/packages/mine', { ...payer, schema: d.myPackages }, controller.listMyPackages);

  // ── Admin: listagem, detalhe, reembolso e pacotes (RF-PAG-04) ─────────────────
  fastify.get('/transactions', { ...admin, schema: d.adminListTransactions }, controller.adminListTransactions);
  fastify.get('/transactions/:id', { ...admin, schema: d.adminGetTransaction }, controller.adminGetTransaction);
  fastify.post('/transactions/:id/refund', { ...sensitive, schema: d.adminRefundTransaction }, controller.adminRefundTransaction);
  fastify.get('/packages', { ...admin, schema: d.adminListPackages }, controller.adminListPackages);

  // ── Sandbox: simulação de eventos (só fora de produção) ──────────────────────
  if (env.NODE_ENV !== 'production' && env.PAYMENT_GATEWAY === 'sandbox') {
    fastify.post('/sandbox/:id/simulate', { ...admin, schema: d.sandboxSimulate }, controller.sandboxSimulate);
  }

  // ── Webhook do gateway: sem autenticação de utilizador, autenticado pela assinatura ──
  // Plugin encapsulado: o parser de JSON só devolve o Buffer cru aqui, o resto da API não é afectado
  await fastify.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
    scope.post('/webhooks/:gateway', { schema: d.webhook }, controller.webhook);
  });
};

export default paymentRoutes;
