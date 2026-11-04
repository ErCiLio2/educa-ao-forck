<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const m = $derived(data.metrics);

  function pct(n: number | null): string {
    if (n === null) return '—';
    return n.toFixed(1) + '%';
  }
</script>

<svelte:head><title>Dashboard — eDuca Admin</title></svelte:head>

<div class="p-8">
  <div class="flex items-center justify-between mb-8">
    <div>
      <h1 class="text-2xl font-bold text-gray-900">Dashboard</h1>
      <p class="text-sm text-gray-500 mt-1">Últimos {data.days} dias · desde {new Date(m.since).toLocaleDateString('pt-PT')}</p>
    </div>

    <form method="GET" class="flex items-center gap-2">
      <label for="days" class="text-sm text-gray-600">Período</label>
      <select
        id="days"
        name="days"
        onchange={(e) => (e.currentTarget as HTMLSelectElement).form?.submit()}
        class="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {#each [7, 30, 90, 365] as d}
          <option value={d} selected={d === data.days}>{d} dias</option>
        {/each}
      </select>
    </form>
  </div>

  <!-- Utilizadores -->
  <section class="mb-8">
    <h2 class="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Utilizadores</h2>
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {#each [
        { label: 'Alunos',        value: m.usersByRole.STUDENT  },
        { label: 'Encarregados',  value: m.usersByRole.GUARDIAN },
        { label: 'Tutores',       value: m.usersByRole.TUTOR    },
        { label: 'Admins',        value: m.usersByRole.ADMIN    },
      ] as stat}
        <div class="bg-white rounded-xl border border-gray-200 p-5">
          <p class="text-sm text-gray-500">{stat.label}</p>
          <p class="text-3xl font-bold text-gray-900 mt-1">{stat.value}</p>
        </div>
      {/each}
    </div>
  </section>

  <!-- Tutores por estado -->
  <section class="mb-8">
    <h2 class="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Tutores por estado</h2>
    <div class="grid grid-cols-3 gap-4">
      {#each [
        { label: 'Pendentes',  value: m.tutorsByStatus.PENDING,  color: 'text-yellow-600' },
        { label: 'Aprovados',  value: m.tutorsByStatus.APPROVED, color: 'text-green-600'  },
        { label: 'Rejeitados', value: m.tutorsByStatus.REJECTED, color: 'text-red-600'    },
      ] as stat}
        <div class="bg-white rounded-xl border border-gray-200 p-5">
          <p class="text-sm text-gray-500">{stat.label}</p>
          <p class="text-3xl font-bold {stat.color} mt-1">{stat.value}</p>
        </div>
      {/each}
    </div>
  </section>

  <!-- Aulas -->
  <section class="mb-8">
    <h2 class="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Aulas</h2>
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {#each [
        { label: 'Sessões realizadas',  value: m.classes.sessionsHeld        },
        { label: 'Sessões futuras',     value: m.classes.upcomingSessions    },
        { label: 'Matrículas criadas',  value: m.classes.enrollmentsCreated  },
        { label: 'Taxa de presença',    value: pct(m.classes.attendanceRate) },
      ] as stat}
        <div class="bg-white rounded-xl border border-gray-200 p-5">
          <p class="text-sm text-gray-500">{stat.label}</p>
          <p class="text-3xl font-bold text-gray-900 mt-1">{stat.value}</p>
        </div>
      {/each}
    </div>
  </section>

  <!-- Pagamentos e Reputação -->
  <div class="grid grid-cols-1 sm:grid-cols-2 gap-8">
    <section>
      <h2 class="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Pagamentos</h2>
      <div class="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {#each [
          { label: 'Pagamentos confirmados', value: m.payments.confirmedPayments },
          { label: 'Montante confirmado',    value: m.payments.confirmedAmount + ' AOA' },
          { label: 'Pagamentos pendentes',   value: m.payments.pendingPayments   },
          { label: 'Horas libertadas',       value: m.payments.hoursReleased + ' h' },
          { label: 'Horas por usar',         value: m.payments.hoursOutstanding + ' h' },
        ] as row}
          <div class="flex justify-between px-5 py-3">
            <span class="text-sm text-gray-500">{row.label}</span>
            <span class="text-sm font-semibold text-gray-900">{row.value}</span>
          </div>
        {/each}
      </div>
    </section>

    <section>
      <h2 class="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Reputação</h2>
      <div class="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {#each [
          { label: 'Avaliações escritas', value: m.reputation.reviews },
          { label: 'Nota média',          value: m.reputation.averageRating !== null ? m.reputation.averageRating.toFixed(2) + ' / 5' : '—' },
        ] as row}
          <div class="flex justify-between px-5 py-3">
            <span class="text-sm text-gray-500">{row.label}</span>
            <span class="text-sm font-semibold text-gray-900">{row.value}</span>
          </div>
        {/each}
      </div>
    </section>
  </div>
</div>
