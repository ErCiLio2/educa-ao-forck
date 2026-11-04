import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import prisma from '../../src/shared/core/database';
import redis from '../../src/shared/core/redis';
import { transcodingQueue, makeQueueRedis } from '../../src/shared/core/queue';
import { createWorker } from '../../src/modules/contents_datalite/contents_datalite.worker';
import { app, bearer, body, get, patch, post } from './helpers';
import type { Worker } from 'bullmq';

// RF-CON-02: worker de transcodificação Data-Lite

beforeAll(() => app.ready());
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  await redis.quit();
  // Fechar as ligações Redis do BullMQ que possam ter ficado abertas neste teste
  await transcodingQueue.close();
});

async function tutorWithProfile() {
  const { randomUUID } = await import('node:crypto');
  const email = `tutor-worker-${randomUUID().slice(0, 8)}@teste.educa`;
  const res = await post('/api/v1/auth/register', { name: 'Tutor Worker', email, password: 'Abcdefg1', role: 'TUTOR' });
  const token = body(res).accessToken as string;
  await post('/api/v1/tutors/profile', { subjects: ['Física'] }, bearer(token));
  return { token };
}

async function uploadFile(
  info: { url: string; fields: Record<string, string> },
  data: Uint8Array,
  contentType: string,
) {
  const form = new FormData();
  for (const [k, v] of Object.entries(info.fields)) form.append(k, v);
  form.set('Content-Type', contentType);
  form.append('file', new Blob([data], { type: contentType }), 'f');
  return fetch(info.url, { method: 'POST', body: form });
}

async function waitForCompletion(worker: Worker, contentId: string, timeout = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout aguardando job de ${contentId}`)), timeout);
    worker.on('completed', (job) => {
      if ((job.data as { contentId: string }).contentId === contentId) {
        clearTimeout(timer);
        resolve();
      }
    });
    worker.on('failed', (job, err) => {
      if ((job?.data as { contentId: string } | undefined)?.contentId === contentId) {
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}

describe('worker de transcodificação (RF-CON-02)', () => {
  it('documento: enfileira job e preenche dataliteKey após processamento', async () => {
    const tutor = await tutorWithProfile();

    // Obter URL de upload e enviar PDF mínimo
    const info = body(
      await post('/api/v1/contents/upload-url', { type: 'DOCUMENT', contentType: 'application/pdf' }, bearer(tutor.token)),
    );
    await uploadFile(info, new TextEncoder().encode('%PDF-1.4 datalite-test'), 'application/pdf');

    const created = body(
      await post('/api/v1/contents', { title: 'PDF Data-Lite', type: 'DOCUMENT', isPaid: false, storageKey: info.key }, bearer(tutor.token)),
    );
    const contentId = created.content.id as string;

    // Verificar que o job foi colocado na fila (o event handler não está registado aqui —
    // enfileiramos directamente para isolar o teste do wiring do servidor)
    const connection = makeQueueRedis();
    await transcodingQueue.add('transcode', { contentId, storageKey: info.key, type: 'DOCUMENT' });

    const worker = createWorker();
    await waitForCompletion(worker, contentId);
    await worker.close();
    await connection.quit();

    // dataliteKey deve estar preenchida na BD
    const item = await prisma.contentItem.findUniqueOrThrow({ where: { id: contentId }, select: { dataliteKey: true } });
    expect(item.dataliteKey).toBe(`datalite/${contentId}.pdf`);
  });

  it('url de acesso com ?datalite=true devolve URL da versão Data-Lite', async () => {
    const tutor = await tutorWithProfile();

    const info = body(
      await post('/api/v1/contents/upload-url', { type: 'DOCUMENT', contentType: 'application/pdf' }, bearer(tutor.token)),
    );
    await uploadFile(info, new TextEncoder().encode('%PDF-1.4 test2'), 'application/pdf');
    const created = body(
      await post('/api/v1/contents', { title: 'PDF DPM Datalite', type: 'DOCUMENT', isPaid: false, storageKey: info.key }, bearer(tutor.token)),
    );
    const contentId = created.content.id as string;
    await patch(`/api/v1/contents/${contentId}/status`, { status: 'PUBLISHED' }, bearer(tutor.token));

    // Processar o job directamente
    await transcodingQueue.add('transcode', { contentId, storageKey: info.key, type: 'DOCUMENT' });
    const worker = createWorker();
    await waitForCompletion(worker, contentId);
    await worker.close();

    // Sem datalite → URL do original
    const urlOriginal = body(await get(`/api/v1/contents/${contentId}/url`, bearer(tutor.token)));
    expect(urlOriginal.url).toBeTruthy();

    // Com datalite=true → URL diferente (aponta para datalite/)
    const urlDatalite = body(await get(`/api/v1/contents/${contentId}/url?datalite=true`, bearer(tutor.token)));
    expect(urlDatalite.url).toBeTruthy();
    expect(urlDatalite.url).not.toBe(urlOriginal.url);
  });

  it('hasDatalite=false antes do processamento; true depois', async () => {
    const tutor = await tutorWithProfile();

    const info = body(
      await post('/api/v1/contents/upload-url', { type: 'DOCUMENT', contentType: 'application/pdf' }, bearer(tutor.token)),
    );
    await uploadFile(info, new TextEncoder().encode('%PDF-1.4 test3'), 'application/pdf');
    const created = body(
      await post('/api/v1/contents', { title: 'PDF hasDatalite', type: 'DOCUMENT', isPaid: false, storageKey: info.key }, bearer(tutor.token)),
    );
    const contentId = created.content.id as string;

    // Antes: hasDatalite deve ser false
    const mine = body(await get('/api/v1/contents/mine', bearer(tutor.token)));
    const before = mine.contents.find((c: { id: string }) => c.id === contentId);
    expect(before.hasDatalite).toBe(false);

    // Processar
    await transcodingQueue.add('transcode', { contentId, storageKey: info.key, type: 'DOCUMENT' });
    const worker = createWorker();
    await waitForCompletion(worker, contentId);
    await worker.close();

    // Depois: hasDatalite deve ser true
    const mine2 = body(await get('/api/v1/contents/mine', bearer(tutor.token)));
    const after = mine2.contents.find((c: { id: string }) => c.id === contentId);
    expect(after.hasDatalite).toBe(true);
  });
});
