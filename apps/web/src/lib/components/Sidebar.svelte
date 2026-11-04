<script lang="ts">
  import { page } from '$app/state';
  import Icon from '@iconify/svelte';
  import Logo from './Logo.svelte';
  import Avatar from './ui/Avatar.svelte';
  import { cn } from '$lib/utils';

  type NavItem = {
    href: string;
    label: string;
    icon: string;
    badge?: number;
  };

  type NavGroup = {
    label: string;
    items: NavItem[];
  };

  const groups: NavGroup[] = [
    {
      label: 'Geral',
      items: [
        { href: '/dashboard', label: 'Dashboard', icon: 'solar:widget-4-linear' },
      ],
    },
    {
      label: 'Gestão',
      items: [
        { href: '/tutors',       label: 'Tutores',       icon: 'solar:users-group-rounded-linear' },
        { href: '/users',        label: 'Utilizadores',  icon: 'solar:user-linear'               },
        { href: '/role-changes', label: 'Alt. de papel', icon: 'solar:refresh-circle-linear'     },
        { href: '/payments',     label: 'Pagamentos',    icon: 'solar:wallet-2-linear'           },
      ],
    },
    {
      label: 'Configuração',
      items: [
        { href: '/notifications', label: 'Notificações',       icon: 'solar:bell-linear'         },
        { href: '/contents',      label: 'Conteúdos',          icon: 'solar:library-linear'       },
        { href: '/audit',         label: 'Auditoria',          icon: 'solar:shield-warning-linear'},
      ],
    },
  ];

  let {
    user,
    pendingTutors = 0,
  }: {
    user: { name: string; email: string; role?: string };
    pendingTutors?: number;
  } = $props();

  function isActive(href: string): boolean {
    return page.url.pathname === href || (href !== '/dashboard' && page.url.pathname.startsWith(href));
  }

  function badgeFor(href: string): number {
    if (href === '/tutors') return pendingTutors;
    return 0;
  }
</script>

<aside class="w-56 flex-shrink-0 flex flex-col h-screen bg-foreground text-primary-foreground">
  <!-- Logo -->
  <div class="px-5 py-5 border-b border-white/10">
    <Logo size="sm" scheme="auto" />
  </div>

  <!-- Navegação -->
  <nav class="flex-1 px-3 py-4 overflow-y-auto space-y-5">
    {#each groups as group}
      <div>
        <p class="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/35">
          {group.label}
        </p>
        <ul class="space-y-0.5">
          {#each group.items as item}
            {@const active = isActive(item.href)}
            {@const badge = badgeFor(item.href)}
            <li>
              <a
                href={item.href}
                class={cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  active
                    ? 'bg-accent text-accent-foreground'
                    : 'text-white/65 hover:bg-white/8 hover:text-white',
                )}
              >
                <Icon icon={item.icon} width="17" class="shrink-0" />
                <span class="flex-1 truncate">{item.label}</span>
                {#if badge > 0}
                  <span class="min-w-5 h-5 flex items-center justify-center rounded-full bg-accent text-accent-foreground text-[10px] font-bold px-1.5
                    {active ? 'bg-foreground text-primary-foreground' : ''}">
                    {badge}
                  </span>
                {/if}
              </a>
            </li>
          {/each}
        </ul>
      </div>
    {/each}
  </nav>

  <!-- Utilizador + logout -->
  <div class="px-3 py-4 border-t border-white/10 space-y-1">
    <div class="flex items-center gap-2.5 px-3 py-2 rounded-lg">
      <Avatar name={user.name} size="sm" />
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-white truncate">{user.name}</p>
        <p class="text-[10px] text-white/40 truncate">{user.role ?? 'Administrador'}</p>
      </div>
    </div>
    <form method="POST" action="/logout">
      <button
        type="submit"
        class="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-white/55 hover:bg-white/8 hover:text-white transition-colors"
      >
        <Icon icon="solar:logout-linear" width="17" class="shrink-0" />
        Terminar sessão
      </button>
    </form>
  </div>
</aside>
