import { randomUUID } from 'crypto';
import { Prisma, TutorStatus } from '@prisma/client';
import prisma from '../../shared/core/database';
import { writeAuditLog } from '../../shared/core/audit';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../shared/core/errors';
import { headObject, presignDownload, presignUpload } from '../../shared/core/storage';
import { emit } from '../../shared/core/events';
import redis from '../../shared/core/redis';
import { AVATAR_MAX_BYTES, AVATAR_MIMES, DOCUMENT_TYPES } from './tutors.types';
import type {
  CreateProfileDto,
  UpdateTutorProfileDto,
  DocumentType,
  SubmitDocumentsDto,
  UploadUrlDto,
  ReviewTutorDto,
  ListTutorsQuery,
} from './tutors.types';

// ── Cache de leitura (arquitectura §2.3) ─────────────────────────────────────
// Perfis públicos e catálogo são lidos muito mais do que escritos.
// Versão do catálogo: incrementar em qualquer escrita invalida atomicamente todas as páginas em cache.
const PROFILE_TTL = 600; // 10 min
const CATALOG_TTL = 300; // 5 min
const CATALOG_VERSION_KEY = 'tutor:catalog:v';
const profileCacheKey = (id: string) => `tutor:profile:${id}`;

async function getCatalogVersion(): Promise<number> {
  return Number((await redis.get(CATALOG_VERSION_KEY)) ?? 0);
}

// Exportada para que reputation.service possa invalidar após actualizar as estatísticas
export async function invalidateTutorCache(profileId: string): Promise<void> {
  await Promise.all([redis.del(profileCacheKey(profileId)), redis.incr(CATALOG_VERSION_KEY)]);
}

const PUBLIC_PROFILE_SELECT = {
  id: true,
  bio: true,
  subjects: true,
  levels: true,
  avatarKey: true,
  hourlyRate: true,
  ratingAverage: true,
  totalReviews: true,
  totalClasses: true,
  totalStudents: true,
  user: { select: { id: true, name: true } },
} as const;

type RawPublicProfile = {
  id: string;
  bio: string | null;
  subjects: string[];
  levels: string[];
  avatarKey: string | null;
  hourlyRate: { toFixed: (d: number) => string } | null;
  ratingAverage: number;
  totalReviews: number;
  totalClasses: number;
  totalStudents: number;
  user: { id: string; name: string };
};

async function toPublicTutor(p: RawPublicProfile) {
  return {
    id: p.id,
    fullName: p.user.name,
    avatarUrl: p.avatarKey ? await presignDownload(p.avatarKey) : null,
    bio: p.bio,
    subjects: p.subjects,
    levels: p.levels,
    isVerified: true,
    averageRating: p.ratingAverage,
    reviewCount: p.totalReviews,
    totalClasses: p.totalClasses,
    totalStudents: p.totalStudents,
    hourlyRate: p.hourlyRate ? p.hourlyRate.toFixed(2) : null,
  };
}

const DOCUMENT_FIELDS = {
  DIPLOMA: 'diplomaKey',
  CRIMINAL_RECORD: 'criminalRecordKey',
  PASSPORT_PHOTO: 'passportPhotoKey',
  VIDEO_INTRO: 'videoIntroKey',
} as const satisfies Record<DocumentType, string>;

const EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

type WithKeys = Record<(typeof DOCUMENT_FIELDS)[DocumentType], string | null>;
type WithProfileKeys = WithKeys & { avatarKey: string | null };

const sign = (key: string | null) => (key ? presignDownload(key) : Promise.resolve(null));

// Usada por listPending (PendingTutor — sem avatarKey no select)
async function withDocumentUrls<T extends WithKeys>(profile: T) {
  const { diplomaKey, criminalRecordKey, passportPhotoKey, videoIntroKey, ...rest } = profile;
  const [diploma, criminalRecord, passportPhoto, videoIntro] = await Promise.all([
    sign(diplomaKey), sign(criminalRecordKey), sign(passportPhotoKey), sign(videoIntroKey),
  ]);
  return { ...rest, documents: { diploma, criminalRecord, passportPhoto, videoIntro } };
}

// Usada pelos endpoints que devolvem TutorProfile (inclui avatarUrl e nunca expõe avatarKey)
async function withProfileUrls<T extends WithProfileKeys>(profile: T) {
  const { avatarKey, diplomaKey, criminalRecordKey, passportPhotoKey, videoIntroKey, ...rest } = profile;
  const [diploma, criminalRecord, passportPhoto, videoIntro, avatarUrl] = await Promise.all([
    sign(diplomaKey), sign(criminalRecordKey), sign(passportPhotoKey), sign(videoIntroKey), sign(avatarKey),
  ]);
  return { ...rest, avatarUrl, documents: { diploma, criminalRecord, passportPhoto, videoIntro } };
}

export async function requestUploadUrl(userId: string, data: UploadUrlDto) {
  const profile = await prisma.tutorProfile.findUnique({ where: { userId } });
  if (!profile) throw new NotFoundError('Perfil de tutor não encontrado');
  // Documentos de verificação não podem ser alterados depois da aprovação; avatares sim
  if (data.type !== 'AVATAR' && profile.status === TutorStatus.APPROVED) {
    throw new ForbiddenError('Perfil aprovado não pode ser alterado');
  }

  const maxBytes = data.type === 'AVATAR' ? AVATAR_MAX_BYTES : DOCUMENT_TYPES[data.type as DocumentType].maxBytes;
  const key = `tutors/${userId}/${data.type}/${randomUUID()}.${EXTENSIONS[data.contentType]}`;
  const { url, fields } = await presignUpload(key, data.contentType, maxBytes);
  return { key, url, fields, maxBytes, expiresInSeconds: 300 };
}

export async function createProfile(userId: string, data: CreateProfileDto) {
  const existing = await prisma.tutorProfile.findUnique({ where: { userId } });
  if (existing) throw new ConflictError('Perfil de tutor já existe');

  const created = await prisma.tutorProfile.create({
    data: {
      userId,
      bio: data.bio,
      subjects: data.subjects,
      levels: data.levels,
      ...(data.hourlyRate !== undefined ? { hourlyRate: data.hourlyRate.toString() } : {}),
    },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  return withProfileUrls(created);
}

export async function updateProfile(userId: string, data: UpdateTutorProfileDto) {
  const profile = await prisma.tutorProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!profile) throw new NotFoundError('Perfil de tutor não encontrado');

  // Validar ownership e existência do avatar: impede que um tutor use a chave de storage de outro
  if (data.avatarKey !== undefined) {
    if (!data.avatarKey.startsWith(`tutors/${userId}/AVATAR/`)) {
      throw new ValidationError('Chave de avatar inválida', { avatarKey: ['não pertence a este tutor'] });
    }
    const object = await headObject(data.avatarKey);
    if (!object) throw new ValidationError('Ficheiro não encontrado', { avatarKey: ['faça o upload primeiro'] });
    if (object.size > AVATAR_MAX_BYTES || !(AVATAR_MIMES as readonly string[]).includes(object.contentType)) {
      throw new ValidationError('Ficheiro inválido', { avatarKey: ['tipo ou tamanho não permitido'] });
    }
  }

  const updated = await prisma.tutorProfile.update({
    where: { id: profile.id },
    data: {
      ...(data.bio !== undefined ? { bio: data.bio || null } : {}),
      ...(data.subjects !== undefined ? { subjects: [...new Set(data.subjects)] } : {}),
      ...(data.levels !== undefined ? { levels: data.levels } : {}),
      ...(data.hourlyRate !== undefined ? { hourlyRate: data.hourlyRate.toString() } : {}),
      ...(data.avatarKey !== undefined ? { avatarKey: data.avatarKey } : {}),
    },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  await writeAuditLog({ actorId: userId, entityType: 'TutorProfile', entityId: profile.id, action: 'PROFILE_UPDATED' });
  await invalidateTutorCache(profile.id);
  return withProfileUrls(updated);
}

export async function submitDocuments(userId: string, data: SubmitDocumentsDto) {
  const profile = await prisma.tutorProfile.findUnique({ where: { userId } });
  if (!profile) throw new NotFoundError('Perfil de tutor não encontrado');
  if (profile.status === TutorStatus.APPROVED) {
    throw new ForbiddenError('Perfil aprovado não pode ser alterado');
  }

  // Cada chave tem de pertencer a este tutor e ao tipo certo, e o ficheiro tem de existir no bucket
  const updates: Partial<SubmitDocumentsDto> = {};
  for (const type of Object.keys(DOCUMENT_FIELDS) as DocumentType[]) {
    const field = DOCUMENT_FIELDS[type];
    const key = data[field];
    if (key === undefined) continue;

    if (!key.startsWith(`tutors/${userId}/${type}/`)) {
      throw new ValidationError('Chave de documento inválida', { [field]: ['não pertence a este tutor'] });
    }
    const { mimes, maxBytes } = DOCUMENT_TYPES[type];
    const object = await headObject(key);
    if (!object) {
      throw new ValidationError('Ficheiro não encontrado', { [field]: ['faça o upload primeiro'] });
    }
    if (object.size > maxBytes || !(mimes as readonly string[]).includes(object.contentType)) {
      throw new ValidationError('Ficheiro inválido', { [field]: ['tipo ou tamanho não permitido'] });
    }
    updates[field] = key;
  }

  // Reenvio após rejeição: volta à fila de revisão e limpa o motivo anterior
  const resubmission =
    profile.status === TutorStatus.REJECTED
      ? { status: TutorStatus.PENDING, rejectionReason: null, reviewedAt: null }
      : {};

  const updated = await prisma.tutorProfile.update({
    where: { userId },
    data: { ...updates, ...resubmission },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  return withProfileUrls(updated);
}

export async function getMyProfile(userId: string) {
  const profile = await prisma.tutorProfile.findUnique({
    where: { userId },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  if (!profile) throw new NotFoundError('Perfil de tutor não encontrado');
  return withProfileUrls(profile);
}

export async function getPublicProfile(profileId: string) {
  const cached = await redis.get(profileCacheKey(profileId));
  const raw: RawPublicProfile = cached
    ? JSON.parse(cached)
    : await (async () => {
        const profile = await prisma.tutorProfile.findFirst({
          where: { id: profileId, status: TutorStatus.APPROVED },
          select: PUBLIC_PROFILE_SELECT,
        });
        if (!profile) throw new NotFoundError('Tutor não encontrado');
        await redis.set(profileCacheKey(profileId), JSON.stringify(profile), 'EX', PROFILE_TTL);
        return profile;
      })();

  return toPublicTutor(raw);
}

export async function listApproved(query: ListTutorsQuery) {
  const { q, disciplina, nivel, page, limit } = query;
  const v = await getCatalogVersion();
  const cacheKey = `tutor:catalog:${v}:${q ?? ''}:${disciplina ?? ''}:${nivel ?? ''}:${page}:${limit}`;

  const cached = await redis.get(cacheKey);

  const skip = (page - 1) * limit;
  const where: Prisma.TutorProfileWhereInput = {
    status: TutorStatus.APPROVED,
    ...(disciplina ? { subjects: { has: disciplina } } : {}),
    ...(nivel ? { levels: { has: nivel } } : {}),
    ...(q
      ? {
          OR: [
            { user: { name: { contains: q, mode: 'insensitive' } } },
            { subjects: { hasSome: [q] } },
            { bio: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  let rows: RawPublicProfile[];
  let total: number;

  if (cached) {
    ({ tutors: rows, total } = JSON.parse(cached) as { tutors: RawPublicProfile[]; total: number });
  } else {
    [rows, total] = await prisma.$transaction([
      prisma.tutorProfile.findMany({
        where,
        skip,
        take: limit,
        orderBy: { ratingAverage: 'desc' },
        select: PUBLIC_PROFILE_SELECT,
      }),
      prisma.tutorProfile.count({ where }),
    ]);
    await redis.set(cacheKey, JSON.stringify({ tutors: rows, total }), 'EX', CATALOG_TTL);
  }

  const tutors = await Promise.all(rows.map(toPublicTutor));
  return { tutors, total, page, limit, pages: Math.ceil(total / limit) };
}

export async function reviewTutor(adminId: string, profileId: string, data: ReviewTutorDto) {
  const profile = await prisma.tutorProfile.findUnique({ where: { id: profileId } });
  if (!profile) throw new NotFoundError('Perfil de tutor não encontrado');
  if (profile.status !== TutorStatus.PENDING) {
    throw new ConflictError(`Perfil já se encontra ${profile.status.toLowerCase()}`);
  }

  const updated = await prisma.tutorProfile.update({
    where: { id: profileId },
    data: {
      status: data.status as TutorStatus,
      rejectionReason: data.status === 'REJECTED' ? data.reason : null,
      reviewedAt: new Date(),
    },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  await writeAuditLog({
    actorId: adminId,
    entityType: 'TutorProfile',
    entityId: profileId,
    action: data.status === 'APPROVED' ? 'TUTOR_APPROVED' : 'TUTOR_REJECTED',
  });

  await emit('tutor.status_changed', {
    userId: updated.user.id,
    status: data.status as 'APPROVED' | 'REJECTED',
    reason: data.status === 'REJECTED' ? (data as { reason?: string }).reason : undefined,
  });

  await invalidateTutorCache(profileId);
  return withProfileUrls(updated);
}

export async function listPending(page: number, limit: number) {
  const skip = (page - 1) * limit;
  // Só entram na fila perfis com pelo menos um documento para rever (RN-05)
  const where = {
    status: TutorStatus.PENDING,
    OR: [
      { diplomaKey: { not: null } },
      { criminalRecordKey: { not: null } },
      { passportPhotoKey: { not: null } },
      { videoIntroKey: { not: null } },
    ],
  };

  const [tutors, total] = await prisma.$transaction([
    prisma.tutorProfile.findMany({
      where,
      skip,
      take: limit,
      orderBy: { user: { createdAt: 'asc' } },
      select: {
        id: true,
        bio: true,
        subjects: true,
        diplomaKey: true,
        criminalRecordKey: true,
        passportPhotoKey: true,
        videoIntroKey: true,
        user: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.tutorProfile.count({ where }),
  ]);

  const signed = await Promise.all(tutors.map(withDocumentUrls));
  return { tutors: signed, total, page, limit, pages: Math.ceil(total / limit) };
}

// Só tutores aprovados (RN-05) podem publicar aulas
export async function requireApprovedTutor(userId: string): Promise<{ id: string }> {
  const profile = await prisma.tutorProfile.findUnique({
    where: { userId },
    select: { id: true, status: true },
  });
  if (!profile) throw new NotFoundError('Perfil de tutor não encontrado');
  if (profile.status !== TutorStatus.APPROVED) {
    throw new ForbiddenError('Só tutores aprovados podem publicar aulas');
  }
  return { id: profile.id };
}

export async function getTutorProfileId(userId: string): Promise<string> {
  const profile = await prisma.tutorProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!profile) throw new NotFoundError('Perfil de tutor não encontrado');
  return profile.id;
}

// ── Estatísticas do perfil (RF-TUT-03) ───────────────────────────────────────
// Calculadas pelo módulo reputation; os campos pertencem a este módulo, que é o único a escrevê-los.

// Serializa actualizações concorrentes: depois deste bloqueio, as leituras seguintes da transacção
// já vêem tudo o que outras transacções tenham confirmado
export async function lockProfile(tx: Prisma.TransactionClient, profileId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "TutorProfile" WHERE id = ${profileId} FOR UPDATE`;
  if (rows.length === 0) throw new NotFoundError('Perfil de tutor não encontrado');
}

export interface TutorStats {
  ratingAverage: number;
  totalReviews: number;
  totalClasses: number;
  totalStudents: number;
}

export async function setStats(tx: Prisma.TransactionClient, profileId: string, stats: TutorStats): Promise<void> {
  await tx.tutorProfile.update({ where: { id: profileId }, data: stats });
}

// ── Leitura para o módulo activity ───────────────────────────────────────────

// Só as estatísticas: nunca os documentos (ao contrário de getMyProfile)
export async function getTutorOwnStats(userId: string) {
  const profile = await prisma.tutorProfile.findUnique({
    where: { userId },
    select: { id: true, status: true, ratingAverage: true, totalReviews: true, totalClasses: true, totalStudents: true },
  });
  if (!profile) throw new NotFoundError('Perfil de tutor não encontrado');
  return profile;
}

export async function countProfilesByStatus() {
  const grouped = await prisma.tutorProfile.groupBy({ by: ['status'], _count: { _all: true } });
  return Object.fromEntries(Object.values(TutorStatus).map((s) => [s, grouped.find((g) => g.status === s)?._count._all ?? 0]));
}
