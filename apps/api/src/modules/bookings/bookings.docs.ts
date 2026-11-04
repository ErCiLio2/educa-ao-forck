import { z } from 'zod';
import { decimal, docs, errorResponses, isoDate, named, NoContent, obj, pageShape, uuid } from '../../shared/core/openapi';
import {
  AttendanceParamsSchema,
  AttendanceSchema,
  CreateSessionSchema,
  ListSessionsQuerySchema,
  SessionParamsSchema,
} from './bookings.types';

const ClassType = z.enum(['ONE_ON_ONE', 'GROUP']);
const Attendance = z.enum(['PENDING', 'PRESENT', 'ABSENT']);

export const ClassSession = named(
  'ClassSession',
  obj({
    id: uuid,
    title: z.string(),
    subject: z.string(),
    type: ClassType,
    maxCapacity: z.number().int().min(1).max(7).describe('1 em aulas individuais; 2 a 7 em grupo (RN-01)'),
    scheduledAt: isoDate,
    durationMin: z.number().int(),
    tutor: obj({ id: uuid, ratingAverage: z.number(), user: obj({ name: z.string() }) }),
    spotsLeft: z.number().int().describe('Vagas livres'),
  }),
);

const MySession = obj({
  id: uuid,
  title: z.string(),
  subject: z.string(),
  type: ClassType,
  maxCapacity: z.number().int(),
  scheduledAt: isoDate,
  durationMin: z.number().int(),
  enrollments: z.array(obj({ id: uuid, attendanceStatus: Attendance, student: obj({ id: uuid, name: z.string() }) })),
});

const Enrollment = named(
  'Enrollment',
  obj({ id: uuid, classId: uuid, attendanceStatus: Attendance, hoursDebited: decimal, createdAt: isoDate }),
);

const MyEnrollment = obj({
  id: uuid,
  attendanceStatus: Attendance,
  hoursDebited: decimal,
  session: obj({
    id: uuid, title: z.string(), subject: z.string(), type: ClassType, scheduledAt: isoDate, durationMin: z.number().int(),
    tutor: obj({ user: obj({ name: z.string() }) }),
  }),
});

const TAG = ['Aulas'];

export const bookingsDocs = {
  list: docs({
    tags: TAG, operationId: 'listSessions', summary: 'Catálogo de aulas futuras', security: 'none',
    description: 'Só aulas futuras de tutores aprovados, com vagas livres. `subject` não distingue maiúsculas.',
    querystring: ListSessionsQuerySchema,
    response: { 200: obj({ sessions: z.array(ClassSession), ...pageShape }), ...errorResponses(422) },
  }),
  get: docs({
    tags: TAG, operationId: 'getSession', summary: 'Detalhe de uma aula', security: 'none',
    params: SessionParamsSchema,
    response: { 200: obj({ session: ClassSession }), ...errorResponses(404, 422) },
  }),
  create: docs({
    tags: TAG, operationId: 'createSession', summary: 'Publicar uma aula',
    description: 'Só tutores aprovados (RN-05). `ONE_ON_ONE` tem sempre 1 vaga; `GROUP` tem 2 a 7 (RN-01).',
    roles: ['TUTOR'], body: CreateSessionSchema,
    response: { 201: obj({ session: ClassSession }), ...errorResponses(401, 403, 404, 422) },
  }),
  mine: docs({
    tags: TAG, operationId: 'listMySessions', summary: 'As minhas aulas, com inscritos',
    roles: ['TUTOR'],
    response: { 200: obj({ sessions: z.array(MySession) }), ...errorResponses(401, 403, 404) },
  }),
  remove: docs({
    tags: TAG, operationId: 'deleteSession', summary: 'Apagar uma aula sem alunos',
    description: '409 se já tiver alunos inscritos.',
    roles: ['TUTOR'], params: SessionParamsSchema,
    response: { 204: NoContent, ...errorResponses(401, 403, 404, 409, 422) },
  }),
  attendance: docs({
    tags: TAG, operationId: 'markAttendance', summary: 'Marcar a presença de um aluno',
    description: 'Só depois de a aula ter começado. Actualiza as estatísticas do perfil do tutor.',
    roles: ['TUTOR'], params: AttendanceParamsSchema, body: AttendanceSchema,
    response: { 200: obj({ enrollment: obj({ id: uuid, attendanceStatus: z.enum(['PRESENT', 'ABSENT']) }) }), ...errorResponses(401, 403, 404, 409, 422) },
  }),
  enroll: docs({
    tags: ['Matrículas'], operationId: 'enroll', summary: 'Agendar (inscrever-se numa aula)',
    description:
      'Atómico: bloqueia a aula (RN-01) e debita as horas do pacote que expira primeiro (RN-04). 402 se não houver horas; ' +
      '409 se a aula estiver esgotada, já tiver começado ou o aluno já estiver inscrito. Dependentes usam o pacote do Encarregado ' +
      'e precisam de consentimento activo.',
    roles: ['STUDENT'], params: SessionParamsSchema,
    response: { 201: obj({ enrollment: Enrollment }), ...errorResponses(401, 402, 403, 404, 409, 422) },
  }),
  cancelEnrollment: docs({
    tags: ['Matrículas'], operationId: 'cancelEnrollment', summary: 'Cancelar a matrícula',
    description: 'Estorna as horas. Só até 24 h antes do início (política provisória, a validar com o cliente).',
    roles: ['STUDENT'], params: SessionParamsSchema,
    response: { 204: NoContent, ...errorResponses(401, 403, 404, 409, 422) },
  }),
  myEnrollments: docs({
    tags: ['Matrículas'], operationId: 'listMyEnrollments', summary: 'As minhas matrículas',
    roles: ['STUDENT'],
    response: { 200: obj({ enrollments: z.array(MyEnrollment) }), ...errorResponses(401, 403) },
  }),
  joinToken: docs({
    tags: ['Aulas'], operationId: 'getSessionJoinToken', summary: 'Token de acesso à sala virtual (LiveKit)',
    description: 'Gera um token JWT LiveKit para entrar na sala da aula. Tutor e aluno inscrito podem publicar; Admin entra como observador. Token válido até ao fim da aula (máx. 4 h).',
    roles: ['STUDENT', 'TUTOR', 'ADMIN'],
    params: SessionParamsSchema,
    response: {
      200: obj({ token: z.string(), url: z.string(), room: z.string() }),
      ...errorResponses(401, 403, 404),
    },
  }),
};

/*
 * ── Contrato WebSocket da sala de aula (Socket.IO, path /socket.io) ────────────
 *
 * Autenticação: handshake com { auth: { token: "<access_token>" } }
 * Após ligação: o servidor emite "ready" (o cliente pode enviar eventos)
 *
 * EVENTOS ENVIADOS PELO CLIENTE → SERVIDOR
 * ─────────────────────────────────────────
 *
 * session:join  { sessionId: uuid }
 *   → cb: { ok: true, access: "tutor"|"student"|"admin" }
 *       | { error: "INVALID_DATA"|"FORBIDDEN" }
 *   Valida acesso (tutor da sessão, aluno inscrito ou admin) e entra na room.
 *   Dispara session:participant_joined para os outros.
 *
 * session:leave  { sessionId: uuid }
 *   Sai da room. Dispara session:participant_left para os outros.
 *
 * wb:stroke  { sessionId, points: [{x,y}]×1..500, color: "#rrggbb", width: 1..50 }
 *   Relay de um traço do whiteboard (apenas se estiver na room).
 *
 * wb:clear   { sessionId }
 *   Limpa o quadro (relay para toda a room).
 *
 * wb:cursor  { sessionId, x: number, y: number }
 *   Posição do cursor em tempo real (alta frequência).
 *
 * chat:message  { sessionId, text: string×1..1000 }
 *   → cb: { ok: true, id: uuid } | { error: "INVALID_DATA"|"FORBIDDEN" }
 *   Envia uma mensagem de chat. O servidor relaya para TODOS na room (incluindo remetente).
 *
 * chat:typing  { sessionId, typing: boolean }
 *   Sinaliza que o utilizador começou (true) ou parou (false) de escrever.
 *   Implementar debounce de ~1 s no cliente antes de emitir false.
 *
 * ─────────────────────────────────────────
 * EVENTOS EMITIDOS PELO SERVIDOR → CLIENTE
 * ─────────────────────────────────────────
 *
 * ready
 *   Confirmação de que a ligação foi estabelecida e autenticada.
 *
 * session:participant_joined  { userId, userName, role: "tutor"|"student"|"admin" }
 *   Outro participante entrou na room. Permite sair do ecrã "À espera do tutor".
 *
 * session:participant_left  { userId, userName }
 *   Outro participante saiu da room.
 *
 * wb:stroke  { userId, points, color, width }
 *   Traço de outro utilizador para desenhar no whiteboard local.
 *
 * wb:clear   { userId }
 *   O quadro foi limpo por outro utilizador.
 *
 * wb:cursor  { userId, x, y }
 *   Posição do cursor de outro utilizador.
 *
 * chat:message  { id: uuid, userId, userName, text, sentAt: ISO8601 }
 *   Nova mensagem de chat (incluindo as próprias — para confirmação).
 *
 * chat:typing  { userId, userName, typing: boolean }
 *   Outro utilizador está a escrever (true) ou parou (false).
 */
