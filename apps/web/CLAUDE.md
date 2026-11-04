# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

- **SvelteKit 2** + **Svelte 5** (runes: `$props()`, `$state()`, `$derived()`, `$effect()`, snippets via `{@render}`)
- **Tailwind CSS v4** — sem ficheiro `tailwind.config.*`; tokens em `src/lib/theme.css` via `@theme inline`
- **adapter-node** — SSR; nunca usar `export const prerender = true` em rotas autenticadas
- **TypeScript strict**; `$types` gerados pelo SvelteKit (obriga a correr `svelte-kit sync` após criar rotas novas)

## Comandos

```bash
pnpm dev                                          # servidor de desenvolvimento
pnpm build                                        # build de produção
pnpm typecheck                                    # svelte-kit sync + tsc --noEmit
pnpm exec svelte-check --tsconfig ./tsconfig.json # verifica templates Svelte + tipos
pnpm lint                                         # ESLint (config herdado do workspace)
```

**Depois de criar novas rotas:** `pnpm exec svelte-kit sync` — sem isto os `$types` não existem e o typecheck falha.

## Svelte 5 — padrões obrigatórios

- Props com `$props()`, nunca `export let`
- Eventos com `onclick={handler}`, nunca `on:click`
- Snippets com `{@render children?.()}`, nunca `<slot>`
- Strings com `{}` no atributo `pattern` de inputs (ex: `pattern="[0-9]{6}"` → Svelte interpreta `{6}` como expressão; usar variável ou bind)

## Design system

- **Paleta**: fundo `#f4f3ee` (creme), primário/CTA `#171717` (preto), accent `#ffe600` (amarelo), destructive `#e5383b` (vermelho)
- **NÃO verde** — qualquer uso de verde é placeholder antigo; substituir por preto/amarelo
- Tokens como `bg-accent`, `text-primary`, `bg-foreground` mapeam para variáveis CSS definidas em `src/lib/theme.css`
- Utilitário de classes: `cn()` em `$lib/utils` (clsx + tailwind-merge)
- Variantes de componentes: `class-variance-authority` (CVA)
- Ícones: `import Icon from '@iconify/svelte'` (**default**, não named export) — Solar icon set (`solar:*-linear`)

## Componentes disponíveis

`$lib/components/ui/`: `Button` (CVA, 6 variantes), `Badge`, `Avatar`, `Input`, `Card`, `Spinner`
`$lib/components/`: `Logo`, `Navbar`, `Sidebar` (admin), `SidebarTutor`, `SidebarStudent`, `SidebarGuardian`
`$lib/utils`: `cn()`, `avatarColor(seed)`, `initials(name)`
`$lib/api/client`: `apiFetch` (server — único cliente de API; chamado apenas a partir do servidor)

## Rotas e layouts

| Grupo | URL | Guard | Layout |
|-------|-----|-------|--------|
| `(public)` | `/`, `/explorar` | — | Navbar + Footer |
| raiz | `/login`, `/registar`, `/mfa` | — | Split-layout próprio (sem Navbar) |
| `(admin)` | `/dashboard`, `/tutors`, `/users`, `/payments`, `/role-changes`, `/notifications`, `/conteudos`, `/auditoria` | `role === 'ADMIN'` | Sidebar escura |
| `(tutor)` | `/tutor/painel`, `/tutor/sessoes`, `/tutor/documentos`, `/tutor/conteudos`, `/tutor/perfil` | `role === 'TUTOR'` | SidebarTutor |
| `(student)` | `/painel`, `/sessoes`, `/pacotes`, `/perfil` | `role === 'STUDENT'` | SidebarStudent |
| `(guardian)` | `/encarregado/painel`, `/encarregado/consentimento`, `/encarregado/dependentes/[id]`, `/encarregado/pacotes`, `/encarregado/perfil` | `role === 'GUARDIAN'` | SidebarGuardian |
| raiz | `/sala/[id]` | autenticado (qualquer perfil) | — |

Protecção de rotas via `+layout.server.ts` de cada grupo → `locals.user.role`.
Redirect pós-login: ADMIN → `/dashboard` · TUTOR → `/tutor/painel` · STUDENT → `/painel` · GUARDIAN → `/encarregado/painel`.

## Auth

`hooks.server.ts` valida o `access_token` (cookie `httpOnly`) em cada pedido chamando `/api/v1/auth/me`; se expirado, faz refresh via `/api/v1/auth/refresh` e actualiza o cookie.
`locals.token: string | null` — access token actual, passado explicitamente a `apiFetch`.
`locals.user: { id, name, email, role } | null` — utilizador autenticado.

Toda a comunicação com a API acontece no servidor (`+page.server.ts`, form actions). Não há chamadas à API directamente do browser fora da sala de aula.

## Tipos da API

```ts
import type { components } from '@educa/api-types';
```
Os tipos são gerados do contrato OpenAPI em `packages/api-types/`. Nunca definir manualmente tipos que já existam lá.

## Variáveis de ambiente

```
PUBLIC_API_URL=http://localhost:3000   # URL da API Fastify
```
Lida com `$env/static/public`. Nunca usar `process.env` directamente.
