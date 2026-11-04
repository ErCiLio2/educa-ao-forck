// Regras do repositório que se podem verificar automaticamente, sem dependências.
// Usadas pelo hook pre-commit, pelo CI (check-tracked.mjs) e testadas em rules.test.mjs.

// Ficheiros que nunca entram no repositório
const FORBIDDEN_PATHS = [
  [/(^|\/)\.env(\.|$)(?!example$)/, 'ficheiro de ambiente (só o .env.example é versionado)'],
  [/\.(pem|key|p12|pfx|jks)$/i, 'chave privada ou certificado'],
  [/(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/, 'chave SSH'],
  [/\.(pdf|docx?|xlsx?|pptx?)$/i, 'documento binário (os documentos do cliente ficam fora do Git; versionar o .md)'],
  [/(^|\/)(\.vscode|\.idea)\//, 'configuração pessoal do editor'],
  [/(^|\/)(node_modules|dist|build|coverage|\.svelte-kit)\//, 'artefacto de build ou dependências'],
  [/(^|\/)\.DS_Store$/, 'lixo do sistema'],
  [/\.log$/i, 'ficheiro de log'],
];

// Segredos com formato inconfundível (poucos falsos positivos). Não tenta adivinhar "passwords".
const SECRET_PATTERNS = [
  [/-----BEGIN (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY( BLOCK)?-----/, 'chave privada'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'chave de acesso AWS'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'token do GitHub'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, 'token do Slack'],
  [/\bsk_live_[A-Za-z0-9]{16,}\b/, 'chave live do Stripe'],
];

// Ficheiros gerados ou de lock que podem ser grandes
const SIZE_EXEMPT = new Set(['pnpm-lock.yaml', 'apps/api/openapi.json', 'packages/api-types/index.d.ts']);
export const MAX_FILE_BYTES = 1024 * 1024;

export function forbiddenPathReason(path) {
  const hit = FORBIDDEN_PATHS.find(([re]) => re.test(path));
  return hit ? hit[1] : null;
}

export function findSecret(text) {
  const hit = SECRET_PATTERNS.find(([re]) => re.test(text));
  return hit ? hit[1] : null;
}

/** @param {{ path: string, size: number, text: string | null }[]} files text=null para binários */
export function findProblems(files) {
  const problems = [];
  for (const { path, size, text } of files) {
    const forbidden = forbiddenPathReason(path);
    if (forbidden) {
      problems.push(`${path}: ${forbidden}`);
      continue;
    }
    if (size > MAX_FILE_BYTES && !SIZE_EXEMPT.has(path)) {
      problems.push(`${path}: ${(size / 1024 / 1024).toFixed(1)} MB (máximo ${MAX_FILE_BYTES / 1024 / 1024} MB)`);
    }
    // Este ficheiro descreve os padrões e testa-os: não se analisa a si próprio
    if (text !== null && !path.startsWith('scripts/git-hooks/')) {
      const secret = findSecret(text);
      if (secret) problems.push(`${path}: contém ${secret}`);
    }
  }
  return problems;
}

// Uma alteração ao schema Prisma sem migração deixa a BD e o código a divergir
export function schemaWithoutMigration(stagedPaths, addedPaths) {
  const schemaChanged = stagedPaths.includes('apps/api/prisma/schema.prisma');
  const migrationAdded = addedPaths.some((p) => /^apps\/api\/prisma\/migrations\/[^/]+\/migration\.sql$/.test(p));
  return schemaChanged && !migrationAdded;
}

// Branches protegidas: nenhum push directo é permitido (a protecção real é do GitHub; isto é a rede local)
// Fluxo obrigatório: branch-particular → api | web | mobile → dev → main
export const PROTECTED_BRANCHES = new Set(['main', 'dev', 'api', 'web', 'mobile']);

/** Devolve o nome da branch protegida que o push visa, ou null se nenhuma. */
export function pushesToProtected(stdinLines) {
  for (const line of stdinLines) {
    const ref = line.trim().split(/\s+/)[2] ?? '';
    const match = ref.match(/^refs\/heads\/(.+)$/);
    if (match && PROTECTED_BRANCHES.has(match[1])) return match[1];
  }
  return null;
}

/** Mantido por compatibilidade — preferir pushesToProtected. */
export function pushesToMain(stdinLines) {
  return pushesToProtected(stdinLines) === 'main';
}

// Branches pessoais: cada developer tem controlo total sobre a sua branch,
// mas nenhum outro pode fazer push para a branch de outra pessoa.
export const PERSONAL_BRANCH_OWNERS = new Map([
  ['ercilio', 'ErCiLio2'],
  ['josias',  'Josias-tech189'],
  ['yoane',   'YDNeves'],
]);

// Branch-alvo obrigatória para PRs de branches pessoais.
// null = sem restrição (qualquer branch de integração é válida).
export const PERSONAL_BRANCH_PR_TARGET = new Map([
  ['ercilio', null],
  ['josias',  'web'],
  ['yoane',   'web'],
]);

// Branches de integração exclusivas: só o utilizador listado pode abrir PR para elas.
// null = qualquer colaborador pode abrir PR.
export const INTEGRATION_BRANCH_EXCLUSIVE_AUTHOR = new Map([
  ['api',    'ErCiLio2'],
  ['mobile', 'ErCiLio2'],
  ['web',    null],
  ['dev',    'ErCiLio2'],
  ['main',   'ErCiLio2'],
]);

/**
 * Verifica se o autor do PR tem permissão para abrir PR para a branch-alvo.
 * Devolve o utilizador exclusivo se o autor não tiver permissão, null se for permitido.
 */
export function exclusiveAuthorViolation(baseBranch, prAuthor) {
  const exclusive = INTEGRATION_BRANCH_EXCLUSIVE_AUTHOR.get(baseBranch);
  if (exclusive && exclusive !== prAuthor) return exclusive;
  return null;
}

// Base obrigatória para PRs de branches de integração.
// api, web e mobile só podem mergiar para dev; dev só mergeia para main.
export const INTEGRATION_BRANCH_REQUIRED_BASE = new Map([
  ['api',    'dev'],
  ['web',    'dev'],
  ['mobile', 'dev'],
  ['dev',    'main'],
]);

/**
 * Devolve a base obrigatória se a branch de integração estiver a apontar para o sítio errado,
 * ou null se o roteamento estiver correcto.
 */
export function integrationBaseViolation(headBranch, baseBranch) {
  const required = INTEGRATION_BRANCH_REQUIRED_BASE.get(headBranch);
  if (required && baseBranch !== required) return required;
  return null;
}

/** Devolve o username GitHub do dono da branch pessoal, ou null se não for pessoal. */
export function personalBranchOwner(branchName) {
  return PERSONAL_BRANCH_OWNERS.get(branchName) ?? null;
}

/** Devolve o nome da branch pessoal alheia que o push visa, ou null se nenhuma. */
export function pushesToForeignPersonal(stdinLines, currentGithubUser) {
  for (const line of stdinLines) {
    const ref = line.trim().split(/\s+/)[2] ?? '';
    const match = ref.match(/^refs\/heads\/(.+)$/);
    if (!match) continue;
    const owner = personalBranchOwner(match[1]);
    if (owner && owner !== currentGithubUser) return { branch: match[1], owner };
  }
  return null;
}
