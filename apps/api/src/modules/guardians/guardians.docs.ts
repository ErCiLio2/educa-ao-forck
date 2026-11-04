import { z } from 'zod';
import { docs, errorResponses, isoDate, named, NoContent, obj, uuid } from '../../shared/core/openapi';
import { CreateDependentSchema, ResetDependentPasswordSchema } from './guardians.types';

const StudentParams = z.object({ studentId: uuid });

const Dependent = obj({
  id: uuid,
  name: z.string(),
  email: z.string().email(),
  birthDate: isoDate.nullable(),
  createdAt: isoDate,
});

const Consent = named(
  'Consent',
  obj({
    id: uuid,
    consentType: z.enum(['DATA_PROCESSING']),
    grantedAt: isoDate,
    revokedAt: isoDate.nullable().describe('Preenchido quando o Encarregado revoga'),
  }),
);

const TAG = ['Encarregados'];

export const guardiansDocs = {
  createDependent: docs({
    tags: TAG, operationId: 'createDependent', summary: 'Criar a conta de um dependente',
    description:
      'Os menores só existem como dependentes de um Encarregado (RN-02). O Encarregado entrega as credenciais ao aluno. ' +
      'Os dados do dependente só são tratados depois de o consentimento ser concedido.',
    roles: ['GUARDIAN'], body: CreateDependentSchema,
    response: { 201: obj({ dependent: Dependent }), ...errorResponses(401, 403, 409, 422) },
  }),
  listDependents: docs({
    tags: TAG, operationId: 'listDependents', summary: 'Os meus dependentes',
    roles: ['GUARDIAN'],
    response: { 200: obj({ dependents: z.array(Dependent.extend({ consentGranted: z.boolean() })) }), ...errorResponses(401, 403) },
  }),
  resetDependentPassword: docs({
    tags: TAG, operationId: 'resetDependentPassword', summary: 'Repor a password de um dependente',
    description: 'Revoga as sessões do dependente. Não depende do consentimento (segurança da conta).',
    roles: ['GUARDIAN'], params: StudentParams, body: ResetDependentPasswordSchema,
    response: { 204: NoContent, ...errorResponses(401, 403, 422, 429) },
  }),
  listConsents: docs({
    tags: ['Consentimento'], operationId: 'listConsents', summary: 'Histórico de consentimentos de um dependente',
    roles: ['GUARDIAN'], params: StudentParams,
    response: { 200: obj({ consents: z.array(Consent) }), ...errorResponses(401, 403, 422) },
  }),
  grantConsent: docs({
    tags: ['Consentimento'], operationId: 'grantConsent', summary: 'Conceder consentimento (RF-ENC-01)',
    description: 'Auditável. 409 se já houver um consentimento activo.',
    roles: ['GUARDIAN'], params: StudentParams,
    response: { 201: obj({ consent: Consent }), ...errorResponses(401, 403, 409, 422) },
  }),
  revokeConsent: docs({
    tags: ['Consentimento'], operationId: 'revokeConsent', summary: 'Revogar consentimento (RF-ENC-02)',
    description: 'Tem efeito imediato: o dependente deixa de aceder aos dados e o Encarregado deixa de ver a sua actividade.',
    roles: ['GUARDIAN'], params: StudentParams,
    response: { 200: obj({ consent: Consent }), ...errorResponses(401, 403, 404, 422) },
  }),
  myConsent: docs({
    tags: ['Consentimento'], operationId: 'getMyConsentStatus', summary: 'O estado do meu consentimento',
    description: '`required` é falso para alunos sem Encarregado. Enquanto `required && !granted` o aluno não pode usar a plataforma.',
    roles: ['STUDENT'],
    response: { 200: obj({ consent: obj({ required: z.boolean(), granted: z.boolean() }) }), ...errorResponses(401, 403) },
  }),
};
