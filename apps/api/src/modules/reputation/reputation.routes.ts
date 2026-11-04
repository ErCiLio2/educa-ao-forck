import type { FastifyPluginAsync } from 'fastify';
import * as controller from './reputation.controller';
import { authenticate, authorize } from '../auth/auth.middleware';
import { requireConsent } from '../guardians/guardians.middleware';
import { reputationDocs as d } from './reputation.docs';

const reputationRoutes: FastifyPluginAsync = async (fastify) => {
  const student = { preHandler: [authenticate, authorize('STUDENT'), requireConsent] };

  // Avaliações públicas e anónimas de um tutor aprovado (RF-TUT-03)
  fastify.get('/tutors/:tutorId/reviews', { schema: d.tutorReviews }, controller.listTutorReviews);

  // Aluno: aulas por avaliar e avaliar uma aula a que assistiu (RF-AVA-01)
  fastify.get('/reviews/pending', { ...student, schema: d.pending }, controller.listPending);
  fastify.post('/sessions/:sessionId/review', { ...student, schema: d.create }, controller.createReview);
};

export default reputationRoutes;
