import { z } from 'zod';
import { docs, errorResponses, isoDate, named, obj, uuid } from '../../shared/core/openapi';
import { CreateReviewSchema, ListReviewsQuerySchema, SessionParamsSchema, TutorParamsSchema } from './reputation.types';

const Stars = z.number().int().min(1).max(5);
const criteria = {
  rating: Stars.describe('Nota geral'),
  punctuality: Stars,
  subjectMastery: Stars,
  didacticClarity: Stars,
  progress: Stars,
};

// Anónima: o autor nunca é exposto (há menores)
const PublicReview = named(
  'Review',
  obj({ id: uuid, ...criteria, comment: z.string().nullable(), createdAt: isoDate }),
);

const average = z.number().nullable().describe('Média com 2 casas decimais; nula sem avaliações');

const TAG = ['Reputação'];

export const reputationDocs = {
  tutorReviews: docs({
    tags: TAG, operationId: 'listTutorReviews', summary: 'Avaliações de um tutor (anónimas)', security: 'none',
    description: 'Só tutores aprovados. Resumo por critério e lista paginada, mais recentes primeiro.',
    params: TutorParamsSchema, querystring: ListReviewsQuerySchema,
    response: {
      200: obj({
        summary: obj({
          total: z.number().int(),
          average,
          criteria: obj({ punctuality: average, subjectMastery: average, didacticClarity: average, progress: average }),
        }),
        reviews: z.array(PublicReview),
        page: z.number().int(), limit: z.number().int(), pages: z.number().int(),
      }),
      ...errorResponses(404, 422),
    },
  }),
  pending: docs({
    tags: TAG, operationId: 'listPendingReviews', summary: 'Aulas por avaliar',
    description: 'Aulas a que o aluno assistiu (presença confirmada pelo tutor), já terminadas e ainda sem avaliação.',
    roles: ['STUDENT'],
    response: {
      200: obj({
        sessions: z.array(
          obj({ id: uuid, tutorId: uuid, subject: z.string(), title: z.string(), scheduledAt: isoDate, durationMin: z.number().int(), tutorName: z.string() }),
        ),
      }),
      ...errorResponses(401, 403),
    },
  }),
  create: docs({
    tags: TAG, operationId: 'createReview', summary: 'Avaliar uma aula (RF-AVA-01)',
    description:
      'Só quem esteve presente numa aula já terminada, uma avaliação por aula. Notas inteiras de 1 a 5 (RN-06). ' +
      'Actualiza a média do tutor. Imutável depois de criada.',
    roles: ['STUDENT'], params: SessionParamsSchema, body: CreateReviewSchema,
    response: {
      201: obj({ review: obj({ id: uuid, classId: uuid, ...criteria, comment: z.string().nullable(), createdAt: isoDate }) }),
      ...errorResponses(401, 403, 404, 409, 422),
    },
  }),
};

