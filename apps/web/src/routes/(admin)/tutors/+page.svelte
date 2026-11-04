<script lang="ts">
  import { enhance } from '$app/forms';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let rejectId = $state<string | null>(null);
  let rejectReason = $state('');
  let loading = $state(false);

  function openReject(id: string) {
    rejectId = id;
    rejectReason = '';
  }

  function closeReject() {
    rejectId = null;
    rejectReason = '';
  }

  const totalPages = $derived(Math.ceil(data.total / data.limit));
</script>

<svelte:head><title>Tutores Pendentes — eDuca Admin</title></svelte:head>

<div class="p-8">
  <div class="mb-6">
    <h1 class="text-2xl font-bold text-gray-900">Tutores Pendentes</h1>
    <p class="text-sm text-gray-500 mt-1">{data.total} tutor{data.total === 1 ? '' : 'es'} por rever</p>
  </div>

  {#if form && 'error' in form && form.error}
    <div class="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{form.error}</div>
  {/if}

  {#if data.tutors.length === 0}
    <div class="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500">
      Nenhum tutor pendente de revisão.
    </div>
  {:else}
    <div class="space-y-4">
      {#each data.tutors as tutor (tutor.id)}
        <div class="bg-white rounded-xl border border-gray-200 p-6">
          <div class="flex items-start justify-between gap-4">
            <div class="flex-1 min-w-0">
              <p class="font-semibold text-gray-900">{tutor.user.name}</p>
              <p class="text-sm text-gray-500">{tutor.user.email}</p>
              {#if tutor.bio}
                <p class="text-sm text-gray-600 mt-2">{tutor.bio}</p>
              {/if}
              {#if tutor.subjects.length > 0}
                <div class="flex flex-wrap gap-1.5 mt-2">
                  {#each tutor.subjects as s}
                    <span class="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full">{s}</span>
                  {/each}
                </div>
              {/if}

              <!-- Documentos -->
              <div class="flex flex-wrap gap-3 mt-3">
                {#each [
                  { key: 'diploma',        label: 'Diploma'           },
                  { key: 'criminalRecord', label: 'Registo criminal'  },
                  { key: 'passportPhoto',  label: 'Passaporte'        },
                  { key: 'videoIntro',     label: 'Vídeo'             },
                ] as doc}
                  {#if tutor.documents[doc.key]}
                    <a
                      href={tutor.documents[doc.key]}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-sm text-blue-600 hover:text-blue-800 underline"
                    >{doc.label}</a>
                  {:else}
                    <span class="text-sm text-gray-400">{doc.label}: —</span>
                  {/if}
                {/each}
              </div>
            </div>

            <div class="flex gap-2 flex-shrink-0">
              <!-- Aprovar -->
              <form
                method="POST"
                action="?/review"
                use:enhance={() => {
                  loading = true;
                  return async ({ update }) => { loading = false; update(); };
                }}
              >
                <input type="hidden" name="id" value={tutor.id} />
                <input type="hidden" name="status" value="APPROVED" />
                <button
                  type="submit"
                  disabled={loading}
                  class="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Aprovar
                </button>
              </form>

              <!-- Rejeitar (abre modal) -->
              <button
                type="button"
                onclick={() => openReject(tutor.id)}
                class="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-700 text-sm font-medium rounded-lg border border-red-200 transition-colors"
              >
                Rejeitar
              </button>
            </div>
          </div>
        </div>
      {/each}
    </div>

    <!-- Paginação -->
    {#if totalPages > 1}
      <div class="flex justify-center gap-2 mt-6">
        {#each Array.from({ length: totalPages }, (_, i) => i + 1) as p}
          <a
            href="?page={p}"
            class="px-3 py-1.5 rounded-lg text-sm font-medium {p === data.page
              ? 'bg-blue-600 text-white'
              : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'}"
          >{p}</a>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<!-- Modal de rejeição -->
{#if rejectId}
  <div class="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
    <div class="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
      <h3 class="text-lg font-semibold text-gray-900 mb-4">Rejeitar tutor</h3>

      <form
        method="POST"
        action="?/review"
        use:enhance={() => {
          loading = true;
          return async ({ update }) => { loading = false; closeReject(); update(); };
        }}
      >
        <input type="hidden" name="id" value={rejectId} />
        <input type="hidden" name="status" value="REJECTED" />

        <label class="block text-sm font-medium text-gray-700 mb-1">
          Motivo da rejeição <span class="text-red-500">*</span>
        </label>
        <textarea
          name="reason"
          bind:value={rejectReason}
          rows="3"
          required
          class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
          placeholder="Descreva o motivo da rejeição…"
        ></textarea>

        <div class="flex gap-3 mt-4">
          <button
            type="button"
            onclick={closeReject}
            class="flex-1 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading || !rejectReason.trim()}
            class="flex-1 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {loading ? 'A rejeitar…' : 'Confirmar rejeição'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}
