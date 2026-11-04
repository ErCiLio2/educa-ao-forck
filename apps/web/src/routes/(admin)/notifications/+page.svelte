<script lang="ts">
  import { enhance } from '$app/forms';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let loading = $state(false);

  const channelLabel: Record<string, string> = {
    EMAIL: 'Email',
    PUSH:  'Push (Web/Móvel)',
    SMS:   'SMS',
  };

  const channelDesc: Record<string, string> = {
    EMAIL: 'Envio de notificações por correio electrónico.',
    PUSH:  'Notificações push para dispositivos móveis e navegadores.',
    SMS:   'Envio de notificações por mensagem de texto.',
  };
</script>

<svelte:head><title>Notificações — eDuca Admin</title></svelte:head>

<div class="p-8">
  <div class="mb-6">
    <h1 class="text-2xl font-bold text-gray-900">Canais de Notificação</h1>
    <p class="text-sm text-gray-500 mt-1">Activar ou desactivar canais de entrega de notificações.</p>
  </div>

  {#if form && 'error' in form && form.error}
    <div class="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{form.error}</div>
  {/if}

  <div class="space-y-4 max-w-2xl">
    {#each data.channels as ch (ch.channel)}
      <div class="bg-white rounded-xl border border-gray-200 p-6 flex items-start justify-between gap-6">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-3 mb-1">
            <p class="font-semibold text-gray-900">{channelLabel[ch.channel] ?? ch.channel}</p>
            {#if !ch.configured}
              <span class="px-2 py-0.5 bg-yellow-50 text-yellow-700 text-xs rounded-full font-medium">Não configurado</span>
            {/if}
          </div>
          <p class="text-sm text-gray-500">{channelDesc[ch.channel] ?? ''}</p>
          {#if !ch.configured}
            <p class="text-xs text-yellow-600 mt-1">Configure as variáveis de ambiente para este canal antes de activar.</p>
          {/if}
        </div>

        <form
          method="POST"
          action="?/toggle"
          use:enhance={() => {
            loading = true;
            return async ({ update }) => { loading = false; update(); };
          }}
          class="flex-shrink-0"
        >
          <input type="hidden" name="channel" value={ch.channel} />
          <input type="hidden" name="enabled" value={String(!ch.enabled)} />
          <button
            type="submit"
            disabled={loading || (!ch.configured && !ch.enabled)}
            class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none
              {ch.enabled ? 'bg-blue-600' : 'bg-gray-200'}
              disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="{ch.enabled ? 'Desactivar' : 'Activar'} {channelLabel[ch.channel] ?? ch.channel}"
          >
            <span
              class="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform
                {ch.enabled ? 'translate-x-6' : 'translate-x-1'}"
            ></span>
          </button>
        </form>
      </div>
    {/each}
  </div>
</div>
