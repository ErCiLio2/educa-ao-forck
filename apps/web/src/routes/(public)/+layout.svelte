<script lang="ts">
  import Navbar from '$lib/components/Navbar.svelte';
  import Logo from '$lib/components/Logo.svelte';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
</script>

<div class="min-h-screen flex flex-col">
  <Navbar user={data.user} />

  <main class="flex-1">
    {@render children()}
  </main>

  <footer class="bg-foreground text-white">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-8">
        <div class="col-span-2 md:col-span-1">
          <Logo size="sm" scheme="auto" />
          <p class="mt-3 text-sm text-white/50 max-w-xs">
            Explicações online com os melhores tutores de Angola.
          </p>
        </div>
        <div>
          <h3 class="text-[10px] font-semibold uppercase tracking-widest text-white/35 mb-3">Para alunos</h3>
          <ul class="space-y-2">
            <li><a href="/explorar" class="text-sm text-white/60 hover:text-white transition-colors">Explorar tutores</a></li>
            <li><a href="/explorar?tipo=grupo" class="text-sm text-white/60 hover:text-white transition-colors">Turmas de grupo</a></li>
            <li><a href="/#como-funciona" class="text-sm text-white/60 hover:text-white transition-colors">Como funciona</a></li>
          </ul>
        </div>
        <div>
          <h3 class="text-[10px] font-semibold uppercase tracking-widest text-white/35 mb-3">Para tutores</h3>
          <ul class="space-y-2">
            <li><a href="/registar?papel=tutor" class="text-sm text-white/60 hover:text-white transition-colors">Tornar-me tutor</a></li>
            <li><a href="/registar?papel=tutor" class="text-sm text-white/60 hover:text-white transition-colors">Verificação</a></li>
          </ul>
        </div>
        <div>
          <h3 class="text-[10px] font-semibold uppercase tracking-widest text-white/35 mb-3">Ajuda</h3>
          <ul class="space-y-2">
            <li><a href="#" class="text-sm text-white/60 hover:text-white transition-colors">Termos e condições</a></li>
            <li><a href="#" class="text-sm text-white/60 hover:text-white transition-colors">Política de privacidade</a></li>
            <li><a href="#" class="text-sm text-white/60 hover:text-white transition-colors">Contactos</a></li>
          </ul>
        </div>
      </div>
      <div class="mt-10 pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3">
        <p class="text-xs text-white/30">© 2024 eDuca. Todos os direitos reservados.</p>
        <p class="text-xs text-white/30">Pagamentos via Multicaixa · PayPay · Unitel Money</p>
      </div>
    </div>
  </footer>
</div>
