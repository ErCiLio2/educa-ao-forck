import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { findProblems, forbiddenPathReason, findSecret, pushesToMain, pushesToProtected, schemaWithoutMigration, personalBranchOwner, pushesToForeignPersonal, PERSONAL_BRANCH_PR_TARGET, exclusiveAuthorViolation, integrationBaseViolation } from './lib.mjs';

test('ficheiros proibidos', () => {
  const bad = ['.env', 'apps/api/.env', 'apps/api/.env.local', 'apps/api/.env.production', 'docs/levantamento.pdf', 'x/y.DOCX',
    '.vscode/settings.json', 'apps/web/.svelte-kit/x.js', 'apps/api/dist/server.js', 'node_modules/a/b.js', 'server.pem', 'deploy.key',
    'home/id_rsa', 'npm-debug.log', '.DS_Store'];
  for (const p of bad) assert.ok(forbiddenPathReason(p), `devia proibir ${p}`);

  const ok = ['apps/api/.env.example', '.env.example', 'docs/arquitectura-tecnica-base-educa.md', 'apps/api/src/app.ts',
    'apps/api/openapi.json', 'pnpm-lock.yaml', '.github/workflows/ci.yml', 'apps/api/prisma/migrations/x/migration.sql',
    'apps/api/src/shared/core/env.ts', 'envelope.ts', 'packages/api-types/index.d.ts'];
  for (const p of ok) assert.equal(forbiddenPathReason(p), null, `não devia proibir ${p}`);
});

test('segredos com formato inconfundível', () => {
  const fake = (parts) => parts.join('');
  assert.ok(findSecret(fake(['-----BEGIN RSA PRIV', 'ATE KEY-----\nabc'])));
  assert.ok(findSecret(fake(['-----BEGIN OPENSSH PRIV', 'ATE KEY-----'])));
  assert.ok(findSecret(fake(['AK', 'IA', '1234567890ABCDEF'])));
  assert.ok(findSecret(fake(['ghp_', 'a'.repeat(36)])));
  assert.ok(findSecret(fake(['xox', 'b-', '1234567890-abcdefghij'])));
  // sem falsos positivos em código normal
  assert.equal(findSecret('const PASSWORD = "Abcdefg1"; // fixture de teste'), null);
  assert.equal(findSecret('ACCESS_TOKEN_SECRET="CHANGE_ME_32_CHARS_MIN_ACCESS_SECRET"'), null);
  assert.equal(findSecret('-----BEGIN PUBLIC KEY-----'), null);
  assert.equal(findSecret('AKIA curto'), null);
});

test('findProblems: caminho, tamanho e conteúdo', () => {
  const MB = 1024 * 1024;
  const problems = findProblems([
    { path: 'docs/cliente.pdf', size: 10, text: null },
    { path: 'big.bin', size: 2 * MB, text: null },
    { path: 'pnpm-lock.yaml', size: 2 * MB, text: null }, // isento
    { path: 'apps/api/src/x.ts', size: 50, text: `const k = "${['AK', 'IA'].join('')}ABCDEFGHIJKLMNOP"` },
    { path: 'apps/api/src/ok.ts', size: 50, text: 'export const ok = 1' },
    { path: 'scripts/git-hooks/lib.mjs', size: 50, text: `${['AK', 'IA'].join('')}ABCDEFGHIJKLMNOP` }, // descreve os padrões
  ]);
  assert.equal(problems.length, 3);
  assert.match(problems.join('\n'), /pdf/);
  assert.match(problems.join('\n'), /big\.bin: 2\.0 MB/);
  assert.match(problems.join('\n'), /x\.ts: contém chave de acesso AWS/);
});

test('schema Prisma sem migração', () => {
  const schema = 'apps/api/prisma/schema.prisma';
  const migration = 'apps/api/prisma/migrations/20261013_x/migration.sql';
  assert.equal(schemaWithoutMigration([schema], []), true);
  assert.equal(schemaWithoutMigration([schema, migration], [migration]), false);
  assert.equal(schemaWithoutMigration(['apps/api/src/app.ts'], []), false);
  // alterar uma migração antiga não conta como migração nova
  assert.equal(schemaWithoutMigration([schema, migration], []), true);
});

test('push para branches protegidas', () => {
  // pushesToProtected detecta qualquer branch protegida como destino (3.º campo da linha stdin)
  assert.equal(pushesToProtected(['abc def refs/heads/main ghi']), 'main');
  assert.equal(pushesToProtected(['abc def refs/heads/dev ghi']), 'dev');
  assert.equal(pushesToProtected(['abc def refs/heads/api ghi']), 'api');
  assert.equal(pushesToProtected(['abc def refs/heads/web ghi']), 'web');
  assert.equal(pushesToProtected(['abc def refs/heads/mobile ghi']), 'mobile');
  // branch de trabalho como destino — permitida
  assert.equal(pushesToProtected(['abc def refs/heads/feat/x ghi']), null);
  assert.equal(pushesToProtected(['abc def refs/heads/fix/auth ghi']), null);
  // a branch de origem (2.º campo) não conta
  assert.equal(pushesToProtected(['abc refs/heads/main refs/heads/feat/x def']), null);
  assert.equal(pushesToProtected([]), null);

  // pushesToMain mantém retrocompatibilidade
  assert.equal(pushesToMain(['abc def refs/heads/main ghi']), true);
  assert.equal(pushesToMain(['abc def refs/heads/dev ghi']), false);
  assert.equal(pushesToMain([]), false);
});

test('branches pessoais — dono e restrição de push cruzado', () => {
  // personalBranchOwner
  assert.equal(personalBranchOwner('ercilio'), 'ErCiLio2');
  assert.equal(personalBranchOwner('josias'),  'Josias-tech189');
  assert.equal(personalBranchOwner('yoane'),   'YDNeves');
  assert.equal(personalBranchOwner('feat/x'),  null);
  assert.equal(personalBranchOwner('dev'),     null);

  // pushesToForeignPersonal — dono a fazer push para a sua branch: permitido
  assert.equal(pushesToForeignPersonal(['abc def refs/heads/josias ghi'], 'Josias-tech189'), null);
  assert.equal(pushesToForeignPersonal(['abc def refs/heads/yoane ghi'],  'YDNeves'),       null);
  assert.equal(pushesToForeignPersonal(['abc def refs/heads/ercilio ghi'], 'ErCiLio2'),     null);

  // outro utilizador a tentar fazer push para branch alheia: bloqueado
  const blocked = pushesToForeignPersonal(['abc def refs/heads/josias ghi'], 'YDNeves');
  assert.ok(blocked, 'devia bloquear push cruzado');
  assert.equal(blocked.branch, 'josias');
  assert.equal(blocked.owner,  'Josias-tech189');

  // branch de trabalho normal — não é pessoal, passa sempre
  assert.equal(pushesToForeignPersonal(['abc def refs/heads/feat/x ghi'], 'qualquer'), null);

  // gh CLI não disponível (currentUser=null) — bloquear por precaução
  const blockedNull = pushesToForeignPersonal(['abc def refs/heads/josias ghi'], null);
  assert.ok(blockedNull, 'sem identidade deve bloquear push para branch pessoal');
});

test('branch-alvo de PRs de branches pessoais', () => {
  // josias e yoane só podem abrir PR para web
  assert.equal(PERSONAL_BRANCH_PR_TARGET.get('josias'), 'web');
  assert.equal(PERSONAL_BRANCH_PR_TARGET.get('yoane'),  'web');
  // ercilio não tem restrição
  assert.equal(PERSONAL_BRANCH_PR_TARGET.get('ercilio'), null);
  // branches de trabalho normais não estão no mapa
  assert.equal(PERSONAL_BRANCH_PR_TARGET.get('feat/x'), undefined);
});

test('api e mobile são exclusivas de ErCiLio2', () => {
  // autor correcto — sem violação
  assert.equal(exclusiveAuthorViolation('api',    'ErCiLio2'), null);
  assert.equal(exclusiveAuthorViolation('mobile', 'ErCiLio2'), null);

  // outro autor — devolve o utilizador exclusivo
  assert.equal(exclusiveAuthorViolation('api',    'Josias-tech189'), 'ErCiLio2');
  assert.equal(exclusiveAuthorViolation('mobile', 'YDNeves'),        'ErCiLio2');

  // web não tem restrição de autor
  assert.equal(exclusiveAuthorViolation('web',    'Josias-tech189'), null);

  // dev é exclusiva de ErCiLio2
  assert.equal(exclusiveAuthorViolation('dev',    'ErCiLio2'),       null);
  assert.equal(exclusiveAuthorViolation('dev',    'YDNeves'),        'ErCiLio2');
  assert.equal(exclusiveAuthorViolation('dev',    'Josias-tech189'), 'ErCiLio2');

  // main é exclusiva de ErCiLio2
  assert.equal(exclusiveAuthorViolation('main',   'ErCiLio2'),       null);
  assert.equal(exclusiveAuthorViolation('main',   'Josias-tech189'), 'ErCiLio2');
  assert.equal(exclusiveAuthorViolation('main',   'YDNeves'),        'ErCiLio2');

  // branch não mapeada — sem restrição
  assert.equal(exclusiveAuthorViolation('feat/x', 'alguem'), null);
});

test('api/web/mobile só podem mergiar para dev; dev só para main', () => {
  // roteamento correcto — sem violação
  assert.equal(integrationBaseViolation('api',    'dev'),  null);
  assert.equal(integrationBaseViolation('web',    'dev'),  null);
  assert.equal(integrationBaseViolation('mobile', 'dev'),  null);
  assert.equal(integrationBaseViolation('dev',    'main'), null);

  // destino errado — devolve o destino obrigatório
  assert.equal(integrationBaseViolation('api',    'main'), 'dev');
  assert.equal(integrationBaseViolation('web',    'main'), 'dev');
  assert.equal(integrationBaseViolation('mobile', 'main'), 'dev');
  assert.equal(integrationBaseViolation('api',    'web'),  'dev');
  assert.equal(integrationBaseViolation('dev',    'api'),  'main');

  // branches de trabalho ou pessoais — não mapeadas, sem violação
  assert.equal(integrationBaseViolation('feat/x',   'dev'),  null);
  assert.equal(integrationBaseViolation('ercilio',  'api'),  null);
});

// ── commitlint: corre a configuração a sério (a mesma do hook e do CI) ───────
// Chama o binário directamente (o arranque do `pnpm exec` custa ~1 s por mensagem)
const root = new URL('../../', import.meta.url);
const cli = fileURLToPath(new URL('node_modules/@commitlint/cli/cli.js', root));
const lint = (message) => spawnSync(process.execPath, [cli], { input: message, encoding: 'utf8', cwd: root });

test('mensagens de commit válidas', () => {
  for (const msg of [
    'feat(auth): rotação atómica do refresh token',
    'fix(bookings,payments): corrigir o débito de horas em concorrência',
    'docs: actualizar o README',
    'chore(deps): actualizar o Prisma',
    'refactor: converter para monorepo pnpm (API em apps/api)',
    'feat(api): contrato OpenAPI gerado do código\n\n- corpo em lista\n- outra linha',
    'docs(repo): descrever o ficheiro CLAUDE.md', // mencionar o ficheiro não é assinar
  ]) {
    const r = lint(msg);
    assert.equal(r.status, 0, `devia aceitar: ${msg}\n${r.stdout}${r.stderr}`);
  }
});

test('mensagens de commit inválidas', () => {
  const cases = [
    ['correcções várias', 'sem tipo'],
    ['Feat(auth): x', 'tipo em maiúsculas'],
    ['feature(auth): x', 'tipo inexistente'],
    ['feat(autenticacao): x', 'âmbito fora da lista'],
    ['feat(auth): termina com ponto.', 'ponto final'],
    ['feat(auth):', 'sem resumo'],
    [`feat(auth): ${'x'.repeat(100)}`, 'cabeçalho demasiado longo'],
  ];
  for (const [msg, why] of cases) assert.notEqual(lint(msg).status, 0, `devia recusar (${why}): ${msg}`);
});

test('assinaturas de assistentes de IA são recusadas', () => {
  const sigs = [
    'feat(auth): x\n\nCo-Authored-By: Claude Sonnet <noreply@anthropic.com>',
    'feat(auth): x\n\nco-authored-by: Copilot <copilot@github.com>',
    'feat(auth): x\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)',
    'feat(auth): x\n\nSigned-off-by: Claude <x@y.z>',
    'feat(auth): x\n\nEste código foi AI-generated',
  ];
  for (const msg of sigs) {
    const r = lint(msg);
    assert.notEqual(r.status, 0, `devia recusar: ${msg}`);
    assert.match(r.stdout + r.stderr, /assinatura de assistentes/);
  }
  // mencionar as regras, o ficheiro ou um emoji isolado não é assinar
  for (const ok of [
    'docs(repo): descrever as regras\n\nO commitlint recusa Co-Authored-By de assistentes e o rodapé Generated with.',
    'docs(repo): descrever o ficheiro CLAUDE.md',
    'feat(auth): x\n\nUsa 🤖 como ícone do bot no chat',
  ]) assert.equal(lint(ok).status, 0, `devia aceitar: ${ok}`);
  // um co-autor humano continua permitido
  assert.equal(lint('feat(auth): x\n\nCo-Authored-By: Maria Silva <maria@exemplo.com>').status, 0);
});
