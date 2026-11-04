<script lang="ts">
  import { enhance } from '$app/forms';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let loading = $state(false);
  let showCreate = $state(false);
</script>

<svelte:head><title>Pacotes de Pagamento — eDuca Admin</title></svelte:head>

<div class="p-8">
  <div class="mb-6 flex items-start justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold text-gray-900">Pacotes de Pagamento</h1>
      <p class="text-sm text-gray-500 mt-1">{data.offers.length} pacote{data.offers.length === 1 ? '' : 's'}</p>
    </div>
    <button
      type="button"
      onclick={() => (showCreate = !showCreate)}
      class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
    >
      + Novo pacote
    </button>
  </div>

  <!-- Formulário de criação -->
  {#if showCreate}
    <div class="bg-white rounded-xl border border-gray-200 p-6 mb-6">
      <h2 class="text-base font-semibold text-gray-900 mb-4">Novo pacote</h2>

      {#if form && 'createError' in form && form.createError}
        <div class="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{form.createError}</div>
      {/if}

      <form
        method="POST"
        action="?/create"
        use:enhance={() => {
          loading = true;
          return async ({ result, update }) => {
            loading = false;
            if (result.type === 'success') showCreate = false;
            update();
          };
        }}
        class="grid grid-cols-2 gap-4"
      >
        <div class="col-span-2">
          <label class="block text-sm font-medium text-gray-700 mb-1">Nome <span class="text-red-500">*</span></label>
          <input
            name="name"
            type="text"
            required
            maxlength="100"
            placeholder="Ex.: Pacote Básico 10 h"
            class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Horas <span class="text-red-500">*</span></label>
          <input
            name="hours"
            type="number"
            required
            min="0.25"
            max="9999"
            step="0.25"
            placeholder="10"
            class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Preço (AOA) <span class="text-red-500">*</span></label>
          <input
            name="price"
            type="number"
            required
            min="0.01"
            step="0.01"
            placeholder="5000"
            class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Validade (dias, opcional)</label>
          <input
            name="validityDays"
            type="number"
            min="1"
            max="3650"
            step="1"
            placeholder="365"
            class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div class="col-span-2 flex gap-3">
          <button
            type="button"
            onclick={() => (showCreate = false)}
            class="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading}
            class="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {loading ? 'A criar…' : 'Criar pacote'}
          </button>
        </div>
      </form>
    </div>
  {/if}

  {#if form && 'toggleError' in form && form.toggleError}
    <div class="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{form.toggleError}</div>
  {/if}

  <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
    <table class="w-full text-sm">
      <thead class="bg-gray-50 border-b border-gray-200">
        <tr>
          <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Nome</th>
          <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Horas</th>
          <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Preço</th>
          <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Validade</th>
          <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Estado</th>
          <th class="px-5 py-3"></th>
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-100">
        {#if data.offers.length === 0}
          <tr>
            <td colspan="6" class="px-5 py-10 text-center text-gray-400">Nenhum pacote criado.</td>
          </tr>
        {:else}
          {#each data.offers as offer (offer.id)}
            <tr class="hover:bg-gray-50 transition-colors">
              <td class="px-5 py-3 font-medium text-gray-900">{offer.name}</td>
              <td class="px-5 py-3 text-gray-700">{offer.hours} h</td>
              <td class="px-5 py-3 text-gray-700">{offer.price} AOA</td>
              <td class="px-5 py-3 text-gray-500">{offer.validityDays ? offer.validityDays + ' dias' : '—'}</td>
              <td class="px-5 py-3">
                <span class="px-2 py-0.5 rounded-full text-xs font-medium {offer.active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}">
                  {offer.active ? 'Activo' : 'Inactivo'}
                </span>
              </td>
              <td class="px-5 py-3">
                <form
                  method="POST"
                  action="?/toggle"
                  use:enhance={() => {
                    loading = true;
                    return async ({ update }) => { loading = false; update(); };
                  }}
                >
                  <input type="hidden" name="id" value={offer.id} />
                  <input type="hidden" name="active" value={String(!offer.active)} />
                  <button
                    type="submit"
                    disabled={loading}
                    class="px-3 py-1 border border-gray-300 hover:bg-gray-50 disabled:opacity-50 text-xs font-medium text-gray-700 rounded-lg transition-colors"
                  >
                    {offer.active ? 'Desactivar' : 'Activar'}
                  </button>
                </form>
              </td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
</div>
