<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { cva, type VariantProps } from 'class-variance-authority';
  import { cn } from '$lib/utils';

  const variants = cva(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors select-none disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    {
      variants: {
        variant: {
          primary:     'bg-primary text-primary-foreground hover:bg-primary/85 active:bg-primary/75',
          accent:      'bg-accent text-accent-foreground hover:bg-accent/85 active:bg-accent/75',
          outline:     'border border-border bg-surface text-foreground hover:bg-muted active:bg-muted/70',
          ghost:       'text-foreground hover:bg-muted active:bg-muted/70',
          destructive: 'bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/20',
          link:        'text-foreground underline-offset-4 hover:underline p-0 h-auto',
        },
        size: {
          sm:   'h-8  px-3   text-xs  rounded-md',
          md:   'h-10 px-4   text-sm  rounded-lg',
          lg:   'h-11 px-5   text-sm  rounded-xl',
          xl:   'h-12 px-6   text-base rounded-xl',
          icon: 'size-9 rounded-lg',
        },
      },
      defaultVariants: { variant: 'primary', size: 'md' },
    },
  );

  type Props = VariantProps<typeof variants> & {
    class?: string;
    children?: Snippet;
  } & Omit<HTMLButtonAttributes, 'class'>;

  let { variant, size, class: className, children, ...rest }: Props = $props();
</script>

<button class={cn(variants({ variant, size }), className)} {...rest}>
  {@render children?.()}
</button>
