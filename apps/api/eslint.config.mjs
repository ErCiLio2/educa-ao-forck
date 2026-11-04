import { readdirSync } from 'node:fs';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Fronteiras de módulo (RNF-MAN-01, ATB-R1 2.1)
// A superfície pública de um módulo é apenas `<modulo>.service.ts` e `<modulo>.middleware.ts`.
// Tudo o resto (controller, routes, types) é interno. Módulos novos em src/modules/ entram automaticamente.
const modules = readdirSync('src/modules', { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

const MSG_INTERNAL =
  'Um módulo só pode importar o *.service ou *.middleware de outro módulo (RNF-MAN-01).';

const crossModulePatterns = (self) =>
  modules
    .filter((m) => m !== self)
    .map((other) => ({
      group: [`../${other}/*`, `!../${other}/*.service`, `!../${other}/*.middleware`],
      message: MSG_INTERNAL,
    }));

const layering = [
  { group: ['**/shared/core/database'], message: 'Aceda à BD apenas a partir do *.service (camadas).' },
];

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'prisma/**', 'vitest.config.mts', 'eslint.config.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // shared/ é a base: nunca depende de módulos
  {
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['**/modules/**'], message: 'shared/ não pode depender de módulos.' }] },
      ],
    },
  },

  ...modules.flatMap((self) => [
    // 1. módulo → outro módulo: só pelo service/middleware
    {
      files: [`src/modules/${self}/**/*.ts`],
      rules: {
        'no-restricted-imports': ['error', { patterns: crossModulePatterns(self) }],
      },
    },
    // 2. camadas: controllers, rotas e middlewares não acedem à BD
    {
      files: [
        `src/modules/${self}/**/*.controller.ts`,
        `src/modules/${self}/**/*.routes.ts`,
        `src/modules/${self}/**/*.middleware.ts`,
      ],
      rules: {
        'no-restricted-imports': ['error', { patterns: [...crossModulePatterns(self), ...layering] }],
      },
    },
  ]),
);
