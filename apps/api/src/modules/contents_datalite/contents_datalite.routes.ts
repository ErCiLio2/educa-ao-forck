import type { FastifyPluginAsync } from 'fastify';
import * as controller from './contents_datalite.controller';
import { authenticate, authorize, requireMfa } from '../auth/auth.middleware';
import { contentsDocs } from './contents_datalite.docs';

const contentsRoutes: FastifyPluginAsync = async (fastify) => {
  const tutor = [authenticate, authorize('TUTOR')];
  const anyAuth = [authenticate, authorize('STUDENT', 'GUARDIAN', 'TUTOR', 'ADMIN')];
  const admin = [authenticate, authorize('ADMIN'), requireMfa];

  // ── Público ──────────────────────────────────────────────────────────────────
  fastify.get('', { schema: contentsDocs.list }, controller.listPublished);

  // ── Tutor: gerir o próprio conteúdo ──────────────────────────────────────────
  // Rotas fixas antes de /:id para evitar conflito com o parâmetro dinâmico
  fastify.post('/upload-url', { preHandler: tutor, schema: contentsDocs.uploadUrl }, controller.requestUploadUrl);
  fastify.post('', { preHandler: tutor, schema: contentsDocs.create }, controller.createContent);
  fastify.get('/mine', { preHandler: tutor, schema: contentsDocs.listMine }, controller.listMine);

  // ── Admin ────────────────────────────────────────────────────────────────────
  fastify.get('/admin', { preHandler: admin, schema: contentsDocs.adminList }, controller.adminListAll);
  fastify.delete<{ Params: { id: string } }>(
    '/admin/:id',
    { preHandler: admin, schema: contentsDocs.adminDelete },
    controller.adminDeleteContent,
  );

  // ── Rotas com parâmetro /:id ─────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/:id', { schema: contentsDocs.getById }, controller.getById);
  fastify.get<{ Params: { id: string } }>(
    '/:id/url',
    { preHandler: anyAuth, schema: contentsDocs.accessUrl },
    controller.getAccessUrl,
  );
  fastify.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: tutor, schema: contentsDocs.update },
    controller.updateContent,
  );
  fastify.patch<{ Params: { id: string } }>(
    '/:id/status',
    { preHandler: tutor, schema: contentsDocs.changeStatus },
    controller.changeStatus,
  );
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: tutor, schema: contentsDocs.delete },
    controller.deleteContent,
  );
};

export default contentsRoutes;
