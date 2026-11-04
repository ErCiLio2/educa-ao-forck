<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLInputAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  type Props = {
    label?: string;
    error?: string | null;
    hint?: string;
    leading?: Snippet;
    trailing?: Snippet;
    class?: string;
    inputClass?: string;
  } & Omit<HTMLInputAttributes, 'class'>;

  let {
    label,
    error,
    hint,
    leading,
    trailing,
    class: className,
    inputClass,
    id,
    ...rest
  }: Props = $props();

  const inputId = id ?? `input-${Math.random().toString(36).slice(2)}`;
</script>

<div class={cn('flex flex-col gap-1.5', className)}>
  {#if label}
    <label for={inputId} class="text-sm font-medium text-foreground">
      {label}
      {#if rest.required}<span class="text-destructive ml-0.5">*</span>{/if}
    </label>
  {/if}

  <div class="relative flex items-center">
    {#if leading}
      <span class="absolute left-3 text-muted-foreground pointer-events-none">
        {@render leading()}
      </span>
    {/if}

    <input
      id={inputId}
      class={cn(
        'w-full rounded-lg border border-input bg-surface px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        error && 'border-destructive focus:ring-destructive',
        leading && 'pl-9',
        trailing && 'pr-9',
        inputClass,
      )}
      aria-invalid={error ? 'true' : undefined}
      aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
      {...rest}
    />

    {#if trailing}
      <span class="absolute right-3 text-muted-foreground pointer-events-none">
        {@render trailing()}
      </span>
    {/if}
  </div>

  {#if error}
    <p id="{inputId}-error" class="text-xs text-destructive">{error}</p>
  {:else if hint}
    <p id="{inputId}-hint" class="text-xs text-muted-foreground">{hint}</p>
  {/if}
</div>
