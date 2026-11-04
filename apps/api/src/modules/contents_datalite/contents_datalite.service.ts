// Módulo contents_datalite — expõe apenas esta camada de serviço pública.
// Outros módulos comunicam via eventos internos (EventEmitter2/BullMQ),
// nunca por acesso directo ao Prisma deste módulo.

import { randomUUID } from 'crypto';
import { ContentStatus, ContentType, Role } from '@prisma/client';
import prisma from '../../shared/core/database';
import { writeAuditLog } from '../../shared/core/audit';
import { NotFoundError, PaymentRequiredError, ValidationError } from '../../shared/core/errors';
import { headObject, presignDownload, presignUpload } from '../../shared/core/storage';
import { emit } from '../../shared/core/events';
import { CONTENT_UPLOAD_TYPES } from './contents_datalite.types';
import type {
  ChangeStatusDto,
  ContentUploadUrlDto,
  CreateContentDto,
  ListAdminQuery,
  ListContentsQuery,
  UpdateContentDto,
} from './contents_datalite.types';

const EXTENSIONS: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'application/pdf': 'pdf',
};

const ITEM_SELECT = {
  id: true,
  tutorProfileId: true,
  title: true,
  description: true,
  type: true,
  status: true,
  isPaid: true,
  subject: true,
  dataliteKey: true,
  createdAt: true,
  updatedAt: true,
} as const;

// storageKey e dataliteKey nunca saem: o cliente recebe hasDatalite e URLs assinadas (RF-CON-03)
function toResponse(item: { dataliteKey: string | null; [k: string]: unknown }) {
  const { dataliteKey, ...rest } = item;
  return { ...rest, hasDatalite: dataliteKey !== null };
}

export async function requestUploadUrl(userId: string, dto: ContentUploadUrlDto) {
  const profile = await prisma.tutorProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!profile) throw new NotFoundError('Perfil de tutor não encontrado');

  const { maxBytes } = CONTENT_UPLOAD_TYPES[dto.type];
  const ext = EXTENSIONS[dto.contentType];
  const key = `contents/${profile.id}/${randomUUID()}.${ext}`;
  const { url, fields } = await presignUpload(key, dto.contentType, maxBytes);
  return { key, url, fields, maxBytes, expiresInSeconds: 300 };
}

export async function createContent(userId: string, dto: CreateContentDto) {
  const profile = await prisma.tutorProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!profile) throw new NotFoundError('Perfil de tutor não encontrado');

  // Valida que a chave pertence a este tutor e que o ficheiro já foi enviado para o bucket
  if (!dto.storageKey.startsWith(`contents/${profile.id}/`)) {
    throw new ValidationError('Chave de conteúdo inválida', { storageKey: ['não pertence a este tutor'] });
  }
  const { mimes, maxBytes } = CONTENT_UPLOAD_TYPES[dto.type];
  const object = await headObject(dto.storageKey);
  if (!object) {
    throw new ValidationError('Ficheiro não encontrado no storage', { storageKey: ['faça o upload primeiro'] });
  }
  if (object.size > maxBytes || !(mimes as readonly string[]).includes(object.contentType)) {
    throw new ValidationError('Ficheiro inválido', { storageKey: ['tipo ou tamanho não permitido'] });
  }

  const item = await prisma.contentItem.create({
    data: {
      tutorProfileId: profile.id,
      title: dto.title,
      description: dto.description ?? null,
      type: dto.type as ContentType,
      isPaid: dto.isPaid,
      storageKey: dto.storageKey,
      subject: dto.subject ?? null,
    },
    select: ITEM_SELECT,
  });

  // Notifica o worker de transcodificação (a implementar com BullMQ)
  await emit('content.uploaded', { contentId: item.id, tutorProfileId: profile.id, type: item.type });
  await writeAuditLog({ actorId: userId, entityType: 'ContentItem', entityId: item.id, action: 'CONTENT_CREATED' });
  return toResponse(item);
}

export async function listMine(userId: string, query: ListContentsQuery) {
  const profile = await prisma.tutorProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!profile) throw new NotFoundError('Perfil de tutor não encontrado');

  const { subject, type, page, limit } = query;
  const skip = (page - 1) * limit;
  const where = {
    tutorProfileId: profile.id,
    ...(subject ? { subject } : {}),
    ...(type ? { type: type as ContentType } : {}),
  };

  const [contents, total] = await prisma.$transaction([
    prisma.contentItem.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' }, select: ITEM_SELECT }),
    prisma.contentItem.count({ where }),
  ]);

  return { contents: contents.map(toResponse), total, page, limit, pages: Math.ceil(total / limit) };
}

export async function listPublished(query: ListContentsQuery) {
  const { subject, type, page, limit } = query;
  const skip = (page - 1) * limit;
  const where = {
    status: ContentStatus.PUBLISHED,
    ...(subject ? { subject } : {}),
    ...(type ? { type: type as ContentType } : {}),
  };

  const [contents, total] = await prisma.$transaction([
    prisma.contentItem.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' }, select: ITEM_SELECT }),
    prisma.contentItem.count({ where }),
  ]);

  return { contents: contents.map(toResponse), total, page, limit, pages: Math.ceil(total / limit) };
}

export async function getPublicById(id: string) {
  const item = await prisma.contentItem.findFirst({
    where: { id, status: ContentStatus.PUBLISHED },
    select: ITEM_SELECT,
  });
  if (!item) throw new NotFoundError('Conteúdo não encontrado');
  return toResponse(item);
}

export async function updateContent(userId: string, id: string, dto: UpdateContentDto) {
  const item = await getOwnItem(userId, id);

  const updated = await prisma.contentItem.update({
    where: { id: item.id },
    data: {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.isPaid !== undefined ? { isPaid: dto.isPaid } : {}),
      ...(dto.subject !== undefined ? { subject: dto.subject } : {}),
    },
    select: ITEM_SELECT,
  });

  return toResponse(updated);
}

export async function changeStatus(userId: string, id: string, dto: ChangeStatusDto) {
  const item = await getOwnItem(userId, id);

  const updated = await prisma.contentItem.update({
    where: { id: item.id },
    data: { status: dto.status as ContentStatus },
    select: ITEM_SELECT,
  });

  await writeAuditLog({ actorId: userId, entityType: 'ContentItem', entityId: id, action: `CONTENT_${dto.status}` });
  return toResponse(updated);
}

export async function deleteContent(userId: string, id: string) {
  const item = await getOwnItem(userId, id);
  await prisma.contentItem.delete({ where: { id: item.id } });
  await writeAuditLog({ actorId: userId, entityType: 'ContentItem', entityId: id, action: 'CONTENT_DELETED' });
}

// URL de acesso assinada — DPM (RF-CON-03): curta duração, chave nunca exposta
export async function getAccessUrl(userId: string, role: Role, contentId: string, datalite: boolean) {
  const item = await prisma.contentItem.findUnique({
    where: { id: contentId },
    select: { id: true, status: true, isPaid: true, storageKey: true, dataliteKey: true, tutorProfileId: true },
  });
  if (!item) throw new NotFoundError('Conteúdo não encontrado');

  if (role === Role.ADMIN) {
    // Admin acede a qualquer conteúdo
  } else if (role === Role.TUTOR) {
    // Tutor acede ao próprio conteúdo (qualquer estado) ou a conteúdo publicado de outros
    const profile = await prisma.tutorProfile.findUnique({ where: { userId }, select: { id: true } });
    const isOwner = profile?.id === item.tutorProfileId;
    if (!isOwner && item.status !== ContentStatus.PUBLISHED) {
      throw new NotFoundError('Conteúdo não encontrado');
    }
  } else {
    // STUDENT / GUARDIAN: apenas conteúdo publicado
    if (item.status !== ContentStatus.PUBLISHED) throw new NotFoundError('Conteúdo não encontrado');

    // Conteúdo pago exige pacote de horas activo (RF-CON-03)
    if (item.isPaid) {
      const now = new Date();
      const activePackage = await prisma.hourPackage.findFirst({
        where: {
          userId,
          remainingHours: { gt: 0 },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { id: true },
      });
      if (!activePackage) {
        throw new PaymentRequiredError('Pacote de horas activo necessário para aceder a este conteúdo');
      }
    }
  }

  if (!item.storageKey) throw new NotFoundError('Ficheiro de conteúdo ainda não disponível');

  const key = datalite && item.dataliteKey ? item.dataliteKey : item.storageKey;
  const url = await presignDownload(key);
  return { url, expiresInSeconds: 300 };
}

export async function adminListAll(query: ListAdminQuery) {
  const { status, tutorProfileId, page, limit } = query;
  const skip = (page - 1) * limit;
  const where = {
    ...(status ? { status: status as ContentStatus } : {}),
    ...(tutorProfileId ? { tutorProfileId } : {}),
  };

  const [contents, total] = await prisma.$transaction([
    prisma.contentItem.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' }, select: ITEM_SELECT }),
    prisma.contentItem.count({ where }),
  ]);

  return { contents: contents.map(toResponse), total, page, limit, pages: Math.ceil(total / limit) };
}

export async function adminDeleteContent(adminId: string, id: string) {
  const item = await prisma.contentItem.findUnique({ where: { id }, select: { id: true } });
  if (!item) throw new NotFoundError('Conteúdo não encontrado');
  await prisma.contentItem.delete({ where: { id } });
  await writeAuditLog({ actorId: adminId, entityType: 'ContentItem', entityId: id, action: 'CONTENT_DELETED_BY_ADMIN' });
}

// ── Helpers privados ──────────────────────────────────────────────────────────

async function getOwnItem(userId: string, contentId: string) {
  const profile = await prisma.tutorProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!profile) throw new NotFoundError('Perfil de tutor não encontrado');

  const item = await prisma.contentItem.findUnique({ where: { id: contentId }, select: { id: true, tutorProfileId: true } });
  if (!item || item.tutorProfileId !== profile.id) throw new NotFoundError('Conteúdo não encontrado');
  return item;
}
