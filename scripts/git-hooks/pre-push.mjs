import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pushesToProtected, pushesToForeignPersonal, PERSONAL_BRANCH_PR_TARGET } from './lib.mjs';

// Corre antes de cada push.
// Regra implícita do fluxo de branches: branch-particular → api|web|mobile → dev → main
// Nenhuma branch protegida aceita push directo — o trabalho entra sempre por Pull Request.
// A protecção real é a do GitHub (ver CONTRIBUTING.md); isto apanha o engano antes de sair da máquina.
const lines = readFileSync(0, 'utf8').split('\n').filter(Boolean);
if (lines.length === 0) process.exit(0); // nada a enviar (ex.: só tags apagadas)

// 1. Branches de integração — bloqueiam push directo
const target = pushesToProtected(lines);
if (target && !process.env.ALLOW_PUSH_PROTECTED) {
  const hints = {
    main:   'só `dev` mergeia para `main` (via Pull Request).',
    dev:    'só `api`, `web` ou `mobile` mergeiam para `dev` (via Pull Request).',
    api:    'crie uma branch (feat/…, fix/…) a partir de `api` e abra um Pull Request para `api`.',
    web:    'crie uma branch (feat/…, fix/…) a partir de `web` e abra um Pull Request para `web`.',
    mobile: 'crie uma branch (feat/…, fix/…) a partir de `mobile` e abra um Pull Request para `mobile`.',
  };
  console.error(`\n✖ Push directo para \`${target}\` bloqueado: ${hints[target]}`);
  console.error('  (emergência: ALLOW_PUSH_PROTECTED=1 git push — fica a cargo de quem o faz)\n');
  process.exit(1);
}

// 2. Branches pessoais — só o dono pode fazer push directamente
// (cada developer tem controlo total sobre a sua branch; a branch serve de mini-integração pessoal)
const ghResult = spawnSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8' });
const currentUser = ghResult.status === 0 ? ghResult.stdout.trim() : null;

const foreign = pushesToForeignPersonal(lines, currentUser);
if (foreign) {
  if (!currentUser) {
    console.error(`\n✖ A branch \`${foreign.branch}\` é pessoal (pertence a @${foreign.owner}).`);
    console.error('  Não foi possível verificar a sua identidade GitHub (gh CLI não autenticado?).');
    console.error('  Autentique-se com: gh auth login\n');
  } else {
    console.error(`\n✖ A branch \`${foreign.branch}\` pertence a @${foreign.owner}.`);
    console.error(`  O seu utilizador GitHub é @${currentUser}.`);
    console.error('  Cada developer só pode fazer push para a sua própria branch pessoal.');
    console.error('  Para contribuir, crie uma branch provisória e abra um PR para a branch do colega.\n');
  }
  process.exit(1);
}

// 3. Lembrete de branch-alvo para branches pessoais com restrição
for (const line of lines) {
  const ref = line.trim().split(/\s+/)[2] ?? '';
  const match = ref.match(/^refs\/heads\/(.+)$/);
  if (!match) continue;
  const target = PERSONAL_BRANCH_PR_TARGET.get(match[1]);
  if (target) {
    console.info(`\nℹ  Ao abrir o PR de \`${match[1]}\`, o destino obrigatório é \`${target}\`.`);
    console.info('   PRs para outro destino são recusados pelo CI.\n');
  }
}

// 4. Typecheck e testes unitários
try {
  execFileSync('pnpm', ['typecheck'], { stdio: 'inherit' });
  execFileSync('pnpm', ['test'], { stdio: 'inherit' });
} catch {
  console.error('\n✖ Tipos ou testes unitários falharam: corrija antes de enviar.');
  process.exit(1);
}
