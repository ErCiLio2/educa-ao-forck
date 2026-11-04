<script lang="ts">
  import { cn, avatarColor, initials } from '$lib/utils';

  type Props = {
    name: string;
    src?: string | null;
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    class?: string;
  };

  const sizeClass = {
    xs: 'size-6  text-[10px]',
    sm: 'size-8  text-xs',
    md: 'size-9  text-sm',
    lg: 'size-11 text-base',
    xl: 'size-14 text-lg',
  };

  let { name, src, size = 'md', class: className }: Props = $props();
</script>

<span
  class={cn(
    'inline-flex shrink-0 items-center justify-center rounded-pill font-semibold overflow-hidden',
    sizeClass[size],
    !src && avatarColor(name),
    className,
  )}
  aria-label={name}
  title={name}
>
  {#if src}
    <img src={src} alt={name} class="size-full object-cover" />
  {:else}
    {initials(name)}
  {/if}
</span>
