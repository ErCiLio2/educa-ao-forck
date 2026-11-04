import 'dotenv/config';
import { BucketAlreadyOwnedByYou, CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';

// Garante o bucket privado antes dos testes (idempotente)
export default async function setup() {
  const required = ['DATABASE_URL', 'DIRECT_URL', 'REDIS_URL', 'ACCESS_TOKEN_SECRET', 'REFRESH_TOKEN_SECRET', 'S3_BUCKET'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Variáveis em falta para testes de integração: ${missing.join(', ')}`);

  const s3 = new S3Client({
    region: process.env.S3_REGION ?? 'us-east-1',
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY! },
  });
  try {
    await s3.send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET! }));
  } catch (err) {
    if (!(err instanceof BucketAlreadyOwnedByYou) && (err as { name?: string }).name !== 'BucketAlreadyExists') throw err;
  }
}
