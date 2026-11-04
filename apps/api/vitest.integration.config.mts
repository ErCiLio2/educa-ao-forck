import { defineConfig } from 'vitest/config';

// Testes de integração: exigem Postgres (migrado), Redis e S3/MinIO a correr.
// Variáveis vêm do ambiente (CI) ou do apps/api/.env (local).
export default defineConfig({
  test: {
    include: ['test/integration/**/*.int.test.ts'],
    globalSetup: ['test/integration/global-setup.ts'],
    env: { NODE_ENV: 'test' },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
