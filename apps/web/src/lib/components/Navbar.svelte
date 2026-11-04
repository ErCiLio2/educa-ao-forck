<script lang="ts">
  import { page } from '$app/state';
  import Icon from '@iconify/svelte';
  import Logo from './Logo.svelte';
  import { cn } from '$lib/utils';

  let {
    user = null,
    class: className,
  }: {
    user?: { name: string; role?: string } | null;
    class?: string;
  } = $props();

  let menuOpen = $state(false);

  const links = [
    { href: '/explorar', label: 'Explorar tutores' },
    { href: '/registar?papel=tutor', label: 'Tornar-me tutor' },
  ];

  function isActive(href: string) {
    const path = href.split('?')[0];
    return page.url.pathname === path || (path !== '/' && page.url.pathname.startsWith(path));
  }

  function roleHome(role?: string) {
    if (role === 'ADMIN') return '/dashboard';
    if (role === 'TUTOR') return '/tutor/painel';
    if (role === 'GUARDIAN') return '/encarregado/painel';
    return '/painel';
  }
</script>

<header class={cn('sticky top-0 z-50 bg-surface/95 backdrop-blur-sm border-b border-border', className)}>
  <nav class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <div class="h-16 flex items-center gap-4">
      <a href="/" class="flex-shrink-0">
        <Logo size="sm" scheme="color" />
      </a>

      <!-- Navegação desktop -->
      <div class="hidden md:flex items-center gap-1 flex-1">
        {#each links as link}
          <a
            href={link.href}
            class={cn(
              'px-3 py-2 text-sm font-medium rounded-lg transition-colors',
              isActive(link.href)
                ? 'text-foreground bg-muted'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
            )}
          >
            {link.label}
          </a>
        {/each}
      </div>

      <!-- Acções -->
      <div class="flex items-center gap-2 ml-auto">
        {#if user}
          <a
            href={roleHome(user.role)}
            class="h-9 px-4 inline-flex items-center text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/85 transition-colors"
          >
            <Icon icon="solar:widget-4-linear" width="15" class="mr-1.5 shrink-0" />
            Painel
          </a>
        {:else}
          <a
            href="/login"
            class="hidden sm:inline-flex h-9 px-4 items-center text-sm font-medium rounded-lg border border-border bg-surface text-foreground hover:bg-muted transition-colors"
          >
            Entrar
          </a>
          <a
            href="/registar"
            class="h-9 px-4 inline-flex items-center text-sm font-medium rounded-lg bg-accent text-accent-foreground hover:bg-accent/85 transition-colors"
          >
            Criar conta
          </a>
        {/if}

        <!-- Hamburger (mobile) -->
        <button
          onclick={() => (menuOpen = !menuOpen)}
          class="md:hidden h-9 w-9 inline-flex items-center justify-center rounded-lg hover:bg-muted transition-colors"
          aria-label="Menu"
          aria-expanded={menuOpen}
        >
          <Icon icon={menuOpen ? 'solar:close-circle-linear' : 'solar:hamburger-menu-linear'} width="20" />
        </button>
      </div>
    </div>

    <!-- Menu mobile -->
    {#if menuOpen}
      <div class="md:hidden pb-4 border-t border-border pt-3 space-y-1">
        {#each links as link}
          <a
            href={link.href}
            onclick={() => (menuOpen = false)}
            class="block px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
          >
            {link.label}
          </a>
        {/each}
        {#if !user}
          <a
            href="/login"
            onclick={() => (menuOpen = false)}
            class="block px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
          >
            Entrar
          </a>
          <a
            href="/registar"
            onclick={() => (menuOpen = false)}
            class="block px-3 py-2 text-sm font-medium bg-accent text-accent-foreground rounded-lg text-center"
          >
            Criar conta
          </a>
        {/if}
      </div>
    {/if}
  </nav>
</header>
