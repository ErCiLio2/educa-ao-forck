# Educa API

Plataforma de explicações online que liga alunos a tutores — desenvolvida pela **SOMATEC** para o mercado angolano (Luanda, 2026).

## Stack

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js 22 + TypeScript |
| Framework HTTP | Fastify 5 |
| ORM / Base de dados | Prisma 5 + PostgreSQL 16 |
| Connection pool | PgBouncer (transaction mode) |
| Cache / Rate-limit / Filas | Redis 7 + BullMQ |
| Object storage | S3-compatível (MinIO em dev), bucket privado + URLs assinadas |
| Clientes | SvelteKit (back-office web) e Flutter (app Alunos/Tutores) |
| Autenticação | JWT (access 15 min) + refresh token rotativo (cookie httpOnly) |
| Hashing de passwords | Argon2id |
| Validação | Zod |

## Pré-requisitos

- Node.js >= 22
- pnpm >= 11
- Docker + Docker Compose

## Arranque rápido

```bash
# 1. Variáveis de ambiente
cp apps/api/.env.example apps/api/.env
# editar apps/api/.env com os segredos reais

# 2. Infraestrutura
docker compose up -d

# 3. Dependências
pnpm install

# 4. Migrações
pnpm --filter educa-api db:migrate:deploy
pnpm --filter educa-api db:generate

# 5. Servidor de desenvolvimento
pnpm dev:api
```

O servidor fica disponível em `http://localhost:3000`.

## Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | URL PgBouncer (runtime) |
| `DIRECT_URL` | URL PostgreSQL directo (migrações) |
| `REDIS_URL` | URL Redis |
| `ACCESS_TOKEN_SECRET` | Segredo HMAC para JWT de acesso |
| `REFRESH_TOKEN_SECRET` | Segredo HMAC para refresh tokens |
| `REFRESH_TOKEN_EXPIRY_SECONDS` | TTL do refresh token (default: 604800 = 7 dias) |
| `CORS_ORIGIN` | Origem permitida pelo CORS (default: `http://localhost:3001`) |
| `S3_ENDPOINT` | Endpoint S3 (MinIO em dev; omitir na AWS) |
| `S3_REGION` / `S3_BUCKET` | Região e bucket privado dos documentos |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | Credenciais do storage |
| `S3_FORCE_PATH_STYLE` | `true` para MinIO |
| `NODE_ENV` | `development` \| `production` |
| `PORT` | Porta HTTP (default: 3000) |

## Endpoints disponíveis

### Health

```
GET  /health
GET  /health/auth
```

### Autenticação

```
POST /api/v1/auth/register    # rate-limited: 10 req / 15 min
POST /api/v1/auth/login       # rate-limited: 10 req / 15 min
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
GET  /api/v1/auth/me          # requer Bearer token
```

### Histórico e métricas (`activity`)

Módulo só de leitura (RF-HIS-01, RF-ENC-03): compõe os números que cada módulo expõe pelo seu serviço, sem tocar nas
tabelas dos outros.

```
GET /api/v1/activity/me/summary                       # STUDENT: presenças, faltas, taxa, horas, disciplinas, próxima aula
GET /api/v1/activity/me/history                       # STUDENT: aulas (?from&to&page&limit), mais recentes primeiro
GET /api/v1/activity/dependents                       # GUARDIAN: visão geral; sem consentimento só { id, name, consentGranted:false }
GET /api/v1/activity/dependents/:studentId/summary    # GUARDIAN: igual ao resumo do aluno
GET /api/v1/activity/dependents/:studentId/history    # GUARDIAN: igual ao histórico do aluno
GET /api/v1/activity/tutor/summary                    # TUTOR: estatísticas do perfil, ocupação das próximas aulas, assiduidade
GET /api/v1/activity/tutor/history                    # TUTOR: aulas dadas com contagens (sem identificar alunos)
GET /api/v1/activity/admin/metrics?days=30            # ADMIN+MFA: agregados da plataforma (sem dados pessoais)
```

Privacidade: o Encarregado só vê **os seus** dependentes e **só com consentimento activo** (RN-02, sem ele nem o
Encarregado acede aos dados; revogar tem efeito imediato); cada consulta aos dados de um menor fica no `AuditLog`
(`DEPENDENT_SUMMARY_VIEWED` / `DEPENDENT_HISTORY_VIEWED`); o tutor vê contagens, nunca identidades; as métricas de admin
são agregados. Definições: *taxa de presença* = presenças ÷ (presenças + faltas) sobre as aulas já marcadas (`null` se
ainda não há marcações); *por marcar* = aulas que já decorreram e o tutor ainda não registou; *horas disponíveis* inclui
os pacotes do Encarregado, que são os que o dependente usa.

### MFA e administração (`auth` + `admin`)

O MFA (TOTP, compatível com Google Authenticator, Microsoft Authenticator, Authy, 1Password…) é **obrigatório para
`ADMIN`** (RNF-SEG-06, RN-08). Um admin sem MFA consegue entrar, mas só para o configurar: todas as rotas de
administração exigem uma sessão estabelecida com segundo factor.

```
POST /api/v1/auth/login                 # sem MFA → tokens; com MFA → { mfaRequired, challenge } (sem sessão)
POST /api/v1/auth/mfa/verify            # { challenge, code } → tokens (código TOTP ou de recuperação)
POST /api/v1/auth/mfa/setup             # ADMIN: gera o segredo → { secret, otpauthUrl } (QR no cliente)
POST /api/v1/auth/mfa/enable            # ADMIN: { code } → { recoveryCodes[8] } (mostrados uma só vez); revoga sessões
POST /api/v1/auth/mfa/step-up           # ADMIN com MFA: { code } → novo accessToken com MFA recém-verificado
GET   /api/v1/admin/users               # ADMIN+MFA: lista utilizadores (?search&role&page&limit)
GET   /api/v1/admin/role-changes        # ADMIN+MFA: pedidos de alteração de papel (?status)
POST  /api/v1/admin/role-changes        # ADMIN+MFA recente: { userId, role } → pedido PENDING
POST  /api/v1/admin/role-changes/:id/approve | /reject   # outro ADMIN, MFA recente
```

| Protecção | Como |
|---|---|
| Segredo TOTP | Cifrado em repouso (AES-256-GCM, ligado ao utilizador); chave em `MFA_ENCRYPTION_KEY` (serviço de segredos em produção) |
| Códigos de recuperação | 8 códigos de 80 bits, uso único, guardados só como HMAC (uma BD roubada não permite testá-los) |
| Força bruta | 5 erros bloqueiam o utilizador 15 min (429), mesmo com o código certo; auditado |
| Reutilização | Cada código TOTP só vale uma vez (`mfa:used`), incluindo o usado ao configurar |
| Desafio de login | JWT de 5 min com chave própria; nunca é aceite como access token (nem o contrário) |
| Sessões | Levam o instante do MFA; o refresh preserva-o. Acções sensíveis exigem MFA com menos de 10 min (`MFA_STEP_UP_REQUIRED` → `POST /mfa/step-up`) |
| Revogação | Cada utilizador tem uma "época de sessão": activar o MFA ou mudar de papel invalida logo os tokens anteriores |
| **Segregação de funções** | Alterar um papel é um pedido que **outro** administrador aprova (válido 24 h). Imposto no código **e** por `CHECK` na BD |
| Integridade | Não se altera o próprio papel, nem o do último admin, nem de encarregados com dependentes ou dependentes |

Se um administrador perder o autenticador **e** os códigos de recuperação: um operador com acesso à BD corre
`pnpm --filter educa-api mfa:reset <email>` (desactiva o MFA, revoga sessões, fica auditado). Não existe endpoint
para isto de propósito. Desenvolvimento local: precisa de `MFA_ENCRYPTION_KEY` no `apps/api/.env`
(`openssl rand -hex 32`); o primeiro admin (`db:seed`) tem de configurar o MFA no primeiro login.

> **Em aberto:** com um único administrador não há quem aprove alterações de papel (por desenho: crie dois);
> reembolsos iniciados pelo admin ainda não existem (dependem do gateway) mas devem seguir este mesmo fluxo de
> pedido + aprovação; o MFA está disponível só para `ADMIN` (alargar a outros perfis é uma decisão de produto).

### Gestão da conta (RF-AUT-04)

```
PATCH /api/v1/auth/me                               # qualquer perfil: { name?, email?, currentPassword? }
POST  /api/v1/auth/password                         # qualquer perfil: { currentPassword, newPassword } → sessão nova
POST  /api/v1/guardians/dependents/:id/password     # GUARDIAN: repõe a password de um dependente seu
PATCH /api/v1/tutors/profile                        # TUTOR: { bio?, subjects? } (bio: null apaga)
```

O nome altera-se livremente. **Email e password exigem a password actual**, têm bloqueio após 5 erros (429, também
auditado) e revogam **todas as outras sessões**: o dispositivo actual recebe tokens novos (com o MFA da sessão, se o
houver), os restantes caem. Um administrador precisa de MFA recente para estas operações. O papel e a data de
nascimento nunca se alteram por aqui, e o tutor edita só o perfil público (a verificação documental não se mexe, RN-05).
O Encarregado repõe a password do dependente (propriedade verificada, sessões do dependente revogadas, auditado); o
dependente troca a sua própria password mesmo sem consentimento, porque é segurança da conta.

> **Fora do âmbito (precisa de um canal de email/SMS, ponto em aberto no levantamento):** "esqueci a password" para
> adultos e verificação do novo email. Hoje a recuperação de um adulto é manual (operador).

### Perfis e segregação

| Perfil | Como se cria | Pode |
|---|---|---|
| `STUDENT` | Registo próprio (só maiores de 18, `birthDate` obrigatória) ou criado pelo Encarregado | Autenticar-se, `/me` |
| `GUARDIAN` | Registo próprio | Criar e listar os seus dependentes |
| `TUTOR` | Registo próprio | Gerir o próprio perfil e documentos |
| `ADMIN` | Apenas seed (`db:seed`) ou aprovação de outro admin; nunca auto-registável | Administração, **sempre com MFA** (ver abaixo) |

Menores nunca se registam sozinhos (RN-02): o Encarregado cria a conta do dependente.
A ligação aluno–encarregado só é criada por esse fluxo, nunca declarada pelo aluno.

```
POST /api/v1/guardians/dependents    # GUARDIAN: criar dependente (name, email, password, birthDate)
GET  /api/v1/guardians/dependents    # GUARDIAN: listar os seus dependentes (com consentGranted)

GET    /api/v1/guardians/dependents/:studentId/consent   # GUARDIAN: histórico de consentimentos
POST   /api/v1/guardians/dependents/:studentId/consent   # GUARDIAN: conceder (409 se já activo)
DELETE /api/v1/guardians/dependents/:studentId/consent   # GUARDIAN: revogar (regista revokedAt)
GET    /api/v1/guardians/consent/me                      # STUDENT: { required, granted }
```

**Consentimento (RF-ENC-01/02, RN-02):** todo aluno com Encarregado precisa de consentimento activo para que os
seus dados sejam tratados. Rotas que tratem dados de alunos devem usar `preHandler: [authenticate, requireConsent]`
(`guardians.middleware.ts`): a verificação vai à BD em cada pedido, por isso a revogação tem efeito imediato.
Concessões e revogações ficam no `AuditLog`; o histórico em `GuardianConsent` nunca é apagado.

Testes de segregação: `pnpm --filter educa-api test` (matriz perfil × rota, tokens inválidos, escalada no registo).

### Aulas e agendamento (`bookings`)

```
GET    /api/v1/bookings/sessions                 # catálogo: aulas futuras (?subject&tutorId&type&from&to&page&limit)
GET    /api/v1/bookings/sessions/:id             # detalhe, com spotsLeft
POST   /api/v1/bookings/sessions                 # TUTOR aprovado: publicar aula (ONE_ON_ONE=1 vaga; GROUP 2..7)
GET    /api/v1/bookings/sessions/mine            # TUTOR: as suas aulas com inscritos
DELETE /api/v1/bookings/sessions/:id             # TUTOR: só se ainda sem alunos
PATCH  /api/v1/bookings/sessions/:id/enrollments/:enrollmentId   # TUTOR: presença (PRESENT/ABSENT) após o início
POST   /api/v1/bookings/sessions/:id/enroll      # STUDENT (+consentimento): agendar; debita horas
DELETE /api/v1/bookings/sessions/:id/enroll      # STUDENT: cancelar; estorna horas
GET    /api/v1/bookings/enrollments/mine         # STUDENT: as suas matrículas
```

Regras: máximo de 7 alunos por aula (RN-01) imposto por bloqueio da aula na matrícula **e** por `CHECK` na BD;
matrícula exige pacote de horas válido (RN-04, `402` se não houver), debitado na mesma transacção; o aluno
dependente usa o pacote do seu Encarregado.

> **Pressupostos a validar com o cliente** (levantamento, secção 11): modelo "o tutor publica aulas e o aluno
> inscreve-se" (em vez de pedido + aceitação); cancelamento gratuito até 24 h antes
> (`CANCELLATION_WINDOW_HOURS`); estorno integral das horas; sem reagendamento.

### Pagamentos por referência (`payments`)

```
GET   /api/v1/payments/offers                 # pacotes de horas activos (público)
GET   /api/v1/payments/offers/all             # ADMIN: todos
POST  /api/v1/payments/offers                 # ADMIN: criar pacote (name, hours, price, validityDays?)
PATCH /api/v1/payments/offers/:id             # ADMIN: { active }
POST  /api/v1/payments/references             # STUDENT/GUARDIAN: { offerId } → referência a pagar (header Idempotency-Key opcional)
GET   /api/v1/payments/mine                   # os meus pagamentos
GET   /api/v1/payments/packages/mine          # saldo de horas (o dependente vê também os do Encarregado)
POST  /api/v1/payments/webhooks/:gateway      # aviso do gateway, autenticado pela assinatura (sem JWT)
```

**Fluxo:** o cliente pede uma referência → paga-a (ATM / banco / app) → o gateway chama o webhook → o pagamento fica
`CONFIRMED` e o pacote de horas é libertado (RN-03). O webhook é verificado sobre o corpo cru (HMAC), é idempotente por
`eventId` e transaccional: um pagamento origina no máximo um pacote (RN-07), mesmo com entregas simultâneas. O valor
tem de coincidir com o da referência. `REFUNDED` anula as horas ainda por usar.

**Gateway ainda não decidido** (Proxypay, PayPay ou Kwanza Online): o módulo fala com a interface
`PaymentGateway` (`payments/gateways/gateway.ts`); cada fornecedor é um adaptador registado em
`gateways/index.ts`. Em desenvolvimento usa-se o `sandbox` (`PAYMENT_GATEWAY=sandbox`, proibido em produção):

```bash
pnpm --filter educa-api payments:simulate <referência> [PAID|FAILED|REFUNDED]   # simula o aviso do gateway
```

> **Pressupostos / em aberto** (levantamento, secção 11): preços e validade dos pacotes (geridos pelo Administrador,
> sem valores no código); moeda AOA; referência válida 72 h (`PAYMENT_REFERENCE_TTL_HOURS`); um pagamento recebido
> depois de a referência expirar é aceite (o dinheiro foi recebido); reembolsos só chegam pelo gateway (a iniciação
> pelo Admin exige MFA, ainda por implementar).

### Avaliações e reputação (`reputation`)

```
GET  /api/v1/reputation/tutors/:tutorId/reviews        # público e anónimo: resumo por critério + lista
GET  /api/v1/reputation/reviews/pending                # STUDENT: aulas a que assistiu e ainda não avaliou
POST /api/v1/reputation/sessions/:sessionId/review     # STUDENT: avaliar a aula (rating, punctuality, subjectMastery, didacticClarity, progress: 1..5; comment?)
```

Regras: só avalia quem esteve **presente** (confirmado pelo tutor) numa aula **já terminada**; uma avaliação por aula;
notas inteiras de 1 a 5 (RN-06, também imposto por `CHECK` na BD). As avaliações são públicas mas **anónimas** (há
menores). O perfil do tutor mostra média, total de avaliações, aulas dadas e alunos (RF-TUT-03): a média e o total
actualizam-se na mesma transacção da avaliação (com bloqueio do perfil, para que avaliações simultâneas não se percam);
aulas e alunos recalculam-se quando o tutor marca presenças, via evento interno `attendance.changed`.

> Pressupostos: avaliações imutáveis (sem edição nem moderação por agora); a nota geral é indicada pelo aluno e a média
> do tutor usa-a (os critérios têm médias próprias no resumo).

### Tutores

```
GET   /api/v1/tutors                          # catálogo público (aprovados)
GET   /api/v1/tutors/:id                      # perfil público
POST  /api/v1/tutors/profile                  # TUTOR: criar perfil
GET   /api/v1/tutors/profile/me               # TUTOR: o próprio perfil (com motivo de rejeição)
POST  /api/v1/tutors/profile/documents/upload-url   # TUTOR: pedir URL de upload (POST policy)
PATCH /api/v1/tutors/profile/documents        # TUTOR: associar documentos já enviados (chaves)
GET   /api/v1/tutors/admin/pending            # ADMIN: fila de revisão (com URLs assinadas)
PATCH /api/v1/tutors/:id/status               # ADMIN: aprovar / rejeitar (motivo obrigatório)
```

Fluxo de documentos: o cliente pede `upload-url` (tipo + Content-Type), envia o ficheiro directamente
para o storage com o formulário devolvido e depois chama `PATCH /profile/documents` com a `key`.
O bucket é privado; a API só devolve URLs assinadas de 5 minutos e nunca as chaves internas.

Primeiro administrador: `ADMIN_EMAIL=… ADMIN_PASSWORD=… pnpm --filter educa-api db:seed`.

## Estrutura do projecto

Monorepo pnpm:

```
apps/
├── api/          # back-end (Fastify + Prisma) — descrito abaixo
├── web/          # back-office SvelteKit (ADMIN, TUTOR, STUDENT, GUARDIAN) — ver apps/web/README.md
└── mobile/       # app Flutter Alunos/Tutores (a criar)
packages/         # código partilhado (tipos gerados do contrato OpenAPI)
docker/           # PgBouncer
docker-compose.yml
```

Estrutura de `apps/api/`:

```
src/
├── app.ts                    # instância Fastify (plugins, rotas, error handler)
├── server.ts                 # arranque e graceful shutdown
├── shared/
│   └── core/
│       ├── database.ts       # cliente Prisma singleton
│       ├── redis.ts          # cliente Redis singleton
│       ├── errors.ts         # hierarquia de erros da aplicação
│       └── audit.ts          # AuditLog append-only com cadeia SHA-256
└── modules/
    └── auth/
        ├── auth.service.ts   # lógica de negócio (registo, login, rotação de tokens)
        ├── auth.controller.ts
        ├── auth.middleware.ts # preHandlers authenticate / authorize
        ├── auth.routes.ts    # plugin Fastify
        └── auth.types.ts     # schemas Zod e tipos JWT
```

## Arquitectura de módulos

Cada módulo (`apps/api/src/modules/<nome>/`) expõe apenas o seu `<nome>.service.ts` e, se necessário, o
`<nome>.middleware.ts`. Controllers, rotas e tipos são internos. Acesso directo a código interno de outro módulo é
proibido e **falha o lint** (RNF-MAN-01):

| Regra | Onde |
|---|---|
| Módulo → outro módulo só via `*.service` / `*.middleware` | `apps/api/eslint.config.mjs` (módulos novos entram automaticamente) |
| `shared/` nunca importa de `modules/` | idem |
| Controllers, rotas e middlewares não acedem à BD (`shared/core/database`) | idem |

Primitivas partilhadas (validação, erros, storage, audit, eventos) ficam em `src/shared/core/`. Quando um módulo só
precisa de *avisar* outro, usa o bus de eventos interno (`shared/core/events.ts`) em vez de o importar: foi assim que se
evitou o ciclo `bookings` ↔ `reputation` (`attendance.changed`). O grafo de dependências é acíclico:
`reputation → bookings → payments → guardians`, `bookings → tutors`, `reputation → tutors`. O bus mantém a
interface quando passar a BullMQ.

## Contrato OpenAPI

O contrato da API é **gerado do código**, não escrito à mão: nasce das rotas reais (`@fastify/swagger`) e dos mesmos
schemas Zod que validam os pedidos, por isso não há uma lista paralela que se possa desactualizar.

| O quê | Onde |
|---|---|
| Contrato versionado (OpenAPI 3.0.3, 62 operações, 13 componentes) | [`apps/api/openapi.json`](apps/api/openapi.json) |
| Tipos TypeScript para o SvelteKit | `@educa/api-types` ([`packages/api-types`](packages/api-types)) |
| O mesmo contrato, em execução (fora de produção) | `GET /openapi.json` |
| Contrato de cada módulo | `apps/api/src/modules/<módulo>/<módulo>.docs.ts` |

```bash
pnpm contract:build     # regenera openapi.json e os tipos TypeScript (fazer commit do resultado)
pnpm contract:check     # falha se o contrato versionado estiver desactualizado (corre no CI)
```

Para o **Flutter**: gerar o cliente Dart a partir de `openapi.json` (ex.: `openapi-generator -g dart-dio`). Os componentes
têm nome (`User`, `Payment`, `TutorProfile`…) e as operações têm `operationId` estável, por isso os métodos gerados são
legíveis. Também se importa no Postman/Insomnia.

Como se mantém **verdadeiro**:

| Garantia | Como |
|---|---|
| Completo | Teste falha se existir uma rota sem contrato (e vice-versa) |
| Válido | Validado com o `swagger-parser` (todos os `$ref` resolvem) |
| Consistente | Toda a rota autenticada documenta `401`; as restritas a perfis documentam `403`; as com corpo ou query documentam `422` |
| Verdadeiro | Nos testes, **cada resposta real é validada contra o schema documentado** (`validateResponses`), nos 133 testes de integração: um estado HTTP não documentado ou um campo a mais falha o teste |
| Seguro | Os schemas de resposta são **estritos**: devolver um campo não previsto (ex.: um hash) falha. Teste extra garante que nenhuma resposta documenta campos internos |
| Alinhado com a segurança | Os perfis (`x-roles`) e o MFA (`x-mfa`) documentados têm de coincidir com a matriz do teste de segregação de perfis |

Como escrever uma rota nova: declarar o contrato em `<módulo>.docs.ts` com `docs({ tags, operationId, summary, roles,
body, querystring, params, response })` e passá-lo à rota (`schema: …`); correr `pnpm contract:build`. Erros comuns
declaram-se com `errorResponses(401, 403, …)`. Os formatos de resposta são estritos e usam `obj()` / `decimal` /
`isoDate` de `shared/core/openapi.ts` (decimais viajam como string, datas como ISO).

## Contribuir

As regras do repositório estão em [`CONTRIBUTING.md`](CONTRIBUTING.md) (fluxo de branches e Pull Requests, Conventional
Commits em português, o que a revisão procura, configuração da `main` protegida) e as regras técnicas para o assistente em
[`CLAUDE.md`](CLAUDE.md). A maioria é verificada por hooks de git (instalados com `pnpm install`) e repetida no CI.

## Qualidade e CI

```bash
pnpm lint        # ESLint + fronteiras de módulo
pnpm typecheck   # tsc --noEmit
pnpm test        # unitários: segregação de perfis (sem infra)
pnpm test:int    # integração: precisa de docker compose up -d --wait + migrações
pnpm test:repo   # regras do repositório: hooks, commitlint, ficheiros proibidos
```

O workflow `.github/workflows/ci.yml` corre em cada push para `main` e em cada PR:

1. **quality** — lint, tipos, **contrato OpenAPI actualizado**, build, testes unitários (incl. contrato), validação do compose e `pnpm audit` (falha em severidade alta).
2. **integration** — sobe o mesmo `docker-compose.yml` (Postgres, PgBouncer, Redis, MinIO + bucket), aplica as
   migrações e corre os testes de integração com a aplicação a ligar-se pelo PgBouncer.

## Segurança

- Refresh tokens com rotação de família e revogação imediata em caso de reutilização
- Rate limiting distribuído por Redis (global: 200 req/min; endpoints críticos: 10 req/15 min)
- Cookies `httpOnly; Secure; SameSite=Strict`
- AuditLog com encadeamento de hash (hashPrev / hashSelf) — append-only
- MFA obrigatório para `ADMIN` e acções sensíveis

## Como rodar

### Projecto completo (API + Web)

```bash
# 1. Infra
docker compose up -d --wait

# 2. Migrações (só na primeira vez ou após novas migrações)
pnpm --filter educa-api db:migrate:deploy

# 3. Ambos os servidores em paralelo
pnpm dev
```

API disponível em `http://localhost:3000` · Web em `http://localhost:5173`.

### Só a API

```bash
docker compose up -d --wait
pnpm --filter educa-api db:migrate:deploy   # se necessário
pnpm dev:api
```

### Só a Web (requer a API já em execução)

```bash
pnpm --filter educa-web dev
```

### Testes

```bash
pnpm lint                    # ESLint em todos os packages
pnpm typecheck               # TypeScript em todos os packages
pnpm test                    # testes unitários (sem infra)
pnpm test:int                # testes de integração (precisa da infra em execução)
pnpm test:repo               # regras do repositório (hooks, commitlint)

# Por app
pnpm --filter educa-api test
pnpm --filter educa-api test:int
pnpm --filter educa-web typecheck
```

### Base de dados

```bash
pnpm --filter educa-api db:migrate:deploy        # aplicar migrações pendentes
pnpm --filter educa-api exec prisma migrate dev --name nome  # nova migração
pnpm --filter educa-api db:generate              # regenerar cliente Prisma
pnpm --filter educa-api db:seed                  # criar primeiro admin
pnpm --filter educa-api db:studio                # UI da base de dados (Prisma Studio)
```

### Contrato OpenAPI

```bash
pnpm contract:build    # regenerar openapi.json e tipos TypeScript — fazer commit do resultado
pnpm contract:check    # falha se o contrato estiver desactualizado (corre no CI)
```

### Infra

```bash
docker compose up -d        # iniciar
docker compose down         # parar
docker compose logs -f      # logs em tempo real
```

## Créditos

| Papel | Entidade |
|---|---|
| Cliente / Proprietário | Helder Teixeira Congo |
| Desenvolvedor | SOMATEC — Software Marketing Tecnologia (NIF: 5001795830) |

© 2026 Helder Teixeira Congo. Todos os direitos reservados.
