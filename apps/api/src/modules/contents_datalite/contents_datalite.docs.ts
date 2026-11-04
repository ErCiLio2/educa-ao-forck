import { z } from 'zod';
import { docs, errorResponses, isoDate, named, obj, pageShape, uuid } from '../../shared/core/openapi';
import {
  AccessUrlQuerySchema,
  ChangeStatusSchema,
  ContentUploadUrlSchema,
  CreateContentSchema,
  ListAdminQuerySchema,
  ListContentsQuerySchema,
  UpdateContentSchema,
} from './contents_datalite.types';

const ContentType = z.enum(['VIDEO', 'DOCUMENT']);
const ContentStatus = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']);
const IdParams = z.object({ id: uuid });

// storageKey e dataliteKey nunca saem da API (DPM, RF-CON-03)
export const ContentItem = named(
  'ContentItem',
  obj({
    id: uuid,
    tutorProfileId: uuid,
    title: z.string(),
    description: z.string().nullable(),
    type: ContentType,
    status: ContentStatus,
    isPaid: z.boolean(),
    subject: z.string().nullable(),
    hasDatalite: z.boolean(),
    createdAt: isoDate,
    updatedAt: isoDate,
  }),
);

const TAG = ['Conteúdos'];
const TAG_ADMIN = ['Conteúdos · Administração'];

export const contentsDocs = {
  // ── Público ──────────────────────────────────────────────────────────────────
  list: docs({
    tags: TAG,
    operationId: 'listContents',
    summary: 'Catálogo de conteúdos publicados',
    security: 'none',
    querystring: ListContentsQuerySchema,
    response: { 200: obj({ contents: z.array(ContentItem), ...pageShape }), ...errorResponses(422) },
  }),
  getById: docs({
    tags: TAG,
    operationId: 'getContent',
    summary: 'Detalhes de um conteúdo publicado',
    security: 'none',
    params: IdParams,
    response: { 200: obj({ content: ContentItem }), ...errorResponses(404, 422) },
  }),

  // ── Tutor: gerir o próprio conteúdo ──────────────────────────────────────────
  uploadUrl: docs({
    tags: TAG,
    operationId: 'requestContentUpload',
    summary: 'Pedir URL de upload de conteúdo',
    description:
      'Devolve uma POST policy para o bucket privado. Enviar o ficheiro para `url` com `fields` + o ficheiro ' +
      '(campo `file`). Depois usar a `key` em `POST /contents`. ' +
      'O storage impõe tipo e tamanho máximo.',
    roles: ['TUTOR'],
    body: ContentUploadUrlSchema,
    response: {
      200: obj({
        key: z.string(),
        url: z.string().url(),
        fields: z.record(z.string()),
        maxBytes: z.number().int(),
        expiresInSeconds: z.number().int(),
      }),
      ...errorResponses(401, 403, 422),
    },
  }),
  create: docs({
    tags: TAG,
    operationId: 'createContent',
    summary: 'Criar um item de conteúdo',
    description: 'Fica em `DRAFT` até ser publicado. A `storageKey` deve ter sido criada pelo endpoint de upload.',
    roles: ['TUTOR'],
    body: CreateContentSchema,
    response: { 201: obj({ content: ContentItem }), ...errorResponses(401, 403, 422) },
  }),
  listMine: docs({
    tags: TAG,
    operationId: 'listMyContents',
    summary: 'Os meus conteúdos',
    roles: ['TUTOR'],
    querystring: ListContentsQuerySchema,
    response: { 200: obj({ contents: z.array(ContentItem), ...pageShape }), ...errorResponses(401, 403, 422) },
  }),
  update: docs({
    tags: TAG,
    operationId: 'updateContent',
    summary: 'Editar metadados do conteúdo',
    description: 'Não altera o ficheiro. Para substituir o ficheiro, criar um novo item.',
    roles: ['TUTOR'],
    params: IdParams,
    body: UpdateContentSchema,
    response: { 200: obj({ content: ContentItem }), ...errorResponses(401, 403, 404, 422) },
  }),
  changeStatus: docs({
    tags: TAG,
    operationId: 'changeContentStatus',
    summary: 'Alterar o estado do conteúdo',
    description: 'DRAFT → PUBLISHED torna o conteúdo visível no catálogo. ARCHIVED esconde-o.',
    roles: ['TUTOR'],
    params: IdParams,
    body: ChangeStatusSchema,
    response: { 200: obj({ content: ContentItem }), ...errorResponses(401, 403, 404, 422) },
  }),
  delete: docs({
    tags: TAG,
    operationId: 'deleteContent',
    summary: 'Eliminar o próprio conteúdo',
    roles: ['TUTOR'],
    params: IdParams,
    response: { 204: z.undefined().describe('Sem conteúdo'), ...errorResponses(401, 403, 404) },
  }),

  // ── URL de acesso (DPM, RF-CON-03) ───────────────────────────────────────────
  accessUrl: docs({
    tags: TAG,
    operationId: 'getContentUrl',
    summary: 'URL de acesso ao conteúdo (DPM)',
    description:
      'Devolve uma URL assinada de curta duração (5 min). ' +
      'Conteúdo pago exige pacote de horas activo (senão `402`). ' +
      '`datalite=true` devolve a versão transcodificada (360p/480p), se disponível.',
    roles: ['STUDENT', 'GUARDIAN', 'TUTOR', 'ADMIN'],
    params: IdParams,
    querystring: AccessUrlQuerySchema,
    response: {
      200: obj({ url: z.string().url(), expiresInSeconds: z.number().int() }),
      ...errorResponses(401, 402, 403, 404, 422),
    },
  }),

  // ── Administração ─────────────────────────────────────────────────────────────
  adminList: docs({
    tags: TAG_ADMIN,
    operationId: 'adminListContents',
    summary: 'Todos os conteúdos (admin)',
    roles: ['ADMIN'],
    mfa: 'session',
    querystring: ListAdminQuerySchema,
    response: { 200: obj({ contents: z.array(ContentItem), ...pageShape }), ...errorResponses(401, 403, 422) },
  }),
  adminDelete: docs({
    tags: TAG_ADMIN,
    operationId: 'adminDeleteContent',
    summary: 'Eliminar qualquer conteúdo (admin)',
    roles: ['ADMIN'],
    mfa: 'session',
    params: IdParams,
    response: { 204: z.undefined().describe('Sem conteúdo'), ...errorResponses(401, 403, 404) },
  }),
};
