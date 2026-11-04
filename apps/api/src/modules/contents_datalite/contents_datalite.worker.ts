import { Worker } from 'bullmq';
import { join } from 'path';
import { tmpdir } from 'os';
import { createWriteStream, createReadStream } from 'fs';
import { unlink } from 'fs/promises';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import Ffmpeg from 'fluent-ffmpeg';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { env } from '../../shared/core/env';
import { s3 } from '../../shared/core/storage';
import { makeQueueRedis } from '../../shared/core/queue';
import { emit } from '../../shared/core/events';
import prisma from '../../shared/core/database';
import type { TranscodeJobData } from '../../shared/core/queue';

async function downloadToTemp(key: string): Promise<string> {
  const ext = key.split('.').pop() ?? 'bin';
  const tempPath = join(tmpdir(), `educa-dl-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
  const res = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  await pipeline(res.Body as Readable, createWriteStream(tempPath));
  return tempPath;
}

async function uploadFromPath(key: string, filePath: string, contentType: string): Promise<void> {
  await s3.send(
    new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: createReadStream(filePath), ContentType: contentType }),
  );
}

// Vídeo → 480p H.264/AAC optimizado para streaming (RF-CON-02)
function transcodeVideo(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    Ffmpeg(inputPath)
      .outputOptions([
        '-vf', 'scale=-2:480',
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '28',
        '-c:a', 'aac',
        '-b:a', '96k',
        '-movflags', '+faststart',
      ])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(new Error(`ffmpeg: ${err.message}`)))
      .run();
  });
}

export function createWorker() {
  const worker = new Worker<TranscodeJobData>(
    'content-transcode',
    async (job) => {
      const { contentId, storageKey, type } = job.data;
      let inputPath: string | null = null;
      let outputPath: string | null = null;

      try {
        inputPath = await downloadToTemp(storageKey);
        const dataliteKey = `datalite/${contentId}${type === 'VIDEO' ? '.mp4' : '.pdf'}`;

        if (type === 'VIDEO') {
          outputPath = join(tmpdir(), `educa-out-${contentId}.mp4`);
          await transcodeVideo(inputPath, outputPath);
          await uploadFromPath(dataliteKey, outputPath, 'video/mp4');
        } else {
          // PDF: sem transcodificação — ficheiro já compacto (RF-CON-02)
          await uploadFromPath(dataliteKey, inputPath, 'application/pdf');
        }

        const item = await prisma.contentItem.update({
          where: { id: contentId },
          data: { dataliteKey },
          select: { title: true, tutorProfile: { select: { userId: true } } },
        });
        await emit('content.ready', { contentId, tutorUserId: item.tutorProfile.userId, title: item.title });
        console.log(`[Worker] ${contentId} → ${dataliteKey}`);
      } finally {
        if (inputPath) await unlink(inputPath).catch(() => {});
        if (outputPath) await unlink(outputPath).catch(() => {});
      }
    },
    { connection: makeQueueRedis(), concurrency: 2 },
  );

  worker.on('failed', (job, err) => {
    console.error(`[Worker] job ${job?.id} falhou (tentativa ${job?.attemptsMade ?? 0}):`, err.message);
  });

  return worker;
}
