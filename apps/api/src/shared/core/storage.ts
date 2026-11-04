import {
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from './env';

// Bucket privado (RNF-SEG-03): o cliente nunca recebe credenciais, só URLs assinadas de curta duração.
export const s3 = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
});

const UPLOAD_TTL_SECONDS = 300;
const DOWNLOAD_TTL_SECONDS = 300;

// POST policy (e não PUT) porque permite impor o tamanho máximo e o Content-Type no próprio storage.
export async function presignUpload(key: string, contentType: string, maxBytes: number) {
  return createPresignedPost(s3, {
    Bucket: env.S3_BUCKET,
    Key: key,
    Fields: { 'Content-Type': contentType },
    Conditions: [
      ['content-length-range', 1, maxBytes],
      ['eq', '$Content-Type', contentType],
    ],
    Expires: UPLOAD_TTL_SECONDS,
  });
}

export function presignDownload(key: string): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }), {
    expiresIn: DOWNLOAD_TTL_SECONDS,
  });
}

export async function headObject(key: string) {
  try {
    const out = await s3.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    return { size: out.ContentLength ?? 0, contentType: out.ContentType ?? '' };
  } catch (err) {
    if (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404) return null;
    throw err;
  }
}
