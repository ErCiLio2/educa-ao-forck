import type { FastifyPluginAsync } from 'fastify';
import * as controller from './admin.controller';
import { authenticate, authorize, requireMfa, requireRecentMfa } from '../auth/auth.middleware';
import { adminDocs as d } from './admin.docs';

const adminRoutes: FastifyPluginAsync = async (fastify) => {
  // Toda a administração exige sessão com MFA; as acções sensíveis exigem MFA recente (RNF-SEG-06)
  const read = { preHandler: [authenticate, authorize('ADMIN'), requireMfa] };
  const sensitive = { preHandler: [authenticate, authorize('ADMIN'), requireRecentMfa()] };

  fastify.get('/users', { ...read, schema: d.users }, controller.listUsers);

  fastify.get('/role-changes', { ...read, schema: d.listRoleChanges }, controller.listRoleChanges);
  fastify.post('/role-changes', { ...sensitive, schema: d.requestRoleChange }, controller.requestRoleChange);
  fastify.post('/role-changes/:id/approve', { ...sensitive, schema: d.approve }, controller.approveRoleChange);
  fastify.post('/role-changes/:id/reject', { ...sensitive, schema: d.reject }, controller.rejectRoleChange);
};

export default adminRoutes;
