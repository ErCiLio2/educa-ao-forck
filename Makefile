# eDuca — Makefile de desenvolvimento
# Uso: make <target>   Exemplo: make setup

# Portos alternativos (para evitar conflitos com outras stacks locais)
POSTGRES_HOST_PORT  ?= 5432
PGBOUNCER_HOST_PORT ?= 6432
REDIS_HOST_PORT     ?= 6380
MINIO_HOST_PORT     ?= 9100

# Nome do projecto Docker (permite correr em paralelo com outras stacks)
DOCKER_PROJECT ?= educa-dev

COMPOSE = docker compose -p $(DOCKER_PROJECT) \
	-f docker-compose.yml \
	$(if $(COMPOSE_OVERRIDE),-f $(COMPOSE_OVERRIDE),)

COMPOSE_ENV = POSTGRES_HOST_PORT=$(POSTGRES_HOST_PORT) \
	PGBOUNCER_HOST_PORT=$(PGBOUNCER_HOST_PORT) \
	REDIS_HOST_PORT=$(REDIS_HOST_PORT) \
	MINIO_HOST_PORT=$(MINIO_HOST_PORT)

.DEFAULT_GOAL := help

# ── Ajuda ─────────────────────────────────────────────────────────────────────

.PHONY: help
help:
	@printf '\neDuca — comandos disponíveis\n\n'
	@printf '  \033[1mConfigurações\033[0m\n'
	@printf '    make setup          Instalação completa (install + infra + migrate + seed)\n'
	@printf '    make install        pnpm install\n'
	@printf '\n'
	@printf '  \033[1mInfra (Docker)\033[0m\n'
	@printf '    make infra          Sobe Postgres, PgBouncer, Redis, MinIO\n'
	@printf '    make infra-build    Sobe e reconstrói imagens\n'
	@printf '    make infra-down     Para e remove os contentores\n'
	@printf '    make infra-logs     Segue os logs dos contentores\n'
	@printf '\n'
	@printf '  \033[1mBase de dados\033[0m\n'
	@printf '    make migrate        prisma migrate dev (cria e aplica migração)\n'
	@printf '    make migrate-deploy prisma migrate deploy (aplica migrações pendentes)\n'
	@printf '    make generate       prisma generate (actualiza o client Prisma)\n'
	@printf '    make seed           Popula a BD com dados de demonstração\n'
	@printf '    make studio         Prisma Studio no browser\n'
	@printf '\n'
	@printf '  \033[1mDesenvolvimento\033[0m\n'
	@printf '    make dev            API (porta 3000)\n'
	@printf '    make dev-web        SvelteKit back-office (porta 5173)\n'
	@printf '\n'
	@printf '  \033[1mQualidade\033[0m\n'
	@printf '    make lint           ESLint em todos os pacotes\n'
	@printf '    make typecheck      TypeScript em todos os pacotes\n'
	@printf '    make test           Testes unitários\n'
	@printf '    make test-int       Testes de integração (precisa de infra)\n'
	@printf '    make contract       Regenera openapi.json + api-types\n'
	@printf '    make check          lint + typecheck + test + contract\n'
	@printf '\n'
	@printf '  Portos padrão: Postgres=$(POSTGRES_HOST_PORT) PgBouncer=$(PGBOUNCER_HOST_PORT) Redis=$(REDIS_HOST_PORT) MinIO=$(MINIO_HOST_PORT)\n'
	@printf '  Substituir: make infra POSTGRES_HOST_PORT=5433 REDIS_HOST_PORT=6381\n\n'

# ── Instalação ────────────────────────────────────────────────────────────────

.PHONY: install
install:
	pnpm install

# ── Infra ─────────────────────────────────────────────────────────────────────

.PHONY: infra
infra:
	$(COMPOSE_ENV) $(COMPOSE) up -d --wait

.PHONY: infra-build
infra-build:
	$(COMPOSE_ENV) $(COMPOSE) up -d --build --wait

.PHONY: infra-down
infra-down:
	$(COMPOSE_ENV) $(COMPOSE) down

.PHONY: infra-logs
infra-logs:
	$(COMPOSE_ENV) $(COMPOSE) logs -f

# ── Base de dados ─────────────────────────────────────────────────────────────

.PHONY: migrate
migrate:
	pnpm --filter educa-api db:migrate

.PHONY: migrate-deploy
migrate-deploy:
	pnpm --filter educa-api db:migrate:deploy

.PHONY: generate
generate:
	pnpm --filter educa-api db:generate

.PHONY: seed
seed:
	pnpm --filter educa-api db:seed

.PHONY: studio
studio:
	pnpm --filter educa-api db:studio

# ── Desenvolvimento ───────────────────────────────────────────────────────────

.PHONY: dev
dev:
	pnpm --filter educa-api dev

.PHONY: dev-web
dev-web:
	pnpm --filter educa-web dev

# ── Qualidade ─────────────────────────────────────────────────────────────────

.PHONY: lint
lint:
	pnpm lint

.PHONY: typecheck
typecheck:
	pnpm typecheck

.PHONY: test
test:
	pnpm test

.PHONY: test-int
test-int:
	pnpm test:int

.PHONY: contract
contract:
	pnpm contract:build

.PHONY: check
check: lint typecheck test contract

# ── Setup completo (primeira vez) ─────────────────────────────────────────────

.PHONY: setup
setup: install infra-build migrate-deploy generate seed
	@printf '\n\033[32m✓ Ambiente pronto.\033[0m Próximos passos:\n'
	@printf '    make dev        → inicia a API\n'
	@printf '    make dev-web    → inicia o back-office\n\n'
