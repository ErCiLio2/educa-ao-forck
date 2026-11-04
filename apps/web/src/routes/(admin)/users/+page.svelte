<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const roleLabel: Record<string, string> = {
    STUDENT:  'Aluno',
    GUARDIAN: 'Encarregado',
    TUTOR:    'Tutor',
    ADMIN:    'Admin',
  };

  const roleColor: Record<string, string> = {
    STUDENT:  'bg-blue-50 text-blue-700',
    GUARDIAN: 'bg-purple-50 text-purple-700',
    TUTOR:    'bg-green-50 text-green-700',
    ADMIN:    'bg-gray-100 text-gray-700',
  };

  const totalPages = $derived(Math.ceil(data.total / data.limit));
</script>

<svelte:head><title>Utilizadores — eDuca Admin</title></svelte:head>

<div class="p-8">
  <div class="mb-6 flex items-start justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold text-gray-900">Utilizadores</h1>
      <p class="text-sm text-gray-500 mt-1">{data.total} registo{data.total === 1 ? '' : 's'}</p>
    </div>

    <form method="GET" class="flex gap-2">
      <input
        name="q"
        type="search"
        value={data.q}
        placeholder="Pesquisar por nome ou email…"
        class="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <button
        type="submit"
        class="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
      >
        Pesquisar
      </button>
    </form>
  </div>

  <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
    <table class="w-full text-sm">
      <thead class="bg-gray-50 border-b border-gray-200">
        <tr>
          <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Nome</th>
          <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Email</th>
          <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Papel</th>
          <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">MFA</th>
          <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Registo</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-100">
        {#if data.users.length === 0}
          <tr>
            <td colspan="5" class="px-5 py-10 text-center text-gray-400">Nenhum utilizador encontrado.</td>
          </tr>
        {:else}
          {#each data.users as user (user.id)}
            <tr class="hover:bg-gray-50 transition-colors">
              <td class="px-5 py-3 font-medium text-gray-900">{user.name}</td>
              <td class="px-5 py-3 text-gray-500">{user.email}</td>
              <td class="px-5 py-3">
                <span class="px-2 py-0.5 rounded-full text-xs font-medium {roleColor[user.role] ?? 'bg-gray-100 text-gray-600'}">
                  {roleLabel[user.role] ?? user.role}
                </span>
              </td>
              <td class="px-5 py-3">
                <span class="{user.mfaEnabled ? 'text-green-600' : 'text-gray-400'} text-xs font-medium">
                  {user.mfaEnabled ? 'Activo' : '—'}
                </span>
              </td>
              <td class="px-5 py-3 text-gray-500">
                {new Date(user.createdAt).toLocaleDateString('pt-PT')}
              </td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>

  <!-- Paginação -->
  {#if totalPages > 1}
    <div class="flex justify-center gap-2 mt-6">
      {#each Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1) as p}
        <a
          href="?page={p}{data.q ? `&q=${encodeURIComponent(data.q)}` : ''}"
          class="px-3 py-1.5 rounded-lg text-sm font-medium {p === data.page
            ? 'bg-blue-600 text-white'
            : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'}"
        >{p}</a>
      {/each}
    </div>
  {/if}
</div>
