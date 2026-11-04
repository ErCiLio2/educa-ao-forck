import type { FastifyPluginAsync } from 'fastify';
import * as controller from './bookings.controller';
import { authenticate, authorize } from '../auth/auth.middleware';
import { requireConsent } from '../guardians/guardians.middleware';
import { bookingsDocs as d } from './bookings.docs';
import { initBookingsSocket } from './bookings.socket';

// Regista os handlers de WebSocket do whiteboard antes de qualquer ligação (RF-AUL-06)
initBookingsSocket();

const bookingRoutes: FastifyPluginAsync = async (fastify) => {
  const tutor = { preHandler: [authenticate, authorize('TUTOR')] };
  // Dados de aluno: exige consentimento activo do Encarregado quando aplicável (RN-02)
  const student = { preHandler: [authenticate, authorize('STUDENT'), requireConsent] };

  // ── Catálogo público de aulas (RF-CAT-01) ───────────────────────────────────
  fastify.get('/sessions', { schema: d.list }, controller.listSessions);
  fastify.get('/sessions/:id', { schema: d.get }, controller.getSession);

  // ── Tutor aprovado: publicar e gerir aulas ──────────────────────────────────
  fastify.post('/sessions', { ...tutor, schema: d.create }, controller.createSession);
  fastify.get('/sessions/mine', { ...tutor, schema: d.mine }, controller.listMySessions);
  fastify.delete('/sessions/:id', { ...tutor, schema: d.remove }, controller.deleteSession);
  fastify.patch('/sessions/:id/enrollments/:enrollmentId', { ...tutor, schema: d.attendance }, controller.markAttendance);

  // ── Aluno: agendar / cancelar / consultar ───────────────────────────────────
  fastify.post('/sessions/:id/enroll', { ...student, schema: d.enroll }, controller.enroll);
  fastify.delete('/sessions/:id/enroll', { ...student, schema: d.cancelEnrollment }, controller.cancelEnrollment);
  fastify.get('/enrollments/mine', { ...student, schema: d.myEnrollments }, controller.listMyEnrollments);

  // ── Sala virtual (RF-AUL-05) — tutor, aluno inscrito ou admin ──────────────
  // requireConsent: devolve imediatamente para TUTOR/ADMIN; bloqueia STUDENT sem consentimento activo (RN-02)
  const anyAuth = { preHandler: [authenticate, authorize('STUDENT', 'TUTOR', 'ADMIN'), requireConsent] };
  fastify.get('/sessions/:id/join-token', { ...anyAuth, schema: d.joinToken }, controller.getJoinToken);
};

export default bookingRoutes;
