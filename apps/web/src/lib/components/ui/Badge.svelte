<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cva, type VariantProps } from 'class-variance-authority';
  import { cn } from '$lib/utils';

  const variants = cva(
    'inline-flex items-center gap-1 font-semibold rounded-pill whitespace-nowrap',
    {
      variants: {
        variant: {
          default:     'bg-muted text-muted-foreground',
          primary:     'bg-primary text-primary-foreground',
          accent:      'bg-accent text-accent-foreground',
          destructive: 'bg-destructive/10 text-destructive',
          mint:        'bg-tone-mint text-tone-mint-fg',
          lavender:    'bg-tone-lavender text-tone-lavender-fg',
          peach:       'bg-tone-peach text-tone-peach-fg',
          yellow:      'bg-tone-yellow text-tone-yellow-fg',
          success:     'bg-emerald-100 text-emerald-700',
          warning:     'bg-amber-100 text-amber-700',
          pending:     'bg-yellow-100 text-yellow-800',
          rejected:    'bg-red-100 text-red-700',
        },
        size: {
          sm: 'px-2 py-0.5 text-[10px]',
          md: 'px-2.5 py-1 text-xs',
          lg: 'px-3 py-1 text-sm',
        },
        dot: { true: '' },
      },
      defaultVariants: { variant: 'default', size: 'md' },
    },
  );

  type Props = VariantProps<typeof variants> & {
    class?: string;
    children?: Snippet;
  };

  let { variant, size, dot, class: className, children }: Props = $props();
</script>

<span class={cn(variants({ variant, size }), className)}>
  {#if dot}
    <span class="size-1.5 rounded-full bg-current"></span>
  {/if}
  {@render children?.()}
</span>
