<script lang="ts">
  import { enhance } from '$app/forms';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let loading = $state(false);

  const roleLabel: Record<string, string> = {
    STUDENT: 'Aluno', GUARDIAN: 'Encarregado', TUTOR: 'Tutor', ADMIN: 'Admin',
  };

  const statusLabel: Record<string, string> = {
    PENDING: 'Pendente', APPROVED: 'Aprovado', REJECTED: 'Rejeitado',
  };

  const statusColor: Record<string, string> = {
    PENDING:  'bg-yellow-50 text-yellow-700',
    APPROVED: 'bg-green-50 text-green-700',
    REJECTED: 'bg-red-50 text-red-700',
  };

  const totalPages = $derived(Math.ceil(data.total / data.limit));
</script>

<svelte:head><title>Alterações de Papel — eDuca Admin</title></svelte:head>

<div class="p-8">
  <div class="mb-6 flex items-start justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold text-gray-900">Alterações de Papel</h1>
      <p class="text-sm text-gray-500 mt-1">{data.total} pedido{data.total === 1 ? '' : 's'}</p>
    </div>

    <form method="GET" class="flex gap-2">
      <select
        name="status"
        onchange={(e) => (e.currentTarget as HTMLSelectElement).form?.submit()}
        class="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {#each ['PENDING', 'APPROVED', 'REJECTED'] as s}
          <option value={s} selected={s === data.status}>{statusLabel[s]}</option>
        {/each}
      </select>
    </form>
  </div>

  {#if form && 'error' in form && form.error}
    <div class="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{form.error}</div>
  {/if}

  <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
    <table class="w-full text-sm">
      <thead class="bg-gray-50 border-b border-gray-200">
        <tr>
          <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Utilizador</th>
          <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Alteração</th>
          <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Pedido por</th>
          <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Estado</th>
          <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Data</th>
          {#if data.status === 'PENDING'}
            <th class="px-5 py-3"></th>
          {/if}
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-100">
        {#if data.requests.length === 0}
          <tr>
            <td colspan="6" class="px-5 py-10 text-center text-gray-400">Nenhum pedido encontrado.</td>
          </tr>
        {:else}
          {#each data.requests as req (req.id)}
            <tr class="hover:bg-gray-50 transition-colors">
              <td class="px-5 py-3">
                <p class="font-medium text-gray-900">{req.target.name}</p>
                <p class="text-gray-400 text-xs">{req.target.email}</p>
              </td>
              <td class="px-5 py-3">
                <span class="text-gray-500">{roleLabel[req.fromRole] ?? req.fromRole}</span>
                <span class="mx-1 text-gray-400">→</span>
                <span class="font-medium text-gray-900">{roleLabel[req.toRole] ?? req.toRole}</span>
              </td>
              <td class="px-5 py-3 text-gray-500">{req.requestedBy.name}</td>
              <td class="px-5 py-3">
                <span class="px-2 py-0.5 rounded-full text-xs font-medium {statusColor[req.status] ?? ''}">
                  {statusLabel[req.status] ?? req.status}
                </span>
              </td>
              <td class="px-5 py-3 text-gray-500">
                {new Date(req.createdAt).toLocaleDateString('pt-PT')}
              </td>
              {#if data.status === 'PENDING'}
                <td class="px-5 py-3">
                  <div class="flex gap-2">
                    <form method="POST" action="?/approve" use:enhance={() => { loading = true; return async ({ update }) => { loading = false; update(); }; }}>
                      <input type="hidden" name="id" value={req.id} />
                      <button
                        type="submit"
                        disabled={loading}
                        class="px-3 py-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
                      >
                        Aprovar
                      </button>
                    </form>
                    <form method="POST" action="?/reject" use:enhance={() => { loading = true; return async ({ update }) => { loading = false; update(); }; }}>
                      <input type="hidden" name="id" value={req.id} />
                      <button
                        type="submit"
                        disabled={loading}
                        class="px-3 py-1 bg-red-50 hover:bg-red-100 disabled:opacity-50 text-red-700 text-xs font-medium rounded-lg border border-red-200 transition-colors"
                      >
                        Rejeitar
                      </button>
                    </form>
                  </div>
                </td>
              {/if}
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>

  {#if totalPages > 1}
    <div class="flex justify-center gap-2 mt-6">
      {#each Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1) as p}
        <a
          href="?page={p}&status={data.status}"
          class="px-3 py-1.5 rounded-lg text-sm font-medium {p === data.page
            ? 'bg-blue-600 text-white'
            : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'}"
        >{p}</a>
      {/each}
    </div>
  {/if}
</div>
