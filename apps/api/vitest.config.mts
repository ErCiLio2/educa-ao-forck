import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/integration/**', 'node_modules/**'],
    setupFiles: ['test/setup.ts'],
    // Valores fictícios: os testes de segregação nunca chegam à BD, Redis ou S3
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://x:x@127.0.0.1:1/x',
      DIRECT_URL: 'postgresql://x:x@127.0.0.1:1/x',
      REDIS_URL: 'redis://127.0.0.1:1',
      ACCESS_TOKEN_SECRET: 'test-access-secret-0123456789abcdef0123',
      REFRESH_TOKEN_SECRET: 'test-refresh-secret-0123456789abcdef012',
      MFA_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      SANDBOX_WEBHOOK_SECRET: 'test-payment-webhook-secret-0123456789ab',
      S3_ENDPOINT: 'http://127.0.0.1:1',
      S3_BUCKET: 'test-bucket',
      S3_ACCESS_KEY: 'x',
      S3_SECRET_KEY: 'x',
    },
  },
});
