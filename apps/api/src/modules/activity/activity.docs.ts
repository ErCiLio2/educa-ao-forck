import { z } from 'zod';
import { decimal, docs, errorResponses, isoDate, named, obj, pageShape, uuid } from '../../shared/core/openapi';
import { HistoryQuerySchema, MetricsQuerySchema, PageQuerySchema, StudentParamsSchema } from './activity.types';

const rate = z.number().nullable().describe('Percentagem; nula quando ainda não há marcações');
const NextClass = obj({ id: uuid, title: z.string(), subject: z.string(), scheduledAt: isoDate }).nullable();

export const StudentSummary = named(
  'StudentActivitySummary',
  obj({
    classes: obj({
      enrolled: z.number().int(),
      upcoming: z.number().int(),
      attended: z.number().int(),
      absent: z.number().int(),
      awaitingAttendance: z.number().int().describe('Aulas já decorridas que o tutor ainda não marcou'),
      attendanceRate: rate.describe('Presenças ÷ (presenças + faltas) sobre as aulas marcadas, em %'),
    }),
    hoursConsumed: decimal.describe('Horas debitadas pelas matrículas do aluno'),
    topSubjects: z.array(obj({ subject: z.string(), classes: z.number().int() })),
    nextClass: NextClass,
    reviewsGiven: z.number().int(),
    hoursAvailable: decimal.describe('Saldo utilizável; inclui os pacotes do Encarregado'),
  }),
);

const HistoryItem = obj({
  id: uuid,
  attendanceStatus: z.enum(['PENDING', 'PRESENT', 'ABSENT']),
  hoursDebited: decimal,
  session: obj({
    id: uuid, title: z.string(), subject: z.string(), type: z.enum(['ONE_ON_ONE', 'GROUP']),
    scheduledAt: isoDate, durationMin: z.number().int(), tutorName: z.string(),
  }),
});
const History = named('StudentActivityHistory', obj({ items: z.array(HistoryItem), ...pageShape }));

const DependentOverview = z.union([
  obj({ id: uuid, name: z.string(), consentGranted: z.literal(false) }).describe('Sem consentimento: nenhum dado do menor'),
  obj({
    id: uuid, name: z.string(), consentGranted: z.literal(true),
    attended: z.number().int(), upcoming: z.number().int(), attendanceRate: rate, nextClass: NextClass,
  }),
]);

const TutorSummary = obj({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
  profile: obj({ ratingAverage: z.number(), totalReviews: z.number().int(), totalClasses: z.number().int(), totalStudents: z.number().int() }),
  upcoming: obj({ sessions: z.number().int(), enrolled: z.number().int(), seats: z.number().int(), fillRate: rate }),
  attendance: obj({ present: z.number().int(), absent: z.number().int(), awaitingAttendance: z.number().int(), rate }),
});

const TutorHistory = obj({
  items: z.array(
    obj({
      id: uuid, title: z.string(), subject: z.string(), type: z.enum(['ONE_ON_ONE', 'GROUP']), scheduledAt: isoDate,
      durationMin: z.number().int(), maxCapacity: z.number().int(),
      enrolled: z.number().int(), present: z.number().int(), absent: z.number().int(),
    }).describe('Só contagens: os alunos não são identificados'),
  ),
  ...pageShape,
});

const byRole = obj({ STUDENT: z.number().int(), GUARDIAN: z.number().int(), TUTOR: z.number().int(), ADMIN: z.number().int() });
const byStatus = obj({ PENDING: z.number().int(), APPROVED: z.number().int(), REJECTED: z.number().int() });

const AdminMetrics = obj({
  periodDays: z.number().int(),
  since: isoDate,
  usersByRole: byRole,
  tutorsByStatus: byStatus,
  classes: obj({ sessionsHeld: z.number().int(), upcomingSessions: z.number().int(), enrollmentsCreated: z.number().int(), attendanceRate: rate }),
  payments: obj({
    confirmedPayments: z.number().int(), confirmedAmount: decimal, currency: z.literal('AOA'), pendingPayments: z.number().int(),
    hoursReleased: decimal, hoursOutstanding: decimal.describe('Horas pagas e ainda por usar (válidas)'),
  }),
  reputation: obj({ reviews: z.number().int(), averageRating: z.number().nullable() }),
});

const TAG = ['Actividade'];
const privacy = 'Só com consentimento activo do Encarregado (RN-02); cada consulta fica no registo de auditoria.';

export const activityDocs = {
  mySummary: docs({
    tags: TAG, operationId: 'getMyActivitySummary', summary: 'O meu resumo de actividade',
    roles: ['STUDENT'], response: { 200: obj({ summary: StudentSummary }), ...errorResponses(401, 403) },
  }),
  myHistory: docs({
    tags: TAG, operationId: 'getMyActivityHistory', summary: 'O meu histórico de aulas',
    description: 'Mais recentes primeiro; `from`/`to` filtram pela data da aula.',
    roles: ['STUDENT'], querystring: HistoryQuerySchema,
    response: { 200: History, ...errorResponses(401, 403, 422) },
  }),
  dependents: docs({
    tags: ['Actividade · Encarregado'], operationId: 'getDependentsOverview', summary: 'Visão geral dos dependentes',
    description: `Os dependentes sem consentimento aparecem só com \`{ id, name, consentGranted: false }\`. ${privacy}`,
    roles: ['GUARDIAN'], response: { 200: obj({ dependents: z.array(DependentOverview) }), ...errorResponses(401, 403) },
  }),
  dependentSummary: docs({
    tags: ['Actividade · Encarregado'], operationId: 'getDependentSummary', summary: 'Resumo de um dependente (RF-ENC-03)',
    description: privacy, roles: ['GUARDIAN'], params: StudentParamsSchema,
    response: { 200: obj({ summary: StudentSummary }), ...errorResponses(401, 403, 422) },
  }),
  dependentHistory: docs({
    tags: ['Actividade · Encarregado'], operationId: 'getDependentHistory', summary: 'Histórico de um dependente (RF-ENC-03)',
    description: privacy, roles: ['GUARDIAN'], params: StudentParamsSchema, querystring: HistoryQuerySchema,
    response: { 200: History, ...errorResponses(401, 403, 422) },
  }),
  tutorSummary: docs({
    tags: ['Actividade · Tutor'], operationId: 'getTutorActivitySummary', summary: 'Resumo do tutor',
    roles: ['TUTOR'], response: { 200: obj({ summary: TutorSummary }), ...errorResponses(401, 403, 404) },
  }),
  tutorHistory: docs({
    tags: ['Actividade · Tutor'], operationId: 'getTutorActivityHistory', summary: 'Aulas já dadas',
    roles: ['TUTOR'], querystring: PageQuerySchema,
    response: { 200: TutorHistory, ...errorResponses(401, 403, 404, 422) },
  }),
  adminMetrics: docs({
    tags: ['Actividade · Administração'], operationId: 'getAdminMetrics', summary: 'Métricas da plataforma',
    description: 'Agregados numa janela de dias (1 a 365). Sem dados pessoais.',
    roles: ['ADMIN'], mfa: 'session', querystring: MetricsQuerySchema,
    response: { 200: obj({ metrics: AdminMetrics }), ...errorResponses(401, 403, 422) },
  }),
};
