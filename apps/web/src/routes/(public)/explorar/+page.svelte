<script lang="ts">
  import Icon from '@iconify/svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const DISCIPLINES = [
    'Matemática', 'Física', 'Língua Portuguesa', 'Química', 'Biologia',
    'Inglês', 'Informática', 'Geografia', 'História', 'Filosofia',
  ];

  const LEVELS = [
    { value: 'primario', label: 'Primário' },
    { value: 'ciclo', label: '1.º Ciclo' },
    { value: 'pre-universitario', label: 'Pré-universitário' },
    { value: 'universitario', label: 'Universitário' },
  ];

  let searchQ = $state(data.q ?? '');

  function totalPages() {
    return Math.ceil(data.total / data.limit);
  }

  function pageUrl(p: number) {
    const params = new URLSearchParams();
    if (data.q) params.set('q', data.q);
    if (data.disciplina) params.set('disciplina', data.disciplina);
    if (data.nivel) params.set('nivel', data.nivel);
    if (data.tipo) params.set('tipo', data.tipo);
    params.set('page', String(p));
    return `/explorar?${params}`;
  }
</script>

<svelte:head>
  <title>Explorar tutores — eDuca</title>
</svelte:head>

<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
  <h1 class="text-3xl font-bold text-foreground mb-6">Explorar tutores</h1>

  <!-- Barra de pesquisa -->
  <form method="GET" class="mb-8">
    <div class="flex gap-2">
      <input
        name="q"
        type="text"
        bind:value={searchQ}
        placeholder="Disciplina ou nome do tutor…"
        class="flex-1 h-11 px-4 rounded-xl border border-border bg-surface text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
      {#if data.disciplina}<input type="hidden" name="disciplina" value={data.disciplina} />{/if}
      {#if data.nivel}<input type="hidden" name="nivel" value={data.nivel} />{/if}
      {#if data.tipo}<input type="hidden" name="tipo" value={data.tipo} />{/if}
      <button
        type="submit"
        class="h-11 px-6 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/85 transition-colors"
      >
        Pesquisar
      </button>
    </div>
  </form>

  <div class="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-8">
    <!-- Filtros (sidebar) -->
    <aside>
      <form method="GET" id="filters-form">
        {#if data.q}<input type="hidden" name="q" value={data.q} />{/if}

        <div class="bg-surface rounded-xl border border-border p-5 space-y-6">
          <div>
            <p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Disciplina</p>
            <div class="space-y-1.5">
              {#each DISCIPLINES as d}
                <label class="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="disciplina"
                    value={d}
                    checked={data.disciplina === d}
                    onchange={() => (document.getElementById('filters-form') as HTMLFormElement)?.submit()}
                    class="accent-foreground"
                  />
                  <span class="text-sm text-foreground">{d}</span>
                </label>
              {/each}
              {#if data.disciplina}
                <a href={pageUrl(1).replace(`disciplina=${encodeURIComponent(data.disciplina)}&`, '').replace(`&disciplina=${encodeURIComponent(data.disciplina)}`, '').replace(`disciplina=${encodeURIComponent(data.disciplina)}`, '')}
                   class="text-xs text-muted-foreground hover:text-foreground underline mt-1 block">
                  Limpar filtro
                </a>
              {/if}
            </div>
          </div>

          <div>
            <p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Nível</p>
            <div class="space-y-1.5">
              {#each LEVELS as l}
                <label class="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="nivel"
                    value={l.value}
                    checked={data.nivel === l.value}
                    onchange={() => (document.getElementById('filters-form') as HTMLFormElement)?.submit()}
                    class="accent-foreground"
                  />
                  <span class="text-sm text-foreground">{l.label}</span>
                </label>
              {/each}
            </div>
          </div>

          <div>
            <p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Tipo de aula</p>
            <div class="flex gap-2">
              {#each [['', 'Todos'], ['individual', 'Individual'], ['grupo', 'Grupo']] as [value, label]}
                <a
                  href={`/explorar?${new URLSearchParams({ ...(data.q ? { q: data.q } : {}), ...(data.disciplina ? { disciplina: data.disciplina } : {}), ...(data.nivel ? { nivel: data.nivel } : {}), ...(value ? { tipo: value } : {}) })}`}
                  class={`flex-1 text-center px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    data.tipo === value || (value === '' && !data.tipo)
                      ? 'bg-foreground text-primary-foreground border-foreground'
                      : 'border-border text-muted-foreground hover:border-foreground/30'
                  }`}
                >
                  {label}
                </a>
              {/each}
            </div>
          </div>
        </div>
      </form>
    </aside>

    <!-- Resultados -->
    <div>
      {#if data.total > 0}
        <p class="text-sm text-muted-foreground mb-5">
          {data.total} tutor{data.total !== 1 ? 'es' : ''} encontrado{data.total !== 1 ? 's' : ''}
          {data.q ? ` para "${data.q}"` : ''}
        </p>
      {/if}

      {#if data.tutors.length === 0}
        <div class="text-center py-24">
          <Icon icon="solar:users-group-two-rounded-linear" width="48" class="text-muted-foreground/30 mx-auto mb-4" />
          <p class="text-muted-foreground font-medium">Nenhum tutor encontrado</p>
          <p class="text-sm text-muted-foreground/60 mt-1">Tenta outros termos ou remove os filtros.</p>
          <a href="/explorar" class="mt-5 inline-flex text-sm font-medium text-foreground underline underline-offset-4">
            Ver todos os tutores
          </a>
        </div>
      {:else}
        <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {#each data.tutors as tutor (tutor.id)}
            <a
              href={`/explorar/${tutor.id}`}
              class="group bg-surface rounded-2xl border border-border hover:border-foreground/20 hover:shadow-sm transition-all overflow-hidden"
            >
              <div class="aspect-[4/3] bg-muted overflow-hidden relative">
                {#if tutor.avatarUrl}
                  <img
                    src={tutor.avatarUrl}
                    alt={tutor.fullName}
                    class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                {:else}
                  <div class="w-full h-full flex items-center justify-center text-muted-foreground/20">
                    <Icon icon="solar:user-rounded-linear" width="48" />
                  </div>
                {/if}
                {#if tutor.isVerified}
                  <span class="absolute top-3 left-3 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-foreground text-white text-[10px] font-semibold">
                    <Icon icon="solar:verified-check-bold" width="10" />
                    Verificado
                  </span>
                {/if}
              </div>
              <div class="p-4">
                <p class="font-semibold text-foreground text-sm truncate">{tutor.fullName}</p>
                <p class="text-xs text-muted-foreground mt-0.5 truncate">
                  {tutor.subjects?.slice(0, 2).join(' · ') ?? 'Tutor'}
                </p>
                <div class="mt-3 flex items-center justify-between">
                  <div class="flex items-center gap-1">
                    <Icon icon="solar:star-bold" width="13" style="color: #ad7b15" />
                    <span class="text-xs font-medium text-foreground">
                      {tutor.averageRating?.toFixed(1) ?? '—'}
                    </span>
                    {#if tutor.reviewCount > 0}
                      <span class="text-[10px] text-muted-foreground">({tutor.reviewCount})</span>
                    {/if}
                  </div>
                  <span class="text-xs font-semibold text-foreground">
                    {tutor.hourlyRate != null ? Number(tutor.hourlyRate).toLocaleString('pt-AO') + ' AOA/h' : '—'}
                  </span>
                </div>
              </div>
            </a>
          {/each}
        </div>

        <!-- Paginação -->
        {#if totalPages() > 1}
          <div class="flex justify-center gap-2 mt-10">
            {#if data.page > 1}
              <a href={pageUrl(data.page - 1)} class="h-9 px-4 inline-flex items-center text-sm border border-border rounded-lg hover:bg-muted transition-colors">
                ← Anterior
              </a>
            {/if}
            {#each Array.from({ length: totalPages() }, (_, i) => i + 1) as p}
              <a
                href={pageUrl(p)}
                class={`h-9 w-9 inline-flex items-center justify-center text-sm rounded-lg transition-colors ${
                  p === data.page
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border hover:bg-muted'
                }`}
              >
                {p}
              </a>
            {/each}
            {#if data.page < totalPages()}
              <a href={pageUrl(data.page + 1)} class="h-9 px-4 inline-flex items-center text-sm border border-border rounded-lg hover:bg-muted transition-colors">
                Seguinte →
              </a>
            {/if}
          </div>
        {/if}
      {/if}
    </div>
  </div>
</div>
