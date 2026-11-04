import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Gera (ou, com --check, verifica) o contrato OpenAPI versionado em apps/api/openapi.json.
// Não liga à BD, ao Redis nem ao storage: os valores abaixo são só para a validação do ambiente passar.
// Uso: pnpm --filter educa-api openapi:generate   |   pnpm --filter educa-api openapi:check
const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://x:x@127.0.0.1:1/x',
  DIRECT_URL: 'postgresql://x:x@127.0.0.1:1/x',
  REDIS_URL: 'redis://127.0.0.1:1',
  ACCESS_TOKEN_SECRET: 'contract-access-secret-0123456789abcdef01',
  REFRESH_TOKEN_SECRET: 'contract-refresh-secret-0123456789abcdef0',
  MFA_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  SANDBOX_WEBHOOK_SECRET: 'contract-payment-webhook-secret-0123456789',
  S3_ENDPOINT: 'http://127.0.0.1:1',
  S3_BUCKET: 'contract',
  S3_ACCESS_KEY: 'x',
  S3_SECRET_KEY: 'x',
};
for (const [key, value] of Object.entries(defaults)) process.env[key] ??= value;
process.env.NODE_ENV = 'test'; // sem rate limit distribuído (não há Redis) e sem ligações

const target = fileURLToPath(new URL('../openapi.json', import.meta.url));

async function main() {
  const { buildApp } = await import('../src/app');
  const app = buildApp();
  await app.ready();
  const generated = `${JSON.stringify(app.swagger(), null, 2)}\n`;

  if (process.argv.includes('--check')) {
    let current = '';
    try {
      current = readFileSync(target, 'utf8');
    } catch {
      /* ficheiro em falta */
    }
    if (current !== generated) {
      console.error('openapi.json está desactualizado: corra "pnpm contract:build" e faça commit.');
      process.exit(1);
    }
    console.log('openapi.json está actualizado');
  } else {
    writeFileSync(target, generated);
    console.log(`openapi.json escrito (${Object.keys(JSON.parse(generated).paths).length} caminhos)`);
  }
  process.exit(0);
}

main();
