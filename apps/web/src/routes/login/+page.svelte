<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import Icon from '@iconify/svelte';
  import Logo from '$lib/components/Logo.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import type { ActionData } from './$types';

  let { form }: { form: ActionData } = $props();

  let loading = $state(false);
  let showPassword = $state(false);

  $effect(() => {
    if (form && 'challenge' in form && form.challenge) {
      goto(`/mfa?challenge=${encodeURIComponent(form.challenge as string)}`);
    }
  });
</script>

<svelte:head><title>Entrar — eDuca</title></svelte:head>

<div class="min-h-screen grid grid-cols-1 lg:grid-cols-2">
  <!-- Painel esquerdo: formulário -->
  <div class="flex flex-col px-6 py-8 sm:px-10 md:px-16 lg:px-20 xl:px-28">
    <div class="flex items-center justify-between mb-10">
      <Logo size="sm" scheme="color" />
      <a href="/" class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <Icon icon="solar:arrow-left-linear" width="15" />
        Voltar ao início
      </a>
    </div>

    <div class="flex-1 flex flex-col justify-center max-w-sm w-full mx-auto lg:mx-0">
      <h1 class="text-3xl font-bold text-foreground">Entrar na eDuca</h1>
      <p class="mt-2 text-sm text-muted-foreground">Usa o teu email ou número de telefone.</p>

      {#if form && 'error' in form && form.error}
        <div class="mt-5 flex items-start gap-2.5 p-3.5 bg-destructive/8 border border-destructive/20 rounded-xl text-sm text-destructive">
          <Icon icon="solar:danger-triangle-linear" width="16" class="shrink-0 mt-0.5" />
          {form.error}
        </div>
      {/if}

      <form
        method="POST"
        class="mt-7 space-y-4"
        use:enhance={() => {
          loading = true;
          return async ({ update }) => {
            loading = false;
            update();
          };
        }}
      >
        <div class="space-y-1.5">
          <label for="email" class="text-sm font-medium text-foreground">Email ou telefone</label>
          <input
            id="email"
            name="email"
            type="text"
            required
            autocomplete="username"
            placeholder="nome@exemplo.com ou 9XX XXX XXX"
            class="w-full h-11 px-4 rounded-xl border border-input bg-surface text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div class="space-y-1.5">
          <div class="flex items-center justify-between">
            <label for="password" class="text-sm font-medium text-foreground">Password</label>
            <a href="#" class="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Esqueci-me a password
            </a>
          </div>
          <div class="relative">
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              required
              autocomplete="current-password"
              placeholder="A tua password"
              class="w-full h-11 px-4 pr-16 rounded-xl border border-input bg-surface text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="button"
              onclick={() => (showPassword = !showPassword)}
              class="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors px-1"
            >
              {showPassword ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          class="w-full h-11 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/85 active:bg-primary/75 disabled:opacity-50 disabled:pointer-events-none transition-colors flex items-center justify-center gap-2"
        >
          {#if loading}
            <Spinner size="sm" />
            A entrar…
          {:else}
            Entrar
          {/if}
        </button>
      </form>

      <div class="mt-6 flex items-center gap-3">
        <div class="flex-1 h-px bg-border"></div>
        <span class="text-xs text-muted-foreground">Ainda não tens conta?</span>
        <div class="flex-1 h-px bg-border"></div>
      </div>

      <a
        href="/registar"
        class="mt-4 w-full h-11 inline-flex items-center justify-center border border-border rounded-xl text-sm font-medium text-foreground hover:bg-muted transition-colors"
      >
        Criar conta
      </a>
    </div>
  </div>

  <!-- Painel direito: visual -->
  <div class="hidden lg:flex flex-col bg-foreground relative overflow-hidden">
    <div class="absolute inset-0 flex items-center justify-center opacity-5">
      <Icon icon="solar:users-group-two-rounded-linear" width="240" class="text-white" />
    </div>

    <div class="relative flex-1 flex items-end pb-24 px-10">
      <div>
        <p class="text-[10px] font-bold uppercase tracking-widest text-white/35 mb-3">eDuca</p>
        <h2 class="text-3xl font-bold text-white leading-snug">
          A tua próxima aula<br />está a um clique.
        </h2>
      </div>
    </div>

    <!-- Banner promo -->
    <div class="relative mx-6 mb-6 bg-accent rounded-2xl px-5 py-3.5 flex items-center gap-3">
      <div class="size-8 rounded-lg bg-accent-foreground/10 flex items-center justify-center shrink-0">
        <Icon icon="solar:tag-bold" width="16" class="text-accent-foreground" />
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-xs font-semibold text-accent-foreground">
          15% de desconto em livros escolares para alunos eDuca
        </p>
        <p class="text-[10px] text-accent-foreground/60 mt-0.5">Parceria LivrariaFamba</p>
      </div>
      <Icon icon="solar:arrow-right-linear" width="14" class="text-accent-foreground shrink-0" />
    </div>
  </div>
</div>
