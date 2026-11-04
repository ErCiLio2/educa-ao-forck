<script lang="ts">
  import Icon from '@iconify/svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const steps = [
    {
      n: '01',
      title: 'Escolhe a tua disciplina',
      desc: 'Pesquisa por disciplina, nível de ensino ou disponibilidade.',
      tags: ['Matemática', 'Inglês', 'Física', 'Biologia'],
      bg: 'bg-background border border-border',
      textClass: '',
      numClass: 'text-muted-foreground',
    },
    {
      n: '02',
      title: 'Marca a tua aula',
      desc: 'Escolhe o horário que te convém e confirma a reserva em segundos.',
      tags: null,
      bg: 'bg-accent',
      textClass: 'text-accent-foreground',
      numClass: 'text-accent-foreground/50',
    },
    {
      n: '03',
      title: 'Aprende com o teu tutor',
      desc: 'Aula online com vídeo, quadro branco colaborativo e gravação.',
      tags: null,
      bg: 'bg-foreground',
      textClass: 'text-white',
      numClass: 'text-white/30',
    },
  ];

  const disciplines = [
    { name: 'Matemática',        icon: 'solar:ruler-cross-pen-linear',     tone: 'bg-tone-yellow   text-tone-yellow-fg'   },
    { name: 'Física',            icon: 'solar:atom-linear',                 tone: 'bg-tone-mint     text-tone-mint-fg'     },
    { name: 'Língua Portuguesa', icon: 'solar:book-2-linear',               tone: 'bg-tone-peach    text-tone-peach-fg'    },
    { name: 'Química',           icon: 'solar:test-tube-linear',            tone: 'bg-tone-lavender text-tone-lavender-fg' },
    { name: 'Biologia',          icon: 'solar:leaf-linear',                 tone: 'bg-tone-mint     text-tone-mint-fg'     },
    { name: 'Inglês',            icon: 'solar:global-linear',               tone: 'bg-tone-yellow   text-tone-yellow-fg'   },
    { name: 'Informática',       icon: 'solar:code-square-linear',          tone: 'bg-tone-lavender text-tone-lavender-fg' },
    { name: 'Geografia',         icon: 'solar:map-point-wave-linear',       tone: 'bg-tone-peach    text-tone-peach-fg'    },
  ];

  const security = [
    {
      icon: 'solar:shield-check-linear',
      title: 'Tutores verificados',
      desc: 'Todos os tutores passam por verificação de identidade, registo criminal e entrevista presencial.',
    },
    {
      icon: 'solar:lock-password-linear',
      title: 'Dados protegidos',
      desc: 'Os dados pessoais de alunos e encarregados são tratados com consentimento explícito, conforme a lei angolana.',
    },
    {
      icon: 'solar:shield-user-linear',
      title: 'Seguro para menores',
      desc: 'Acesso controlado pelo encarregado de educação, com auditoria de todas as interações.',
    },
  ];
</script>

<svelte:head>
  <title>eDuca — Explicações online em Angola</title>
  <meta name="description" content="Encontra os melhores tutores de Angola para aulas online, do ensino primário ao universitário." />
</svelte:head>

<!-- HERO -->
<section class="bg-background py-16 md:py-24">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
      <div>
        <h1 class="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground leading-[1.08] tracking-tight">
          Explicações online com os melhores tutores de Angola.
        </h1>
        <p class="mt-5 text-muted-foreground text-lg leading-relaxed max-w-lg">
          Aulas individuais ou em grupo, do ensino primário ao universitário, com tutores verificados.
        </p>

        <form action="/explorar" method="GET" class="mt-8">
          <div class="flex flex-col sm:flex-row gap-2">
            <input
              name="q"
              type="text"
              placeholder="Que disciplina procuras?"
              class="flex-1 h-12 px-4 rounded-xl border border-border bg-surface text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="submit"
              class="h-12 px-6 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/85 active:bg-primary/75 transition-colors"
            >
              Pesquisar
            </button>
          </div>
        </form>

        <div class="mt-8 flex flex-wrap gap-8">
          {#each [['420+', 'Tutores'], ['4,8+', 'Estrelas médias'], ['12.700+', 'Aulas realizadas']] as [value, label]}
            <div>
              <p class="text-2xl font-bold text-foreground">{value}</p>
              <p class="text-xs text-muted-foreground mt-0.5">{label}</p>
            </div>
          {/each}
        </div>
      </div>

      <!-- Hero visual -->
      <div class="hidden lg:flex justify-end">
        <div class="w-full max-w-lg aspect-[4/3] rounded-3xl bg-muted relative overflow-hidden">
          <div class="absolute bottom-4 left-4 right-4">
            <div class="bg-surface/90 backdrop-blur-sm rounded-xl px-4 py-3 shadow-sm">
              <div class="flex items-center gap-3">
                <div class="size-10 rounded-lg bg-accent flex items-center justify-center shrink-0">
                  <Icon icon="solar:star-bold" width="20" class="text-accent-foreground" />
                </div>
                <div>
                  <p class="text-xs font-semibold text-foreground">Prof.ª Ana Domingos</p>
                  <p class="text-[10px] text-muted-foreground">Matemática · 4,9 ★ · 2.800 AOA/h</p>
                </div>
              </div>
            </div>
          </div>
          <div class="absolute inset-0 flex items-center justify-center text-muted-foreground/15">
            <Icon icon="solar:users-group-two-rounded-linear" width="96" />
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- COMO FUNCIONA -->
<section id="como-funciona" class="bg-surface py-16 md:py-24">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <h2 class="text-3xl font-bold text-foreground">Como funciona, em três passos</h2>
    <p class="mt-2 text-muted-foreground">Começa a aprender em menos de 5 minutos.</p>
    <div class="mt-10 grid grid-cols-1 md:grid-cols-3 gap-4">
      {#each steps as step}
        <div class={`${step.bg} rounded-2xl p-6 flex flex-col`}>
          <span class={`text-xs font-bold tracking-widest ${step.numClass}`}>{step.n}</span>
          <h3 class={`mt-4 text-xl font-bold ${step.textClass}`}>{step.title}</h3>
          <p class={`mt-2 text-sm leading-relaxed ${step.textClass ? step.textClass + '/70' : 'text-muted-foreground'}`}>
            {step.desc}
          </p>
          {#if step.tags}
            <div class="mt-5 flex flex-wrap gap-1.5">
              {#each step.tags as tag}
                <span class="px-2.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground rounded-full">{tag}</span>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</section>

<!-- DISCIPLINAS -->
<section class="bg-background py-16 md:py-24">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <div class="flex items-baseline justify-between mb-10">
      <h2 class="text-3xl font-bold text-foreground">Disciplinas mais procuradas</h2>
      <a href="/explorar" class="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
        Ver todas
      </a>
    </div>
    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      {#each disciplines as d}
        <a
          href={`/explorar?q=${encodeURIComponent(d.name)}`}
          class="flex items-center gap-3 p-4 bg-surface rounded-xl border border-border hover:border-foreground/20 hover:shadow-sm transition-all group"
        >
          <span class={`size-10 rounded-lg flex items-center justify-center shrink-0 ${d.tone}`}>
            <Icon icon={d.icon} width="20" />
          </span>
          <span class="text-sm font-medium text-foreground truncate">{d.name}</span>
        </a>
      {/each}
    </div>
  </div>
</section>

<!-- TUTORES EM DESTAQUE -->
{#if data.featuredTutors.length > 0}
  <section class="bg-surface py-16 md:py-24">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex items-baseline justify-between mb-10">
        <h2 class="text-3xl font-bold text-foreground">Tutores em destaque</h2>
        <a href="/explorar" class="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
          Ver todos
        </a>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {#each data.featuredTutors as tutor (tutor.id)}
          <a
            href={`/explorar/${tutor.id}`}
            class="group bg-background rounded-2xl overflow-hidden border border-border hover:border-foreground/20 hover:shadow-sm transition-all"
          >
            <div class="aspect-[4/3] bg-muted overflow-hidden">
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
            </div>
            <div class="p-4">
              <p class="font-semibold text-foreground text-sm truncate">{tutor.fullName}</p>
              <p class="text-xs text-muted-foreground mt-0.5 truncate">{tutor.subjects?.[0] ?? 'Tutor'}</p>
              <div class="mt-3 flex items-center justify-between">
                <div class="flex items-center gap-1">
                  <Icon icon="solar:star-bold" width="13" style="color: #ad7b15" />
                  <span class="text-xs font-medium text-foreground">{tutor.averageRating?.toFixed(1) ?? '—'}</span>
                </div>
                <span class="text-xs font-semibold text-foreground">
                  {tutor.hourlyRate != null ? tutor.hourlyRate.toLocaleString('pt-AO') + ' AOA/h' : '—'}
                </span>
              </div>
            </div>
          </a>
        {/each}
      </div>
    </div>
  </section>
{/if}

<!-- SEGURANÇA -->
<section class="bg-foreground py-16 md:py-24">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <h2 class="text-3xl md:text-4xl font-bold text-white leading-tight">
      Segurança para alunos,<br />tutores e encarregados.
    </h2>
    <div class="mt-12 grid grid-cols-1 md:grid-cols-3 gap-10">
      {#each security as item}
        <div>
          <div class="size-12 rounded-xl bg-white/10 flex items-center justify-center mb-5">
            <Icon icon={item.icon} width="22" class="text-white" />
          </div>
          <h3 class="text-lg font-semibold text-white mb-2">{item.title}</h3>
          <p class="text-sm text-white/50 leading-relaxed">{item.desc}</p>
        </div>
      {/each}
    </div>
  </div>
</section>

<!-- DATA-LITE -->
<section class="bg-accent py-16 md:py-20">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <div class="max-w-2xl">
      <p class="text-xs font-bold uppercase tracking-widest text-accent-foreground/50 mb-3">Optimizado para Angola</p>
      <h2 class="text-3xl md:text-4xl font-bold text-accent-foreground leading-tight">
        Poupa dados móveis sem deixar de aprender.
      </h2>
      <p class="mt-4 text-accent-foreground/65 text-lg">
        O eDuca funciona com ligações lentas e está disponível com os dados subsidiados da Unitel e Movicel.
      </p>
      <a
        href="/registar"
        class="mt-8 inline-flex items-center gap-2 h-12 px-6 bg-foreground text-primary-foreground rounded-xl text-sm font-semibold hover:bg-foreground/85 transition-colors"
      >
        Começar agora
        <Icon icon="solar:arrow-right-linear" width="16" />
      </a>
    </div>
  </div>
</section>

<!-- CTA DUPLO -->
<section class="bg-background py-16 md:py-24">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
      <!-- Aluno -->
      <div class="rounded-3xl bg-accent p-8 md:p-10 flex flex-col min-h-64">
        <p class="text-[10px] font-bold uppercase tracking-widest text-accent-foreground/50 mb-3">Para alunos</p>
        <h3 class="text-2xl md:text-3xl font-bold text-accent-foreground leading-snug flex-1">
          Aprende com tutores verificados, ao teu ritmo.
        </h3>
        <a
          href="/registar"
          class="mt-8 inline-flex items-center gap-2 h-10 px-5 bg-foreground text-primary-foreground rounded-xl text-sm font-semibold hover:bg-foreground/85 transition-colors self-start"
        >
          Criar conta
          <Icon icon="solar:arrow-right-linear" width="14" />
        </a>
      </div>

      <!-- Tutor -->
      <div class="rounded-3xl bg-foreground p-8 md:p-10 flex flex-col min-h-64">
        <p class="text-[10px] font-bold uppercase tracking-widest text-white/35 mb-3">Para tutores</p>
        <h3 class="text-2xl md:text-3xl font-bold text-white leading-snug flex-1">
          Ensinas bem? Dá explicações na eDuca.
        </h3>
        <a
          href="/registar?papel=tutor"
          class="mt-8 inline-flex items-center gap-2 h-10 px-5 bg-accent text-accent-foreground rounded-xl text-sm font-semibold hover:bg-accent/85 transition-colors self-start"
        >
          Candidatar-me
          <Icon icon="solar:arrow-right-linear" width="14" />
        </a>
      </div>
    </div>
  </div>
</section>
