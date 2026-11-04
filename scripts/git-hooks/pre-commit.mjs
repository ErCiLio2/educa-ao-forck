import { execFileSync } from 'node:child_process';

import { findProblems, schemaWithoutMigration } from './lib.mjs';

// Corre antes de cada commit. Mantém-se rápido: só olha para o que está em stage.
// Usa -z para separação por NUL: evita problemas com nomes de ficheiro que contêm caracteres não-ASCII.
const git = (...args) => execFileSync('git', ['-c', 'core.quotePath=false', ...args], { encoding: 'utf8' });
const listZ = (...args) => execFileSync('git', ['-c', 'core.quotePath=false', ...args, '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);

const staged = listZ('diff', '--cached', '--name-only', '--diff-filter=ACMR');
const added = listZ('diff', '--cached', '--name-only', '--diff-filter=A');
if (staged.length === 0) process.exit(0);

const fail = (title, lines) => {
  console.error(`\n✖ ${title}`);
  for (const l of lines) console.error(`  - ${l}`);
  process.exit(1);
};

// 1. Ficheiros proibidos, segredos e tamanho (olha para o conteúdo em stage, não para o disco)
const files = staged.map((path) => {
  const size = Number(git('cat-file', '-s', `:${path}`).trim());
  const text = size < 512 * 1024 ? git('show', `:${path}`) : null;
  return { path, size, text: text !== null && !text.includes('\u0000') ? text : null };
});
const problems = findProblems(files);
if (problems.length) fail('Ficheiros que não podem entrar no repositório:', problems);

// 2. Schema sem migração
if (schemaWithoutMigration(staged, added) && !process.env.SKIP_MIGRATION_CHECK) {
  fail('apps/api/prisma/schema.prisma mudou sem uma migração em stage', [
    'crie a migração (prisma/migrations/<data>_<nome>/migration.sql), aditiva e reversível (RNF-DIS-01)',
    'ou SKIP_MIGRATION_CHECK=1 se a alteração for só um comentário',
  ]);
}

// 3. Lint dos ficheiros TypeScript da API em stage
const apiTs = staged.filter((p) => /^apps\/api\/src\/.*\.(ts|mts)$/.test(p) && !p.endsWith('.d.ts'));
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });
if (apiTs.length) {
  try {
    run('pnpm', ['--filter', 'educa-api', 'exec', 'eslint', '--max-warnings', '0', ...apiTs.map((p) => p.replace(/^apps\/api\//, ''))]);
  } catch {
    fail('ESLint falhou (inclui as fronteiras de módulo, RNF-MAN-01)', ['corrija os erros acima antes de fazer commit']);
  }
}

// 4. Contrato OpenAPI actualizado quando a API muda
if (staged.some((p) => /^apps\/api\/(src|prisma)\//.test(p))) {
  try {
    execFileSync('pnpm', ['--filter', 'educa-api', 'openapi:check'], { stdio: 'pipe' });
  } catch {
    fail('O contrato OpenAPI está desactualizado', ['corra "pnpm contract:build" e junte apps/api/openapi.json e packages/api-types ao commit']);
  }
}
