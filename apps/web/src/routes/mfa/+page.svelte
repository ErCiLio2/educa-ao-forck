<script lang="ts">
  import { enhance } from '$app/forms';
  import Icon from '@iconify/svelte';
  import Logo from '$lib/components/Logo.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  let loading = $state(false);
  const totpPattern = '[0-9 ]{6,7}';
</script>

<svelte:head><title>Autenticação em dois passos — eDuca</title></svelte:head>

<div class="min-h-screen flex items-center justify-center bg-background px-4">
  <div class="w-full max-w-sm">
    <div class="flex justify-center mb-8">
      <Logo size="md" scheme="color" />
    </div>

    <div class="bg-surface rounded-2xl border border-border p-8">
      <div class="flex items-center gap-3 mb-6">
        <div class="size-10 rounded-xl bg-primary flex items-center justify-center shrink-0">
          <Icon icon="solar:shield-check-linear" width="20" class="text-primary-foreground" />
        </div>
        <div>
          <h1 class="text-lg font-semibold text-foreground">Segundo factor</h1>
          <p class="text-xs text-muted-foreground mt-0.5">Abre a app autenticadora e introduz o código.</p>
        </div>
      </div>

      {#if form && 'error' in form && form.error}
        <div class="mb-5 flex items-start gap-2.5 p-3.5 bg-destructive/8 border border-destructive/20 rounded-xl text-sm text-destructive">
          <Icon icon="solar:danger-triangle-linear" width="16" class="shrink-0 mt-0.5" />
          {form.error}
        </div>
      {/if}

      <form
        method="POST"
        use:enhance={() => {
          loading = true;
          return async ({ update }) => { loading = false; update(); };
        }}
        class="space-y-5"
      >
        <input type="hidden" name="challenge" value={form?.challenge ?? data.challenge} />

        <div class="space-y-1.5">
          <label for="code" class="text-sm font-medium text-foreground">Código TOTP</label>
          <input
            id="code" name="code" type="text" inputmode="numeric"
            pattern={totpPattern} maxlength="7" required autocomplete="one-time-code"
            placeholder="000 000"
            class="w-full h-12 px-4 rounded-xl border border-input bg-surface text-center text-xl font-mono tracking-[0.25em] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          class="w-full h-11 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/85 disabled:opacity-50 disabled:pointer-events-none transition-colors flex items-center justify-center gap-2"
        >
          {#if loading}<Spinner size="sm" />A verificar…{:else}Verificar{/if}
        </button>
      </form>

      <a href="/login" class="block text-center mt-5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        ← Voltar ao login
      </a>
    </div>
  </div>
</div>
