import type { FastifyPluginAsync } from 'fastify';
import * as controller from './tutors.controller';
import { authenticate, authorize, requireMfa, requireRecentMfa } from '../auth/auth.middleware';
import { tutorsDocs } from './tutors.docs';

const tutorRoutes: FastifyPluginAsync = async (fastify) => {
  const tutor = [authenticate, authorize('TUTOR')];

  // ── Catálogo público ─────────────────────────────────────────────────────────
  // '' (e não '/'): o caminho público é /api/v1/tutors, sem barra final
  fastify.get('', { schema: tutorsDocs.list }, controller.listApproved);
  fastify.get<{ Params: { id: string } }>('/:id', { schema: tutorsDocs.getPublic }, controller.getPublicProfile);

  // ── Tutor: gerir o próprio perfil ────────────────────────────────────────────
  fastify.post('/profile', { preHandler: tutor, schema: tutorsDocs.create }, controller.createProfile);
  fastify.patch('/profile', { preHandler: tutor, schema: tutorsDocs.update }, controller.updateProfile);
  fastify.get('/profile/me', { preHandler: tutor, schema: tutorsDocs.getMine }, controller.getMyProfile);
  fastify.post(
    '/profile/documents/upload-url',
    { preHandler: tutor, schema: tutorsDocs.uploadUrl },
    controller.requestUploadUrl,
  );
  fastify.patch('/profile/documents', { preHandler: tutor, schema: tutorsDocs.submitDocuments }, controller.submitDocuments);

  // ── Admin: aprovação e fila de pendentes ─────────────────────────────────────
  fastify.get(
    '/admin/pending',
    { preHandler: [authenticate, authorize('ADMIN'), requireMfa], schema: tutorsDocs.listPending },
    controller.listPending,
  );
  fastify.patch<{ Params: { id: string } }>(
    '/:id/status',
    { preHandler: [authenticate, authorize('ADMIN'), requireRecentMfa()], schema: tutorsDocs.review },
    controller.reviewTutor,
  );
};

export default tutorRoutes;
