<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils';

  type Props = {
    class?: string;
    padding?: 'none' | 'sm' | 'md' | 'lg';
    children?: Snippet;
  };

  const paddings = { none: '', sm: 'p-4', md: 'p-5 sm:p-6', lg: 'p-6 sm:p-8' };

  let { class: className, padding = 'md', children }: Props = $props();
</script>

<div class={cn('bg-surface rounded-xl border border-border', paddings[padding], className)}>
  {@render children?.()}
</div>
