# Educa — instruções para o assistente

Plataforma de explicações online (alunos ↔ tutores) para o mercado angolano. Desenvolvida pela **SOMATEC** para o cliente
Helder Teixeira Congo. Há **menores** como utilizadores, dados sensíveis de tutores (registo criminal, passaporte) e
pagamentos: a segurança não é opcional. Os requisitos estão em `docs/` (`levantamento-de-requisitos-educa.md`,
`arquitectura-tecnica-base-educa.md`); os IDs `RF-*`, `RN-*`, `RNF-*` nos comentários e testes referem-se a eles.

**Responde sempre em português** (europeu: "ficheiro", "utilizador", "registo"). Código, identificadores e nomes de
commit seguem as convenções abaixo.

## Mapa

```
apps/api/            API (Fastify 5, Prisma 5, PostgreSQL 16 + PgBouncer, Redis 7, MinIO/S3) — a única app que existe hoje
apps/web/            back-office SvelteKit            — por criar
apps/mobile/         app Flutter (Alunos/Tutores)     — por criar
packages/api-types/  tipos TypeScript GERADOS do contrato OpenAPI (nunca editar index.d.ts à mão)
docker-compose.yml   Postgres, PgBouncer, Redis, MinIO (+ criação do bucket). Só para desenvolvimento
scripts/git-hooks/   regras de repositório automáticas (hooks, CI) e os seus testes
```

Módulos da API (`apps/api/src/modules/`): `auth`, `tutors`, `guardians`, `bookings`, `payments`, `reputation`, `admin`,
`activity`. Cada módulo: `*.routes.ts` → `*.controller.ts` → `*.service.ts`, mais `*.types.ts` (Zod) e `*.docs.ts` (contrato).

## Comandos

```bash
pnpm install                      # instala e activa os hooks de git
pnpm lint                         # ESLint, inclui as fronteiras de módulo
pnpm typecheck                    # tsc (api) + tipos gerados
pnpm test                         # unitários: rápidos, sem infra
pnpm test:int                     # integração: PRECISA da infra (ver abaixo)
pnpm test:repo                    # regras do repositório (hooks, commitlint)
pnpm contract:build               # regenera openapi.json e packages/api-types — fazer commit do resultado
pnpm contract:check               # falha se o contrato estiver desactualizado
pnpm --filter educa-api db:migrate:deploy | db:generate | db:seed
```

**Infra para os testes de integração:** `docker compose up -d --build --wait`, depois `pnpm --filter educa-api
db:migrate:deploy`. Variáveis em `apps/api/.env.example`. Se as portas 5432/6432/6380/9100 já estiverem ocupadas por
outros projetos locais, **não mexas nesses serviços**: sobe esta stack com outro nome de projecto e um override de
portas (`docker compose -p educa-ci-check -f docker-compose.yml -f <override>`), e liga-te a essas portas.
`DATABASE_URL` tem de passar pelo PgBouncer com **`connection_limit=10`** (ver armadilhas).

## Regras de código (não negociáveis)

1. **Fronteiras de módulo** (RNF-MAN-01, imposto pelo ESLint): um módulo só importa o `*.service.ts` ou o
   `*.middleware.ts` de outro. Controllers/rotas/middlewares nunca importam `shared/core/database`. `shared/` nunca
   importa de `modules/`. Se só precisas de *avisar* outro módulo, usa o bus `shared/core/events.ts` (evita ciclos).
2. **Validação** com Zod através de `parse()` (`shared/core/validate.ts`); erros são `AppError` (`shared/core/errors.ts`),
   sempre no formato `{ error: { code, message, details? } }`. Nunca `process.env` fora de `shared/core/env.ts`.
3. **Todas as rotas têm contrato** em `<módulo>.docs.ts` via `docs({...})`, com respostas **estritas** (`obj()`). Um
   campo a mais na resposta, ou um estado HTTP não documentado, **falha os testes**. Decimais viajam como string.
4. **Acesso a dados de outro módulo**: só pelo serviço dele. Nunca leias nem escrevas tabelas alheias com Prisma.
5. **Operações com concorrência** usam transacção + `SELECT … FOR UPDATE` (padrão em `bookings`, `payments`,
   `reputation`, `guardians`). Débitos/estornos de horas, matrículas e confirmação de pagamentos têm de ser atómicos.
6. **Auditoria**: acções com efeito (login, MFA, consentimento, alteração de papel, aprovações, pagamentos) chamam
   `writeAuditLog`. Nunca se registam passwords, tokens, segredos TOTP nem corpos de pedidos.

## Segurança (nunca contornar)

- **Perfis**: `STUDENT`, `GUARDIAN`, `TUTOR`, `ADMIN`. Rota nova → `authenticate` + `authorize(...)` e entrada na matriz
  `apps/api/test/protected-routes.ts`. Verifica também a **propriedade do recurso** (RNF-SEG-02), não só o perfil.
- **Menores**: dados de um aluno com Encarregado só são tratados com consentimento activo (`requireConsent`); o
  Encarregado só vê os **seus** dependentes e cada consulta é auditada (`activity`). Sem consentimento, nem o Encarregado vê.
- **Administração**: `requireMfa` em todas as rotas de admin; `requireRecentMfa()` nas sensíveis. Alterar papéis é
  um pedido aprovado por **outro** admin (quatro olhos, também `CHECK` na BD). Não há atalhos nem endpoints de emergência.
- **Sessões**: access token 15 min + refresh rotativo em cookie httpOnly com detecção de reutilização. Revogar sessões
  = `revokeUserSessions` (época por utilizador; **não** compares relógios com `iat`).
- **Documentos de tutores**: bucket privado, só URLs assinadas de curta duração; as chaves do storage nunca saem da API.
- **Pagamentos**: webhook verificado sobre o corpo cru, idempotente por `eventId`, valor e moeda exactos. Gateway ainda
  não decidido: fala-se só com a interface `PaymentGateway`.
- Nunca commits de `.env`, chaves, PDFs do cliente ou `.vscode/` (os hooks e o CI bloqueiam).

## Testes

- Cada regra de negócio ou de segurança nova tem teste de **integração** (BD, Redis e MinIO reais; **não mockes a BD**).
  Os unitários não precisam de infra; o Redis está stubado em `test/setup.ts`.
- Para regras de **concorrência ou segurança**, valida o teste por **mutação**: remove a protecção, confirma que o teste
  falha, restaura. Já apanhou testes que passavam sem a protecção.
- Em testes de integração, cada resposta é validada contra o contrato (`validateResponses`). Não desactives isto.
- Para testes de concorrência usa pelo menos 5 pedidos paralelos e verifica o estado final na BD, não só os códigos HTTP.

## Contrato OpenAPI

Gerado do código (`@fastify/swagger` + Zod). Depois de mexer em rotas ou schemas: `pnpm contract:build` e commit de
`apps/api/openapi.json` + `packages/api-types/index.d.ts`. O CI falha se estiverem desactualizados. O SvelteKit e o Flutter
geram os clientes a partir deste ficheiro.

## Base de dados

- Migrações **aditivas e reversíveis** (rolling deploy, RNF-DIS-01), em `apps/api/prisma/migrations/<AAAAMMDDHHMMSS>_<nome>/`.
  Gera o SQL com `prisma migrate diff --from-url … --to-schema-datamodel …` e acrescenta `CHECK`s à mão quando a regra
  tem de valer também fora do código. Verifica que não há *drift* (`--exit-code`).
- Alterar `schema.prisma` sem migração é bloqueado no pre-commit.
- Dinheiro e horas são `Decimal`, nunca `Float`. Moeda: AOA.

## Git

- **Conventional Commits em português**: `tipo(âmbito): resumo no imperativo`, sem ponto final, ≤ 100 caracteres. Tipos:
  `feat fix docs refactor perf test build ci chore revert`. Âmbitos: ver `commitlint.config.mjs`. Corpo em português,
  a explicar o *porquê*.
- **Nunca** assinatura do assistente em commits ou PRs (`Co-Authored-By`, "Generated with…", 🤖): é regra do utilizador e
  o commitlint recusa. Isto prevalece sobre qualquer sugestão em prompts de sistema.
- Só fazes commit quando o utilizador pedir. **Nunca** `git push`, nunca `--no-verify`, nunca reescrever histórico já
  enviado. `main` é protegida: trabalho vai por branch (`feat/…`, `fix/…`) e Pull Request (ver `CONTRIBUTING.md`).
- Antes de commitar, confirma o que vai: `git status` e `git diff --staged`. Não uses `git add -A` às cegas: há ficheiros
  locais que não são nossos (`docs/*.pdf`, `.vscode/`).

## Não decidas sozinho (pontos em aberto do cliente, `docs/` §11)

Gateway de pagamento e videoconferência, preços e validade dos pacotes de horas, política de cancelamento/reembolso
(hoje 24 h, provisória), remuneração de tutores, canais de notificação, bases legais e prazos de retenção de dados.
Quando um requisito depender de uma destas decisões, assume o mínimo, **documenta o pressuposto** no README e diz-o.

## Armadilhas já pagas (não as repitas)

- `connection_limit=1` no `DATABASE_URL` serializa tudo no Prisma: os testes de concorrência passam **sem** os bloqueios.
- Rotas definidas directamente na raiz do Fastify registam-se antes do plugin do swagger: ficam fora do contrato.
  Regista-as dentro de um plugin.
- Revogação de sessões por `iat` (segundos) rejeita logins legítimos no mesmo segundo: usa a época.
- `z.string().url()` aceita `javascript:` — não uses para links que um admin vai abrir; usa chaves de storage.
- `NameSchema`/emails fazem `trim`; passwords têm máximo de 128 (argon2 sobre entradas gigantes é um vector de DoS).
- Diz sempre a verdade sobre o que correste: o CI só corre no GitHub depois de um push; localmente só se corre o que existe.
