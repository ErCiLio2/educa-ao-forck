# Como contribuir para a Educa

Estas regras valem para toda a gente (pessoas e assistentes). A maioria é **verificada automaticamente**, localmente
(hooks de git) e no CI; o que não consegue ser automático está na secção de revisão.

## Referência rápida

```
# Fluxo obrigatório
feat/minha-tarefa  ──PR──▶  web | api | mobile  ──PR──▶  dev  ──PR──▶  main

# Commit
fix(auth): corrigir expiração do refresh token
^          ^                                  ^
tipo       descrição no imperativo            sem ponto final, ≤ 100 chars

# Tipos: feat fix refactor perf test docs build ci chore revert
# Âmbitos: auth tutors guardians bookings payments reputation admin activity
#           api web mobile types db ci docs deps contract repo docker security

# Nunca
git push --force     # em qualquer branch protegida
git commit --no-verify
Co-Authored-By: Claude ...   # ou qualquer assinatura de IA
```

| Situação | Fazer |
|---|---|
| Trabalho novo em `apps/web/` | branch de `web` → PR para `web` |
| Trabalho novo em `apps/api/` | branch de `api` → PR para `api` |
| Docs / CI / deps transversais | branch de `dev` → PR para `dev` |
| Release para produção | PR de `dev` para `main` (requer aprovação de @ErCiLio2) |

## Primeiros passos

```bash
corepack enable && pnpm install        # instala as dependências e activa os hooks de git
cp apps/api/.env.example apps/api/.env # e preencher os segredos (openssl rand -hex 32)
docker compose up -d --wait            # Postgres, PgBouncer, Redis, MinIO
pnpm --filter educa-api db:migrate:deploy && pnpm dev:api
```

Requisitos: Node ≥ 22, pnpm ≥ 11, Docker. Para a arquitectura e as regras de código, ler o `README.md` e o `CLAUDE.md`
(escrito para o assistente, mas serve a qualquer pessoa como resumo das regras técnicas).

## Branches pessoais

Cada developer tem uma branch pessoal que funciona como área de integração privada antes de abrir PR para o projecto.

| Branch | Dono | GitHub |
|---|---|---|
| `ercilio` | Ercilio Julio | @ErCiLio2 |
| `josias`  | Josias        | @Josias-tech189 |
| `yoane`   | Yoane         | @YDNeves |

**Regras:**

- Só o dono faz `git push` directamente para a sua branch pessoal. O hook `pre-push` verifica a identidade GitHub e bloqueia push cruzado.
- Qualquer developer pode criar branches provisórias (`feat/…`, `fix/…`) e abrir um **PR para a branch pessoal do colega** — o dono revê e faz merge.
- Para o trabalho entrar na base de código principal, o dono abre um PR da branch pessoal para a branch de integração, sujeito às regras abaixo — **verificadas pelo CI**:
  - `josias` e `yoane` só podem abrir PR para **`web`**.
  - `api`, `mobile`, `dev` e `main` são exclusivas de **@ErCiLio2**: qualquer PR aberto por outro autor é recusado.
  - `api`, `web` e `mobile` só podem mergiar para **`dev`** — nunca directamente para `main`.
  - **Se o CI passar, o PR pode ser integrado** — não é necessária revisão manual, excepto `dev → main`.
  - `dev → main` requer **aprovação explícita de @ErCiLio2** (verificado pelo CI via API do GitHub) e CI verde.
- Upgrar para GitHub Pro (ou tornar o repositório público) activa branch protection rules no GitHub que reforçam estas regras no servidor, além do hook local.

```
branch-provisória  →  ercilio | josias | yoane  →  api | web | mobile  →  dev  ──(aprovação ErCiLio2)──→  main
```

## Fluxo de trabalho

O repositório segue um modelo de **quatro níveis de branches protegidas**:

```
branch-particular  →  api | web | mobile  →  dev  →  main
```

| Branch | Propósito | O que chega aqui |
|---|---|---|
| `main` | Código estável e deployável | PRs vindos de `dev` (squash merge) |
| `dev` | Integração de todas as aplicações | PRs vindos de `api`, `web` ou `mobile` |
| `api` | Integração do monólito Fastify | PRs de branches `feat/…`, `fix/…`, etc. que tocam em `apps/api/` |
| `web` | Integração do back-office SvelteKit | PRs de branches que tocam em `apps/web/` |
| `mobile` | Integração da app Flutter | PRs de branches que tocam em `apps/mobile/` |

**Passo a passo:**

1. Verificar qual a branch-alvo: trabalho em `apps/api/` → `api`; em `apps/web/` → `web`; em `apps/mobile/` → `mobile`; transversal (docs, ci, repo, deps) → `dev` directamente.
2. Criar a branch a partir da branch-alvo (não de `main`): `git switch api && git switch -c feat/bookings-limite-grupo`.
3. Commits pequenos e coerentes (ver abaixo). Uma branch deve durar dias, não semanas.
4. Abrir o PR **para a branch-alvo correcta** com o modelo preenchido. O título segue o mesmo formato dos commits.
5. CI verde + pelo menos **1 aprovação**. A do responsável da área é obrigatória em áreas sensíveis (`.github/CODEOWNERS`).
6. **Merge por squash** em `api`, `web` e `mobile`. **Merge commit** de `api`/`web`/`mobile` → `dev`. **Squash** de `dev` → `main`.
7. Apagar a branch de trabalho depois do merge.

Nunca fazer *force-push* para `main`, `dev`, `api`, `web` ou `mobile`, nem reescrever histórico que já foi partilhado.

## Commits: Conventional Commits em português

```
tipo(âmbito): resumo no imperativo, sem ponto final     (até 100 caracteres)

Corpo opcional em português: o PORQUÊ da alteração e o que mais importa a quem lê,
não uma lista de ficheiros. Linhas de corpo até 120 caracteres.
```

| Tipo | Quando |
|---|---|
| `feat` | funcionalidade nova (requisito do levantamento) |
| `fix` | correcção de um defeito |
| `refactor` | muda a estrutura sem mudar o comportamento |
| `perf` | melhora desempenho |
| `test` | só testes |
| `docs` | só documentação |
| `build` / `ci` | dependências e build / pipelines |
| `chore` | tarefas de manutenção sem efeito no produto |
| `revert` | reverte um commit anterior |

**Âmbitos permitidos:** módulos da API (`auth`, `tutors`, `guardians`, `bookings`, `payments`, `reputation`, `admin`,
`activity`), aplicações e pacotes (`api`, `web`, `mobile`, `types`) e transversais (`db`, `ci`, `docs`, `deps`,
`contract`, `repo`, `docker`, `security`). Vários âmbitos separam-se por vírgula: `fix(bookings,payments): …`.
O âmbito é opcional, mas se existir tem de estar na lista (`commitlint.config.mjs`).

**Sem assinaturas de assistentes de IA** em commits, PRs ou trailers (`Co-Authored-By: …`, "Generated with …", 🤖).
O commitlint recusa-as. Co-autores humanos são bem-vindos.

Exemplos bons: `feat(payments): confirmar pagamentos por webhook com assinatura` ·
`fix(auth): rotação atómica do refresh token` · `docs: descrever o fluxo de consentimento`.

## O que é verificado automaticamente

| Onde | O quê |
|---|---|
| `pre-commit` | ficheiros proibidos (`.env`, chaves, PDFs/Word, `.vscode/`, `dist/`…), segredos com formato inconfundível, ficheiros > 1 MB, `schema.prisma` alterado sem migração, ESLint (inclui fronteiras de módulo) nos `.ts` da API, contrato OpenAPI actualizado |
| `commit-msg` | Conventional Commits em português e ausência de assinaturas de IA |
| `pre-push` | recusa push para a `main`; corre `typecheck` e testes unitários |
| CI `repo-rules` | repete os testes das regras, verifica todos os ficheiros versionados e as mensagens dos commits e o título do PR |
| CI `quality` | lint, tipos, **contrato OpenAPI actualizado**, build, testes unitários, `pnpm audit` |
| CI `integration` | testes de integração contra Postgres + PgBouncer + Redis + MinIO reais |

Os hooks são uma comodidade, não a defesa: o CI repete tudo. **Não usar `--no-verify`**; se um hook estiver errado,
corrige-se o hook num PR.

## Testes: o que é obrigatório

- Regra de negócio ou de segurança nova → teste de **integração** (BD real; não se mockam a BD nem o Redis).
- Comportamento sem infra (schemas, guards, funções puras) → teste **unitário**.
- Concorrência ou segurança → validar por **mutação**: tirar a protecção, ver o teste falhar, repô-la. Os testes de
  concorrência precisam de `connection_limit` maior que 1 no `DATABASE_URL`, senão não provam nada.
- Rotas novas → contrato em `<módulo>.docs.ts` (as respostas reais são validadas contra ele nos testes) e entrada em
  `apps/api/test/protected-routes.ts` se forem autenticadas.
- Correr `pnpm lint && pnpm typecheck && pnpm test` antes de abrir o PR; `pnpm test:int` quando mexer em lógica de dados.

## Base de dados

Migrações **aditivas e reversíveis** (para *rolling deploy*): primeiro acrescentar, migrar os dados, só depois remover
numa migração seguinte. Mudar o schema sem migração é bloqueado. Dinheiro e horas são `Decimal`.
Regras que têm de valer mesmo contra um bug no código (capacidades, segregação de funções, saldos) levam também um
`CHECK` na migração.

## Segurança

- Nunca commitar segredos, `.env`, chaves, PDFs do cliente ou dados pessoais reais (nem em testes ou *fixtures*).
- Nunca registar (logs, auditoria, mensagens de erro) passwords, tokens, segredos TOTP ou corpos de pedidos.
- Dados de menores só com consentimento activo; cada acesso do Encarregado a dados de um dependente é auditado.
- Rotas de administração exigem MFA; alterações de papéis exigem um segundo administrador.
- Encontrou uma vulnerabilidade? **Não abra uma issue pública**: fale directamente com os responsáveis do projecto.

## Revisão de código: o que procurar

O CI garante estilo e testes; quem revê garante o que as máquinas não vêem:

1. **Resolve o requisito certo?** Ligar ao `RF-/RN-/RNF-` do levantamento. Há pressupostos novos? Estão escritos?
2. **Autorização**: perfil *e* propriedade do recurso. Um tutor ou Encarregado consegue chegar a dados de outro?
3. **Concorrência**: dois pedidos simultâneos podem violar uma regra (vagas, saldo, pagamento duplicado)? Há `FOR UPDATE`
   e um teste que o prove?
4. **Privacidade**: a resposta devolve só o necessário? Há dados de menores ou documentos expostos?
5. **Migração**: é segura de aplicar com a versão anterior ainda a correr?
6. **Contrato**: mudou de forma compatível com a web e o mobile? Se não, está comunicado?
7. **Simplicidade**: dá para apagar código em vez de acrescentar? Segue os padrões existentes?

Comentários de revisão são sobre o código, nunca sobre a pessoa. Quem revê aprova quando **confiaria em pôr isto em
produção**, não quando é "perfeito".

## Configuração do GitHub (quem administra o repositório)

Os ficheiros do repositório (`CODEOWNERS`, modelo de PR, CI) só têm força se as branches protegidas estiverem
configuradas. Aplicar as regras abaixo a **`main`, `dev`, `api`, `web` e `mobile`**.

Regras comuns a todas as branches protegidas (*Settings → Branches → Branch protection rules*):

- ✅ Require a pull request before merging — **1 aprovação**, *dismiss stale approvals*, *require review from Code Owners*
- ✅ Require status checks to pass — **`Regras do repositório`**, **`Lint, tipos, build e testes unitários`** e
  **`Testes de integração (Postgres, PgBouncer, Redis, MinIO)`** — e *branches up to date*
- ✅ Require conversation resolution before merging
- ✅ Do not allow bypassing the above settings (inclui administradores) · ❌ Allow force pushes · ❌ Allow deletions

Regras adicionais só para `main`:

- ✅ Require linear history
- Em *Settings → General → Pull Requests*: permitir **apenas Squash merge** (com "Default to pull request title"),
  e *Automatically delete head branches*.

Criar a equipa `educa-maintainers` na organização (ou ajustar o `CODEOWNERS` para utilizadores concretos).

Equivalente por linha de comandos (executar só quem for administrador do repositório):

```bash
REPO="SOMATEC-AO/educa"
STATUS_CHECKS='{ "strict": true, "contexts": [
  "Regras do repositório",
  "Lint, tipos, build e testes unitários",
  "Testes de integração (Postgres, PgBouncer, Redis, MinIO)" ] }'
REVIEWS='{ "required_approving_review_count": 1, "dismiss_stale_reviews": true, "require_code_owner_reviews": true }'

# main (linear history obrigatório)
gh api -X PUT repos/$REPO/branches/main/protection --input - <<JSON
{ "required_status_checks": $STATUS_CHECKS, "enforce_admins": true,
  "required_pull_request_reviews": $REVIEWS, "restrictions": null,
  "required_linear_history": true, "allow_force_pushes": false,
  "allow_deletions": false, "required_conversation_resolution": true }
JSON

# dev, api, web, mobile (sem obrigação de histórico linear — recebem merge commits)
for BRANCH in dev api web mobile; do
  gh api -X PUT repos/$REPO/branches/$BRANCH/protection --input - <<JSON
{ "required_status_checks": $STATUS_CHECKS, "enforce_admins": true,
  "required_pull_request_reviews": $REVIEWS, "restrictions": null,
  "required_linear_history": false, "allow_force_pushes": false,
  "allow_deletions": false, "required_conversation_resolution": true }
JSON
done
```
