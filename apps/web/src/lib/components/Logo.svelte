<script lang="ts">
  import { cn } from '$lib/utils';

  type Props = {
    size?: 'sm' | 'md' | 'lg';
    showMark?: boolean;
    class?: string;
    /** 'auto' usa a cor do contexto (branco em fundo escuro via currentColor) */
    scheme?: 'color' | 'auto';
  };

  const textSizes = { sm: 'text-base', md: 'text-xl', lg: 'text-3xl' };
  const markSizes = { sm: 'size-5', md: 'size-7', lg: 'size-10' };

  let { size = 'md', showMark = true, class: className, scheme = 'color' }: Props = $props();

  const eColor = scheme === 'color' ? '#e5383b' : 'currentColor';
</script>

<span class={cn('inline-flex items-center gap-1.5 font-bold tracking-tight leading-none', textSizes[size], className)}>
  {#if showMark}
    <!-- Ícone eDuca — E+d estilizado -->
    <svg
      class={markSizes[size]}
      viewBox="0 0 180 180"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect width="180" height="180" rx="37" fill="#171717" />
      <g style="transform: scale(95%); transform-origin: center">
        <path
          fill="white"
          d="M101.141 53H136.632C151.023 53 162.689 64.666 162.689 79.057V112.904H148.112V79.057c0-.347-.014-.691-.04-1.032L112.581 112.898c.12.004.24.006.36.006H148.112V126.672H112.941C98.55 126.672 86.564 114.891 86.564 100.5V66.743H101.141V100.5c0 .65.05 1.292.148 1.922L137.56 66.782a13.5 13.5 0 00-.928-.039H101.141V53z"
        />
        <path
          fill="white"
          d="M65.293 124.136L14 66.737H34.636L64.75 100.436V66.737H80.137V118.47c0 7.808-9.642 11.488-14.844 5.666z"
        />
      </g>
    </svg>
  {/if}
  <span>
    <span style="color: {eColor}">e</span>Duca
  </span>
</span>
