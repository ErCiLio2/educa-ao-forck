import type { FastifyInstance, FastifyRequest, FastifySchema } from 'fastify';
import swagger from '@fastify/swagger';
import { z, type ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Contrato OpenAPI gerado a partir das rotas reais e dos schemas Zod (fonte única de verdade).
// Os schemas de resposta são verificados contra as respostas reais nos testes (ver validateResponses).

// ── Componentes nomeados ─────────────────────────────────────────────────────
// Um schema registado com `named()` torna-se um componente reutilizável ($ref) no spec, o que dá aos
// clientes gerados (TypeScript, Dart) tipos com nome em vez de tipos anónimos por rota.
const registry = new Map<string, ZodTypeAny>();

export function named<T extends ZodTypeAny>(name: string, schema: T): T {
  const existing = registry.get(name);
  if (existing && existing !== schema) throw new Error(`Componente OpenAPI duplicado: ${name}`);
  registry.set(name, schema);
  return schema;
}

// ── Erros (formato único da API) ─────────────────────────────────────────────

export const ErrorBody = named(
  'Error',
  z.object({
    error: z.object({
      code: z.string().describe('Código estável para o cliente decidir o que fazer, ex.: MFA_REQUIRED'),
      message: z.string(),
      details: z.unknown().optional().describe('Só em 422: erros por campo (formato do Zod flatten)'),
    }),
  }),
);

const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: 'Pedido malformado (ex.: JSON inválido)',
  401: 'Não autenticado, token inválido/expirado ou sessão revogada',
  402: 'Pagamento necessário (sem horas disponíveis)',
  403: 'Sem permissão (perfil errado, consentimento em falta, MFA exigido)',
  404: 'Recurso não encontrado',
  409: 'Conflito com o estado actual',
  422: 'Dados inválidos',
  429: 'Demasiados pedidos / tentativas',
  500: 'Erro interno',
};

// Mantém a identidade de ErrorBody (para virar $ref): a descrição por estado é posta no transform
// Resposta sem corpo (204). Sentinela e não `null`: o Fastify percorre as entradas de `response` e rebenta com null
export const NoContent = z.undefined().describe('Sem conteúdo');

export const errorResponses = (...codes: number[]) =>
  Object.fromEntries(codes.map((c) => [c, ErrorBody])) as Record<number, ZodTypeAny>;

// Podem ocorrer em qualquer rota: ficam documentados e validados sem ser preciso declará-los
const COMMON_ERRORS = [400, 429, 500];

// ── Esquema de uma rota ──────────────────────────────────────────────────────

export interface RouteDocs {
  tags: string[];
  summary: string;
  description?: string;
  body?: ZodTypeAny;
  querystring?: ZodTypeAny;
  params?: ZodTypeAny;
  headers?: ZodTypeAny;
  response: Record<number, ZodTypeAny>; // NoContent = sem corpo (ex.: 204)
  security?: 'bearer' | 'none';
  /** Perfis autorizados; documentado para os integradores */
  roles?: Array<'STUDENT' | 'GUARDIAN' | 'TUTOR' | 'ADMIN'>;
  mfa?: 'session' | 'recent';
  operationId?: string;
}

// O Fastify tipa `schema` para JSON Schema; os nossos são Zod + metadados, por isso o cast fica num só sítio
export const docs = (d: RouteDocs): FastifySchema => d as unknown as FastifySchema;

// ── Plugin ───────────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;
const isZod = (v: unknown): v is ZodTypeAny => typeof v === 'object' && v !== null && '_def' in v && 'safeParse' in v;

// Os tipos genéricos do conversor são recursivos ao ponto de o TypeScript desistir: tipamo-lo à mão
const convert = zodToJsonSchema as unknown as (schema: unknown, options: Json) => Json;

function convertRaw(schema: ZodTypeAny): Json {
  const json = convert(schema, {
    target: 'openApi3',
    $refStrategy: 'root',
    definitions: Object.fromEntries(registry),
    definitionPath: 'components/schemas',
    effectStrategy: 'input',
  });
  delete json.$schema;
  return json;
}

// Para uma rota: o conversor junta os componentes nomeados que encontra numa chave auxiliar; aqui retira-se
// (os componentes vão para components.schemas uma só vez) e fica apenas o schema, com $ref onde há nomes
function toJson(schema: ZodTypeAny): Json {
  const json = convertRaw(schema);
  delete json['components/schemas'];
  return inlineLocalRefs(json, json);
}

// Quando o mesmo sub-schema aparece várias vezes, o conversor refere-se à primeira ocorrência com um ponteiro local
// (ex.: #/properties/a/properties/b), que não é válido num documento OpenAPI. Expande-se no sítio; só os
// componentes nomeados (#/components/schemas/…) ficam como $ref.
function inlineLocalRefs(node: unknown, root: Json): Json {
  if (Array.isArray(node)) return node.map((n) => inlineLocalRefs(n, root)) as unknown as Json;
  if (node === null || typeof node !== 'object') return node as Json;
  const obj = node as Json;
  const ref = obj.$ref;
  if (typeof ref === 'string' && ref.startsWith('#/') && !ref.startsWith('#/components/')) {
    let target: unknown = root;
    for (const part of ref.slice(2).split('/')) target = (target as Json)?.[part];
    if (target === undefined) throw new Error(`$ref local não resolvido: ${ref}`);
    return inlineLocalRefs(target, root);
  }
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, inlineLocalRefs(v, root)])) as Json;
}

// Deve ser chamado ANTES de registar as rotas: o plugin tem de estar na fila para ver o `onRoute` de cada uma.
export function registerOpenApi(app: FastifyInstance, version: string): void {
  // O Fastify não deve validar nem filtrar: a validação é feita pelos controllers (Zod) e as respostas são
  // enviadas tal como estão. Os schemas servem para documentar e para os testes de contrato.
  app.setValidatorCompiler(() => (data) => ({ value: data }));
  app.setSerializerCompiler(() => (data) => JSON.stringify(data));

  // Guarda o contrato de cada rota (método + caminho completo) para a verificação das respostas nos testes
  app.addHook('onRoute', (route) => {
    const docs = route.schema as unknown as RouteDocs | undefined;
    for (const method of Array.isArray(route.method) ? route.method : [route.method]) {
      if (method === 'HEAD' || method === 'OPTIONS') continue; // criadas automaticamente pelo Fastify
      allRoutes.set(`${method} ${route.url}`, docs?.response ? docs : null);
      if (docs?.response) rememberRoute(method, route.url, docs);
    }
  });

  app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Educa API',
        version,
        description:
          'API da plataforma de explicações online Educa (SOMATEC). Autenticação por Bearer JWT (15 min); o refresh token ' +
          'vai em cookie httpOnly. Erros seguem sempre `{ error: { code, message, details? } }`. As rotas de administração ' +
          'exigem MFA; as sensíveis exigem MFA recente (`MFA_STEP_UP_REQUIRED` → `POST /auth/mfa/step-up`).',
      },
      servers: [{ url: '/', description: 'Servidor actual' }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Access token JWT de curta duração' },
        },
      },
    },
    transform: ({ schema, url }) => {
      const docs = schema as unknown as RouteDocs | undefined;
      // Rota sem contrato: fica fora do spec (e o teste de completude falha até ser documentada)
      if (!docs?.response) return { schema: { hide: true } as never, url };
      const out: Json = { tags: docs.tags, summary: docs.summary };

      const notes: string[] = [];
      if (docs.description) notes.push(docs.description);
      if (docs.roles) notes.push(`**Perfis:** ${docs.roles.join(', ')}.`);
      if (docs.mfa === 'session') notes.push('**Exige** sessão estabelecida com MFA.');
      if (docs.mfa === 'recent') notes.push('**Exige** MFA verificado há menos de 10 min (senão `MFA_STEP_UP_REQUIRED`).');
      if (notes.length) out.description = notes.join('\n\n');
      if (docs.operationId) out.operationId = docs.operationId;
      out.security = docs.security === 'none' ? [] : [{ bearerAuth: [] }];
      // Extensões para os integradores e para os testes (a matriz de perfis tem de coincidir com o código)
      if (docs.roles) out['x-roles'] = docs.roles;
      if (docs.mfa) out['x-mfa'] = docs.mfa;

      if (docs.body) out.body = toJson(docs.body);
      if (docs.querystring) out.querystring = toJson(docs.querystring);
      if (docs.params) out.params = toJson(docs.params);
      if (docs.headers) out.headers = toJson(docs.headers);

      const response: Record<string, Json> = {};
      for (const [status, schemaForStatus] of Object.entries(docs.response)) {
        const code = Number(status);
        if (schemaForStatus === NoContent) response[status] = { description: 'Sem conteúdo' };
        else {
          const description = code >= 400 ? (ERROR_DESCRIPTIONS[code] ?? 'Erro') : (schemaForStatus.description ?? 'Sucesso');
          response[status] = { description, content: { 'application/json': { schema: toJson(schemaForStatus) } } };
        }
      }
      for (const code of COMMON_ERRORS) {
        response[String(code)] ??= {
          description: ERROR_DESCRIPTIONS[code],
          content: { 'application/json': { schema: toJson(ErrorBody) } },
        };
      }
      out.response = response;
      return { schema: out as never, url };
    },
    transformObject: (input) => {
      // Acrescenta os componentes nomeados a components.schemas
      const openapiObject = (input as unknown as { openapiObject: Json }).openapiObject;
      const doc = openapiObject as unknown as { components?: { schemas?: Json } };
      doc.components ??= {};
      doc.components.schemas = { ...(doc.components.schemas ?? {}) };
      for (const [name, schema] of registry) {
        const defs = convertRaw(schema)['components/schemas'] as Record<string, Json>;
        doc.components.schemas[name] = defs[name];
      }
      return openapiObject as never;
    },
  });
}

// ── Verificação do contrato (testes) ─────────────────────────────────────────

const lookup = new Map<string, RouteDocs>();
// Todas as rotas registadas (null = sem contrato): permite ao teste de completude apanhar as esquecidas
const allRoutes = new Map<string, RouteDocs | null>();

export function registeredRoutes(): Array<{ key: string; docs: RouteDocs | null }> {
  return [...allRoutes].map(([key, docs]) => ({ key, docs }));
}

export function rememberRoute(method: string, url: string, docs: RouteDocs): void {
  lookup.set(`${method.toUpperCase()} ${url}`, docs);
}

// Hook para os testes: valida CADA resposta real contra o schema documentado para esse estado.
// Se o código e o contrato divergirem, o pedido falha e o teste que o originou também.
export function validateResponses(app: FastifyInstance): void {
  app.addHook('onSend', async (request: FastifyRequest, reply, payload) => {
    const route = request.routeOptions?.url;
    if (!route) return payload; // 404 genérico do Fastify
    const docs = lookup.get(`${request.method} ${route}`);
    if (!docs) return payload; // rotas sem contrato (ex.: /health) — apanhadas pelo teste de completude

    const status = reply.statusCode;
    const declared = docs.response[status] ?? (COMMON_ERRORS.includes(status) || status === 404 ? ErrorBody : undefined);
    if (declared === undefined) {
      throw new Error(`Contrato: ${request.method} ${route} respondeu ${status}, que não está documentado`);
    }
    if (declared === NoContent) {
      if (payload !== undefined && payload !== '' && payload !== null) {
        throw new Error(`Contrato: ${request.method} ${route} (${status}) devia ser sem corpo`);
      }
      return payload;
    }
    const parsed = declared.safeParse(typeof payload === 'string' && payload ? JSON.parse(payload) : payload);
    if (!parsed.success) {
      throw new Error(
        `Contrato: resposta ${status} de ${request.method} ${route} não cumpre o schema documentado: ` +
          JSON.stringify(parsed.error.issues.slice(0, 3)),
      );
    }
    return payload;
  });
}

export { isZod };

// ── Blocos para escrever respostas ───────────────────────────────────────────
// As respostas são ESTRITAS: um campo a mais (ex.: um hash por engano) falha o teste de contrato.

export const obj = z.strictObject;
export const uuid = z.string().uuid();
export const isoDate = z.string().datetime();
// Prisma.Decimal serializa como string, sem perder precisão
export const decimal = z.string().regex(/^-?\d+(\.\d+)?$/).describe('Decimal exacto, em string');

export const Roles = z.enum(['STUDENT', 'GUARDIAN', 'TUTOR', 'ADMIN']);

export const pageShape = {
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
  pages: z.number().int(),
};

// Cookie de refresh token: documentado nas descrições das rotas que o definem
export const REFRESH_COOKIE_NOTE =
  'Define o cookie `refresh_token` (httpOnly, SameSite=Strict, path `/api/v1/auth`) com o refresh token rotativo.';
