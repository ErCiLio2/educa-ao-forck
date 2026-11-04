import { z } from 'zod';
import { decimal, docs, errorResponses, isoDate, named, obj, pageShape, uuid } from '../../shared/core/openapi';
import {
  CreateProfileSchema,
  ListPendingQuerySchema,
  ListTutorsQuerySchema,
  ReviewTutorSchema,
  SubmitDocumentsSchema,
  UpdateTutorProfileSchema,
  UploadUrlSchema,
} from './tutors.types';

const TutorStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED']);
const IdParams = z.object({ id: uuid });

export const PublicTutor = named(
  'PublicTutor',
  obj({
    id: uuid,
    fullName: z.string(),
    avatarUrl: z.string().url().nullable(),
    bio: z.string().nullable(),
    subjects: z.array(z.string()),
    levels: z.array(z.string()),
    isVerified: z.boolean(),
    averageRating: z.number(),
    reviewCount: z.number().int(),
    totalClasses: z.number().int(),
    totalStudents: z.number().int(),
    hourlyRate: decimal.nullable(),
  }),
);

// URLs assinadas de curta duração (5 min); nulas se o documento ainda não foi enviado. As chaves internas do storage nunca saem.
const Documents = obj({
  diploma: z.string().url().nullable(),
  criminalRecord: z.string().url().nullable(),
  passportPhoto: z.string().url().nullable(),
  videoIntro: z.string().url().nullable(),
});

// Perfil do próprio tutor / visto pelo administrador
export const TutorProfile = named(
  'TutorProfile',
  obj({
    id: uuid,
    userId: uuid,
    status: TutorStatus,
    rejectionReason: z.string().nullable(),
    reviewedAt: isoDate.nullable(),
    bio: z.string().nullable(),
    subjects: z.array(z.string()),
    levels: z.array(z.string()),
    avatarUrl: z.string().url().nullable(),
    hourlyRate: decimal.nullable(),
    ratingAverage: z.number(),
    totalReviews: z.number().int(),
    totalClasses: z.number().int(),
    totalStudents: z.number().int(),
    user: obj({ id: uuid, name: z.string(), email: z.string().email() }),
    documents: Documents,
  }),
);

const PendingTutor = obj({
  id: uuid,
  bio: z.string().nullable(),
  subjects: z.array(z.string()),
  user: obj({ id: uuid, name: z.string(), email: z.string().email() }),
  documents: Documents,
});

const TAG = ['Tutores'];

export const tutorsDocs = {
  list: docs({
    tags: TAG, operationId: 'listTutors', summary: 'Catálogo de tutores aprovados', security: 'none',
    querystring: ListTutorsQuerySchema,
    response: { 200: obj({ tutors: z.array(PublicTutor), ...pageShape }), ...errorResponses(422) },
  }),
  getPublic: docs({
    tags: TAG, operationId: 'getTutor', summary: 'Perfil público de um tutor aprovado', security: 'none',
    params: IdParams,
    response: { 200: obj({ profile: PublicTutor }), ...errorResponses(404, 422) },
  }),
  create: docs({
    tags: TAG, operationId: 'createTutorProfile', summary: 'Criar o perfil de tutor',
    description: 'Fica `PENDING` até um administrador rever os documentos (RN-05).',
    roles: ['TUTOR'], body: CreateProfileSchema,
    response: { 201: obj({ profile: TutorProfile }), ...errorResponses(401, 403, 409, 422) },
  }),
  update: docs({
    tags: TAG, operationId: 'updateTutorProfile', summary: 'Editar biografia e disciplinas',
    description: 'Só o perfil público. A verificação e os documentos não se alteram aqui. `bio: null` apaga a biografia.',
    roles: ['TUTOR'], body: UpdateTutorProfileSchema,
    response: { 200: obj({ profile: TutorProfile }), ...errorResponses(401, 403, 404, 422) },
  }),
  getMine: docs({
    tags: TAG, operationId: 'getMyTutorProfile', summary: 'O meu perfil de tutor',
    description: 'Inclui o motivo da rejeição, se houver, e URLs assinadas dos documentos.',
    roles: ['TUTOR'],
    response: { 200: obj({ profile: TutorProfile }), ...errorResponses(401, 403, 404) },
  }),
  uploadUrl: docs({
    tags: TAG, operationId: 'requestDocumentUpload', summary: 'Pedir um URL de upload de documento',
    description:
      'Devolve uma POST policy para o bucket privado: enviar o ficheiro directamente para `url` com `fields` + o ficheiro ' +
      '(campo `file`). O storage impõe o tipo e o tamanho máximo. Depois associar a `key` em `PATCH /tutors/profile/documents`.',
    roles: ['TUTOR'], body: UploadUrlSchema,
    response: {
      200: obj({ key: z.string(), url: z.string().url(), fields: z.record(z.string()), maxBytes: z.number().int(), expiresInSeconds: z.number().int() }),
      ...errorResponses(401, 403, 404, 422),
    },
  }),
  submitDocuments: docs({
    tags: TAG, operationId: 'submitTutorDocuments', summary: 'Associar documentos já enviados',
    description: 'Cada `key` é validada (pertence ao tutor, tipo certo, ficheiro existe, tamanho e MIME). Reenviar após rejeição volta o perfil a `PENDING`.',
    roles: ['TUTOR'], body: SubmitDocumentsSchema,
    response: { 200: obj({ profile: TutorProfile }), ...errorResponses(401, 403, 404, 422) },
  }),
  listPending: docs({
    tags: ['Tutores · Administração'], operationId: 'listPendingTutors', summary: 'Fila de tutores por rever',
    description: 'Só perfis com pelo menos um documento. Os documentos vêm como URLs assinadas de 5 min.',
    roles: ['ADMIN'], mfa: 'session', querystring: ListPendingQuerySchema,
    response: { 200: obj({ tutors: z.array(PendingTutor), ...pageShape }), ...errorResponses(401, 403, 422) },
  }),
  review: docs({
    tags: ['Tutores · Administração'], operationId: 'reviewTutor', summary: 'Aprovar ou rejeitar um tutor',
    description: 'Rejeitar exige `reason`. Fica no registo de auditoria.',
    roles: ['ADMIN'], mfa: 'recent', params: IdParams, body: ReviewTutorSchema,
    response: { 200: obj({ profile: TutorProfile }), ...errorResponses(401, 403, 404, 409, 422) },
  }),
};

