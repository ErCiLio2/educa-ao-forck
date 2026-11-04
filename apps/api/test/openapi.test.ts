import { readFileSync } from 'node:fs';
import SwaggerParser from '@apidevtools/swagger-parser';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { registeredRoutes } from '../src/shared/core/openapi';
import { API_VERSION } from '../src/version';
import { ID, PROTECTED } from './protected-routes';

// Contrato OpenAPI: completo, válido, consistente e alinhado com o que o código impõe.
type Operation = {
  operationId?: string; tags?: string[]; summary?: string; security?: unknown[];
  parameters?: Array<{ name: string; in: string }>; requestBody?: unknown;
  responses: Record<string, { content?: { 'application/json'?: { schema?: unknown } } }>;
  'x-roles'?: string[]; 'x-mfa'?: string;
};
type Spec = {
  openapi: string; info: { version: string }; paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> };
};

// GET /openapi.json serve o próprio contrato e não se documenta a si mesmo
const EXEMPT = new Set(['GET /openapi.json']);

let spec: Spec;
const operations = () =>
  Object.entries(spec.paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, op]) => ({ method: method.toUpperCase(), path, op })),
  );

beforeAll(async () => {
  const app = buildApp();
  await app.ready();
  spec = JSON.parse(JSON.stringify(app.swagger()));
});

describe('validade', () => {
  it('é OpenAPI 3.0 válido e todos os $ref resolvem', async () => {
    expect(spec.openapi).toBe('3.0.3');
    await SwaggerParser.validate(JSON.parse(JSON.stringify(spec)));
  });

  it('a versão do contrato é a do package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(spec.info.version).toBe(pkg.version);
    expect(API_VERSION).toBe(pkg.version);
  });

  it('declara o esquema de autenticação e o componente de erro', () => {
    expect(spec.components.securitySchemes).toHaveProperty('bearerAuth');
    expect(spec.components.schemas).toHaveProperty('Error');
  });
});

describe('completude', () => {
  it('toda a rota registada no Fastify tem contrato (e vice-versa)', () => {
    const routes = registeredRoutes().filter((r) => !EXEMPT.has(r.key));
    const missing = routes.filter((r) => r.docs === null).map((r) => r.key);
    expect(missing, `rotas sem contrato: ${missing.join(', ')}`).toEqual([]);

    const inSpec = new Set(operations().map((o) => `${o.method} ${o.path.replace(/\{(\w+)\}/g, ':$1')}`));
    const registered = new Set(routes.map((r) => r.key));
    expect([...inSpec].filter((k) => !registered.has(k))).toEqual([]);
    expect([...registered].filter((k) => !inSpec.has(k))).toEqual([]);
    expect(routes.length).toBeGreaterThan(60);
  });
});

describe('consistência', () => {
  it('operationId único; tags e resumo em todas as operações', () => {
    const ids = operations().map((o) => o.op.operationId);
    expect(ids.every((id) => typeof id === 'string' && /^[a-z][A-Za-z0-9]+$/.test(id!))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    for (const { method, path, op } of operations()) {
      expect(op.tags?.length, `${method} ${path} sem tags`).toBeGreaterThan(0);
      expect(op.summary, `${method} ${path} sem resumo`).toBeTruthy();
    }
  });

  it('toda a operação autenticada documenta 401; as restritas a perfis documentam 403', () => {
    for (const { method, path, op } of operations()) {
      const authenticated = (op.security?.length ?? 0) > 0;
      if (authenticated) expect(op.responses, `${method} ${path} sem 401`).toHaveProperty('401');
      const restricted = op['x-roles'] && op['x-roles'].length < 4;
      if (authenticated && restricted) expect(op.responses, `${method} ${path} sem 403`).toHaveProperty('403');
      if (authenticated) expect(op['x-roles'], `${method} ${path} sem perfis`).toBeDefined();
    }
  });

  it('toda a operação com corpo ou query documenta 422; as que têm :param declaram-no', () => {
    for (const { method, path, op } of operations()) {
      const hasInput = op.requestBody !== undefined || (op.parameters ?? []).some((p) => p.in === 'query');
      if (hasInput) expect(op.responses, `${method} ${path} sem 422`).toHaveProperty('422');
      for (const [, name] of path.matchAll(/\{(\w+)\}/g)) {
        expect(op.parameters?.some((p) => p.in === 'path' && p.name === name), `${method} ${path}: falta o parâmetro ${name}`).toBe(true);
      }
    }
  });

  it('todos os erros usam o mesmo componente e há os erros comuns', () => {
    for (const { method, path, op } of operations()) {
      for (const status of ['400', '429', '500']) expect(op.responses, `${method} ${path} sem ${status}`).toHaveProperty(status);
      for (const [status, res] of Object.entries(op.responses)) {
        if (Number(status) >= 400) {
          expect(JSON.stringify(res.content), `${method} ${path} ${status}`).toContain('#/components/schemas/Error');
        }
      }
    }
  });

  it('nenhuma resposta de sucesso expõe campos internos ou segredos', () => {
    const forbidden = ['password', 'mfaSecret', 'codeHash', 'diplomaKey', 'criminalRecordKey', 'passportPhotoKey', 'videoIntroKey', 'idempotencyKey', 'birthDate'];
    // birthDate só é legítimo no dependente criado/listado pelo próprio Encarregado
    const allowedBirthDate = new Set(['createDependent', 'listDependents']);
    const text = (v: unknown) => JSON.stringify(v);
    for (const { op } of operations()) {
      for (const [status, res] of Object.entries(op.responses)) {
        if (Number(status) >= 400) continue;
        const body = text(res.content);
        for (const name of forbidden) {
          if (name === 'birthDate' && allowedBirthDate.has(op.operationId!)) continue;
          expect(body, `${op.operationId} expõe "${name}"`).not.toContain(`"${name}"`);
        }
      }
    }
    // os componentes reutilizados também
    for (const [name, schema] of Object.entries(spec.components.schemas)) {
      for (const field of forbidden) expect(text(schema), `componente ${name} expõe "${field}"`).not.toContain(`"${field}"`);
    }
  });
});

describe('o contrato coincide com o que o código impõe', () => {
  const concrete = (path: string) => path.replace(/\{(\w+)\}/g, ID);

  it('os perfis documentados são exactamente os da matriz de segurança', () => {
    const fromSpec = new Map(
      operations()
        .filter((o) => (o.op.security?.length ?? 0) > 0)
        .map((o) => [`${o.method} ${concrete(o.path)}`, [...(o.op['x-roles'] ?? [])].sort()]),
    );
    const fromMatrix = new Map(PROTECTED.map(([method, url, roles]) => [`${method} ${url}`, [...roles].sort()]));

    for (const [route, roles] of fromMatrix) expect(fromSpec.get(route), `contrato de ${route}`).toEqual(roles);
    expect([...fromSpec.keys()].filter((r) => !fromMatrix.has(r)), 'rotas protegidas fora da matriz de segurança').toEqual([]);
  });

  it('as rotas públicas do contrato são as que não têm autenticação', () => {
    const publicRoutes = operations().filter((o) => (o.op.security?.length ?? 0) === 0).map((o) => `${o.method} ${o.path}`).sort();
    expect(publicRoutes).toEqual(
      [
        'GET /health', 'GET /health/auth',
        'POST /api/v1/auth/register', 'POST /api/v1/auth/login', 'POST /api/v1/auth/refresh', 'POST /api/v1/auth/logout', 'POST /api/v1/auth/mfa/verify',
        'GET /api/v1/tutors', 'GET /api/v1/tutors/{id}',
        'GET /api/v1/bookings/sessions', 'GET /api/v1/bookings/sessions/{id}',
        'GET /api/v1/payments/offers', 'POST /api/v1/payments/webhooks/{gateway}',
        'GET /api/v1/reputation/tutors/{tutorId}/reviews',
        'GET /api/v1/contents', 'GET /api/v1/contents/{id}',
        'GET /api/v1/notifications/vapid',
      ].sort(),
    );
  });
});
