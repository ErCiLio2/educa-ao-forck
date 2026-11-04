<script lang="ts">
  import Sidebar from '$lib/components/Sidebar.svelte';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
</script>

<div class="flex h-screen bg-background overflow-hidden">
  <Sidebar user={data.user} />

  <main class="flex-1 overflow-y-auto">
    {@render children()}
  </main>
</div>
