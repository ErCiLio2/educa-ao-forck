# Educa Web

Back-office SvelteKit da plataforma eDuca — interface de administração e painel de utilizadores (ADMIN, TUTOR, STUDENT, GUARDIAN).

## Stack

| Camada | Tecnologia |
|---|---|
| Framework | SvelteKit 2 + Svelte 5 (runes) |
| Estilos | Tailwind CSS v4 (tokens em `src/lib/theme.css`) |
| Renderização | SSR via `adapter-node` |
| Linguagem | TypeScript strict |
| Ícones | Iconify + Solar icon set |
| Variantes de componentes | `class-variance-authority` (CVA) |
| Sala de aula — vídeo | LiveKit |
| Sala de aula — tempo real | Socket.IO |

## Pré-requisitos

- Node.js >= 22
- pnpm >= 11
- API em execução (ver `apps/api/`)

## Arranque rápido

```bash
# Na raiz do monorepo
cp apps/api/.env.example apps/api/.env   # configurar a API primeiro
docker compose up -d                      # infra (Postgres, Redis, MinIO)
pnpm install

# Variáveis da web
echo "PUBLIC_API_URL=http://localhost:3000" > apps/web/.env

# Servidor de desenvolvimento
pnpm --filter educa-web dev
```

A aplicação fica disponível em `http://localhost:5173`.

## Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `PUBLIC_API_URL` | URL base da API Fastify (ex.: `http://localhost:3000`) |

## Comandos

```bash
pnpm dev                                          # servidor de desenvolvimento (hot-reload)
pnpm build                                        # build de produção
pnpm typecheck                                    # svelte-kit sync + tsc --noEmit
pnpm exec svelte-check --tsconfig ./tsconfig.json # verificação de templates Svelte
pnpm lint                                         # ESLint
```

**Depois de criar novas rotas:** `pnpm exec svelte-kit sync` — sem isto os `$types` não existem e o typecheck falha.

## Arquitectura

### Grupos de rota

| Grupo | URL | Guard | Layout |
|---|---|---|---|
| `(public)` | `/`, `/explorar` | — | Navbar + Footer |
| raiz | `/login`, `/registar`, `/mfa` | — | Split-layout (sem Navbar) |
| `(admin)` | `/dashboard`, `/tutors`, `/users`, `/payments`, `/role-changes`, `/notifications`, `/conteudos`, `/auditoria` | `role === 'ADMIN'` | Sidebar escura |
| `(tutor)` | `/tutor/painel`, `/tutor/sessoes`, `/tutor/documentos`, `/tutor/conteudos`, `/tutor/perfil` | `role === 'TUTOR'` | SidebarTutor |
| `(student)` | `/painel`, `/sessoes`, `/pacotes`, `/perfil` | `role === 'STUDENT'` | SidebarStudent |
| `(guardian)` | `/encarregado/painel`, `/encarregado/consentimento`, `/encarregado/dependentes/[id]`, `/encarregado/pacotes`, `/encarregado/perfil` | `role === 'GUARDIAN'` | SidebarGuardian |
| raiz | `/sala/[id]` | autenticado (qualquer perfil) | — |

A protecção de rotas é feita pelo `+layout.server.ts` de cada grupo via `locals.user.role`. Redirect pós-login: ADMIN → `/dashboard` · TUTOR → `/tutor/painel` · STUDENT → `/painel` · GUARDIAN → `/encarregado/painel`.

### Autenticação

O `hooks.server.ts` corre em todos os pedidos antes de qualquer página:

1. Lê o cookie `access_token` (httpOnly)
2. Valida chamando `GET /api/v1/auth/me`
3. Se expirado, tenta refresh via `POST /api/v1/auth/refresh` e actualiza o cookie
4. Preenche `locals.token` e `locals.user`

`locals.token` é passado explicitamente a `apiFetch` nos `+page.server.ts`. Toda a comunicação com a API acontece no servidor — não há chamadas à API directamente do browser (excepto a sala de aula, que recebe o token via dados do server load para o Socket.IO).

### Cliente de API

`src/lib/api/client.ts` exporta apenas `apiFetch` — uma função para chamadas autenticadas a partir do servidor:

```ts
import { apiFetch, ApiError } from '$lib/api/client';

// Num +page.server.ts:
const data = await apiFetch<MeuTipo>('/api/v1/recurso', {
  token: locals.token,
  serverFetch: fetch,   // usar o fetch injectado pelo SvelteKit
});
```

### Tipos da API

```ts
import type { components } from '@educa/api-types';
type Utilizador = components['schemas']['User'];
```

Os tipos são gerados do contrato OpenAPI em `packages/api-types/`. Nunca definir manualmente tipos que já existam lá.

## Componentes

### Layout

| Componente | Descrição |
|---|---|
| `Logo.svelte` | Logótipo eDuca (variantes de tamanho e esquema de cores) |
| `Navbar.svelte` | Navegação pública com links e acções de autenticação |
| `Sidebar.svelte` | Barra lateral do back-office ADMIN |
| `SidebarTutor.svelte` | Barra lateral da área de tutor |
| `SidebarStudent.svelte` | Barra lateral da área de aluno |
| `SidebarGuardian.svelte` | Barra lateral da área de encarregado |

### UI (`src/lib/components/ui/`)

| Componente | Variantes / notas |
|---|---|
| `Button` | 6 variantes (primary, accent, outline, ghost, destructive, link) × 5 tamanhos |
| `Badge` | Estado de entidades: default, primary, accent, destructive, success, warning, pending, rejected… |
| `Avatar` | Imagem ou iniciais geradas automaticamente por seed de cor |
| `Card` | Container com borda; 4 níveis de padding |
| `Input` | Label, mensagem de erro/dica, slots para ícones leading/trailing |
| `Spinner` | Indicador de carregamento SVG (3 tamanhos) |
| `Table` | Tabela paginada reutilizável |
| `Dialog` | Modal de confirmação para acções destrutivas |
| `EmptyState` | Estado vazio para listas sem resultados |

### Utilitários (`src/lib/utils.ts`)

```ts
cn(...classes)          // clsx + tailwind-merge
avatarColor(seed)       // cor determinística para avatares
initials(name)          // "Ana Silva" → "AS"
```

## Design system

| Token | Hex | Uso |
|---|---|---|
| `--background` | `#f4f3ee` | Fundo de página (creme quente) |
| `--surface` | `#ffffff` | Cards, inputs, modais |
| `--foreground` | `#171717` | Texto principal, sidebar |
| `--accent` | `#ffe600` | Amarelo eDuca — botão de destaque |
| `--destructive` | `#e5383b` | Acções destrutivas |

**Não usar verde** — qualquer ocorrência é um placeholder antigo; substituir por preto/amarelo.

Ícones: `import Icon from '@iconify/svelte'` (default, não named export) — Solar icon set (`solar:*-linear`).

## Sala de aula virtual (`/sala/[id]`)

Página especial que combina:
- **Quadro branco** colaborativo via Socket.IO (`wb:stroke`, `wb:clear`)
- **Vídeo** multiponto via LiveKit (microfone + câmara)
- **Chat** em tempo real com indicador de digitação

O token LiveKit e o token de autenticação para o Socket.IO são obtidos no server load (`+page.server.ts`) e passados ao componente como `data.livekit` e `data.token` — nunca lidos de cookies pelo browser.
