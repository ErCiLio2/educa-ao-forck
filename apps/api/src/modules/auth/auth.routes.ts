import type { FastifyPluginAsync } from 'fastify';
import * as controller from './auth.controller';
import { authenticate, authorize, requireMfa, requireRecentMfaIfAdmin } from './auth.middleware';
import { authDocs } from './auth.docs';

const authRoutes: FastifyPluginAsync = async (fastify) => {
  const strictLimit = {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  };

  fastify.post('/register', { ...strictLimit, schema: authDocs.register }, controller.register);
  fastify.post('/login', { ...strictLimit, schema: authDocs.login }, controller.login);
  fastify.post('/refresh', { schema: authDocs.refresh }, controller.refresh);
  fastify.post('/logout', { schema: authDocs.logout }, controller.logout);
  fastify.get('/me', { schema: authDocs.me, preHandler: authenticate }, controller.me);

  // ── Gestão da própria conta (RF-AUT-04) ─────────────────────────────────────
  const account = { ...strictLimit, preHandler: [authenticate, requireRecentMfaIfAdmin()] };
  fastify.patch('/me', { ...account, schema: authDocs.updateMe }, controller.updateMe);
  fastify.post('/password', { ...account, schema: authDocs.changePassword }, controller.changePassword);

  // ── MFA (TOTP) — obrigatório para ADMIN (RNF-SEG-06) ────────────────────────
  const admin = [authenticate, authorize('ADMIN')];
  fastify.post('/mfa/verify', { ...strictLimit, schema: authDocs.mfaVerify }, controller.mfaVerify); // 2.º passo do login
  fastify.post('/mfa/setup', { preHandler: admin, schema: authDocs.mfaSetup }, controller.mfaSetup);
  fastify.post('/mfa/enable', { ...strictLimit, preHandler: admin, schema: authDocs.mfaEnable }, controller.mfaEnable);
  fastify.post('/mfa/step-up', { ...strictLimit, preHandler: [...admin, requireMfa], schema: authDocs.mfaStepUp }, controller.mfaStepUp);
};

export default authRoutes;
