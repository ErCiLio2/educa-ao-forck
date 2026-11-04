<script lang="ts">
  import { enhance } from '$app/forms';
  import Icon from '@iconify/svelte';
  import Logo from '$lib/components/Logo.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  type Role = 'aluno' | 'tutor' | 'encarregado';

  const papel = data.papel;
  const initialRole: Role = (['aluno', 'tutor', 'encarregado'].includes(papel) ? papel : 'aluno') as Role;

  let step = $state<'role' | 'form'>('role');
  let selectedRole = $state<Role>(initialRole);
  let loading = $state(false);
  let passwordValue = $state('');
  let showPassword = $state(false);

  const roles: { value: Role; label: string; desc: string; icon: string; iconBg: string }[] = [
    {
      value: 'aluno',
      label: 'Aluno',
      desc: 'Encontra tutores, agenda aulas e acompanha o teu progresso.',
      icon: 'solar:square-academic-cap-linear',
      iconBg: 'bg-accent text-accent-foreground',
    },
    {
      value: 'tutor',
      label: 'Tutor',
      desc: 'Dá explicações, define o teu preço e cria o teu horário.',
      icon: 'solar:book-bookmark-linear',
      iconBg: 'bg-foreground text-white',
    },
    {
      value: 'encarregado',
      label: 'Encarregado',
      desc: 'Autoriza o acesso e tutela os teus dependentes.',
      icon: 'solar:shield-user-linear',
      iconBg: 'bg-destructive text-white',
    },
  ];

  function passwordStrength(pw: string) {
    let score = 0;
    if (pw.length >= 8) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return score;
  }

  const strength = $derived(passwordStrength(passwordValue));
  const strengthLabel = $derived(['', 'Fraca', 'Razoável', 'Boa', 'Forte'][strength] ?? '');
  const strengthColor = $derived(['', 'bg-destructive', 'bg-tone-peach-fg', 'bg-tone-mint-fg', 'bg-tone-mint-fg'][strength] ?? '');

  function photoCaption(r: Role) {
    if (r === 'tutor') return 'Ensina ao teu ritmo, ganha o que mereces.';
    if (r === 'encarregado') return 'Acompanha o progresso dos teus filhos.';
    return 'Aprende com tutores verificados, ao teu ritmo.';
  }
</script>

<svelte:head><title>Criar conta — eDuca</title></svelte:head>

<div class="min-h-screen grid grid-cols-1 lg:grid-cols-2">
  <!-- Painel esquerdo -->
  <div class="flex flex-col px-6 py-8 sm:px-10 md:px-16 lg:px-20 xl:px-28">
    <div class="flex items-center justify-between mb-10">
      <Logo size="sm" scheme="color" />
      <a href="/" class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <Icon icon="solar:arrow-left-linear" width="15" />
        Voltar ao início
      </a>
    </div>

    <div class="flex-1 flex flex-col justify-center max-w-sm w-full mx-auto lg:mx-0">

      {#if form?.error}
        <div class="mb-5 flex items-start gap-2.5 p-3.5 bg-destructive/8 border border-destructive/20 rounded-xl text-sm text-destructive">
          <Icon icon="solar:danger-triangle-linear" width="16" class="shrink-0 mt-0.5" />
          {form.error}
        </div>
      {/if}

      {#if step === 'role'}
        <!-- PASSO 1: Escolha do papel -->
        <div>
          <!-- Breadcrumb -->
          <div class="flex items-center gap-1.5 mb-6">
            <span class="text-xs text-muted-foreground">Perfil</span>
            <Icon icon="solar:alt-arrow-right-linear" width="12" class="text-muted-foreground" />
            <span class="text-xs font-semibold text-foreground capitalize">{selectedRole}</span>
          </div>

          <h1 class="text-2xl font-bold text-foreground">Como vais usar a eDuca?</h1>
          <p class="mt-2 text-sm text-muted-foreground">Escolhe o teu perfil. Cada perfil tem a sua própria área.</p>

          <div class="mt-7 space-y-3">
            {#each roles as r}
              <button
                type="button"
                onclick={() => (selectedRole = r.value)}
                class={`w-full flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-all ${
                  selectedRole === r.value
                    ? 'border-foreground bg-surface shadow-sm'
                    : 'border-border hover:border-foreground/30'
                }`}
              >
                <span class={`size-10 rounded-lg flex items-center justify-center shrink-0 ${r.iconBg}`}>
                  <Icon icon={r.icon} width="20" />
                </span>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-semibold text-foreground">{r.label}</p>
                  <p class="text-xs text-muted-foreground mt-0.5 leading-relaxed">{r.desc}</p>
                </div>
                <div class={`size-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                  selectedRole === r.value ? 'border-foreground bg-foreground' : 'border-border'
                }`}>
                  {#if selectedRole === r.value}
                    <div class="size-2 rounded-full bg-primary-foreground"></div>
                  {/if}
                </div>
              </button>
            {/each}
          </div>

          <button
            type="button"
            onclick={() => (step = 'form')}
            class="mt-7 w-full h-11 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/85 transition-colors"
          >
            Continuar
          </button>

          <p class="mt-5 text-center text-sm text-muted-foreground">
            Já tens conta?
            <a href="/login" class="font-medium text-foreground hover:underline underline-offset-4">Entrar</a>
          </p>
        </div>

      {:else}
        <!-- PASSO 2: Formulário -->
        <div>
          <!-- Breadcrumb com voltar -->
          <div class="flex items-center gap-1.5 mb-6">
            <button type="button" onclick={() => (step = 'role')} class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <Icon icon="solar:arrow-left-linear" width="12" />
              Perfil
            </button>
            <Icon icon="solar:alt-arrow-right-linear" width="12" class="text-muted-foreground" />
            <span class="text-xs font-semibold text-foreground capitalize">{selectedRole}</span>
          </div>

          <h1 class="text-2xl font-bold text-foreground">Cria a tua conta</h1>
          <p class="mt-1 text-sm text-muted-foreground capitalize">A registar como <strong>{selectedRole}</strong>.</p>

          <form
            method="POST"
            class="mt-6 space-y-4"
            use:enhance={() => {
              loading = true;
              return async ({ update }) => { loading = false; update(); };
            }}
          >
            <input type="hidden" name="role" value={selectedRole} />

            <div class="space-y-1.5">
              <label for="fullName" class="text-sm font-medium text-foreground">Nome completo</label>
              <input
                id="fullName" name="fullName" type="text" required autocomplete="name"
                placeholder="Ex.: Marta Paixão Ngova"
                class="w-full h-11 px-4 rounded-xl border border-input bg-surface text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div class="space-y-1.5">
              <label for="email" class="text-sm font-medium text-foreground">Email ou telefone</label>
              <input
                id="email" name="email" type="text" required autocomplete="username"
                placeholder="nome@exemplo.com ou 9XX XXX XXX"
                class="w-full h-11 px-4 rounded-xl border border-input bg-surface text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div class="space-y-1.5">
              <label for="password" class="text-sm font-medium text-foreground">Password</label>
              <div class="relative">
                <input
                  id="password" name="password" type={showPassword ? 'text' : 'password'}
                  required autocomplete="new-password" minlength="8" maxlength="128"
                  placeholder="Mínimo 8 caracteres"
                  bind:value={passwordValue}
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
              {#if passwordValue.length > 0}
                <div class="flex items-center gap-2 mt-1.5">
                  <div class="flex-1 flex gap-1">
                    {#each [1, 2, 3, 4] as i}
                      <div class={`flex-1 h-1 rounded-full transition-colors ${i <= strength ? strengthColor : 'bg-border'}`}></div>
                    {/each}
                  </div>
                  <span class="text-[10px] text-muted-foreground">{strengthLabel}</span>
                </div>
              {/if}
            </div>

            {#if selectedRole === 'aluno'}
              <div class="space-y-1.5">
                <label for="birthDate" class="text-sm font-medium text-foreground">Data de nascimento</label>
                <input
                  id="birthDate" name="birthDate" type="date" required
                  class="w-full h-11 px-4 rounded-xl border border-input bg-surface text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            {/if}

            <label class="flex items-start gap-2.5 cursor-pointer mt-1">
              <input name="terms" type="checkbox" required class="mt-0.5 accent-foreground" />
              <span class="text-xs text-muted-foreground leading-relaxed">
                Li e aceito os
                <a href="#" class="text-foreground underline underline-offset-4">Termos e condições</a>
                e a
                <a href="#" class="text-foreground underline underline-offset-4">Política de privacidade</a>.
              </span>
            </label>

            <button
              type="submit"
              disabled={loading}
              class="w-full h-11 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/85 active:bg-primary/75 disabled:opacity-50 disabled:pointer-events-none transition-colors flex items-center justify-center gap-2"
            >
              {#if loading}
                <Spinner size="sm" />
                A criar conta…
              {:else}
                Criar conta
              {/if}
            </button>
          </form>

          <p class="mt-5 text-center text-sm text-muted-foreground">
            Já tens conta?
            <a href="/login" class="font-medium text-foreground hover:underline underline-offset-4">Entrar</a>
          </p>
        </div>
      {/if}
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
          {photoCaption(selectedRole)}
        </h2>
      </div>
    </div>

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
