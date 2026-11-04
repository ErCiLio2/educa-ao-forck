import 'dotenv/config';
import argon2 from 'argon2';
import { PrismaClient, Role, TutorStatus, ClassType } from '@prisma/client';

// Seed de desenvolvimento — cria utilizadores e dados de demonstração.
// Idempotente: re-executar não duplica registos.
// Uso: pnpm --filter educa-api db:seed

const prisma = new PrismaClient();

const DEV_PASSWORD = 'educa1234dev!';

// ── Dados de demonstração ─────────────────────────────────────────────────────

const ADMINS = [
  { name: 'Administrador eDuca', email: 'admin@educa.ao' },
];

const TUTORS: {
  name: string;
  email: string;
  subjects: string[];
  levels: string[];
  bio: string;
  hourlyRate: number;
  ratingAverage: number;
  totalReviews: number;
}[] = [
  {
    name: 'Manuel Kiala',
    email: 'manuel.kiala@educa.ao',
    subjects: ['Matemática', 'Física'],
    levels: ['pre-universitario', 'universitario'],
    bio: 'Licenciado em Engenharia pelo ISTA, com 6 anos de experiência em explicações. Especializado em preparação para exames de acesso ao ensino superior.',
    hourlyRate: 3500,
    ratingAverage: 4.8,
    totalReviews: 34,
  },
  {
    name: 'Filomena Neto',
    email: 'filomena.neto@educa.ao',
    subjects: ['Língua Portuguesa', 'Inglês'],
    levels: ['primario', 'ciclo', 'pre-universitario'],
    bio: 'Professora licenciada em Letras pela UJES. Metodologia comunicativa, foco na expressão oral e escrita. Experiência com turmas do 1.º ao 12.º ano.',
    hourlyRate: 2800,
    ratingAverage: 4.6,
    totalReviews: 51,
  },
  {
    name: 'Domingos Sapalo',
    email: 'domingos.sapalo@educa.ao',
    subjects: ['Química', 'Biologia'],
    levels: ['ciclo', 'pre-universitario'],
    bio: 'Mestre em Ciências Biomédicas. Apaixonado por tornar a química e a biologia acessíveis a todos os estudantes.',
    hourlyRate: 4200,
    ratingAverage: 4.9,
    totalReviews: 22,
  },
  {
    name: 'Ana Luísa Tchivanga',
    email: 'ana.tchivanga@educa.ao',
    subjects: ['Informática'],
    levels: ['ciclo', 'pre-universitario', 'universitario'],
    bio: 'Engenheira de Software com experiência em desenvolvimento web e móvel. Ensino de programação, algoritmos e preparação para a ISAL/ISTA.',
    hourlyRate: 5000,
    ratingAverage: 4.7,
    totalReviews: 18,
  },
  {
    name: 'Eduardo Massango',
    email: 'eduardo.massango@educa.ao',
    subjects: ['História', 'Geografia', 'Filosofia'],
    levels: ['primario', 'ciclo', 'pre-universitario'],
    bio: 'Licenciado em Ciências da Educação. Tutor com foco no desenvolvimento do pensamento crítico e na preparação para os exames nacionais.',
    hourlyRate: 2500,
    ratingAverage: 4.5,
    totalReviews: 40,
  },
];

const STUDENTS = [
  { name: 'Catarina Lopes', email: 'catarina.lopes@educa.ao' },
  { name: 'Jonas Ferreira', email: 'jonas.ferreira@educa.ao' },
  { name: 'Beatriz Mendes', email: 'beatriz.mendes@educa.ao' },
];

const GUARDIAN = { name: 'Paulo André Lopes', email: 'paulo.lopes@educa.ao' };
const GUARDIAN_DEPENDENT = { name: 'Maria Lopes', email: 'maria.lopes@educa.ao' };

const PACKAGE_OFFERS = [
  { name: 'Pacote Básico', hours: 5, price: 12500, validityDays: 30 },
  { name: 'Pacote Mensal', hours: 10, price: 22000, validityDays: 30 },
  { name: 'Pacote Trimestral', hours: 30, price: 60000, validityDays: 90 },
];

// ── Utilitários ───────────────────────────────────────────────────────────────

async function hashPassword(plain: string) {
  return argon2.hash(plain, { type: argon2.argon2id });
}

async function upsertUser(email: string, name: string, role: Role, guardianId?: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;
  const hash = await hashPassword(DEV_PASSWORD);
  return prisma.user.create({ data: { name, email, password: hash, role, guardianId } });
}

// ── Seed principal ────────────────────────────────────────────────────────────

async function main() {
  console.log('[ seed ] a iniciar…');

  // Administradores
  for (const a of ADMINS) {
    const u = await upsertUser(a.email, a.name, Role.ADMIN);
    console.log(`[ admin ] ${u.email}`);
  }

  // Tutores + perfis aprovados
  for (const t of TUTORS) {
    const user = await upsertUser(t.email, t.name, Role.TUTOR);
    const existing = await prisma.tutorProfile.findUnique({ where: { userId: user.id } });
    if (!existing) {
      await prisma.tutorProfile.create({
        data: {
          userId: user.id,
          bio: t.bio,
          subjects: t.subjects,
          levels: t.levels,
          hourlyRate: t.hourlyRate.toString(),
          status: TutorStatus.APPROVED,
          reviewedAt: new Date(),
          ratingAverage: t.ratingAverage,
          totalReviews: t.totalReviews,
          totalClasses: Math.floor(t.totalReviews * 1.4),
          totalStudents: Math.floor(t.totalReviews * 0.8),
        },
      });
      console.log(`[ tutor ] ${user.email} → perfil criado`);
    } else {
      console.log(`[ tutor ] ${user.email} → já existe`);
    }
  }

  // Estudantes
  for (const s of STUDENTS) {
    const u = await upsertUser(s.email, s.name, Role.STUDENT);
    console.log(`[ aluno ] ${u.email}`);
  }

  // Encarregado + dependente
  const guardian = await upsertUser(GUARDIAN.email, GUARDIAN.name, Role.GUARDIAN);
  const dependent = await upsertUser(
    GUARDIAN_DEPENDENT.email,
    GUARDIAN_DEPENDENT.name,
    Role.STUDENT,
    guardian.id,
  );
  console.log(`[ encarregado ] ${guardian.email} → dependente ${dependent.email}`);

  // Aulas de demonstração (1 por tutor, no futuro)
  const tutorProfiles = await prisma.tutorProfile.findMany({
    where: { status: TutorStatus.APPROVED },
    include: { user: true },
    take: 3,
  });

  const baseDate = new Date();
  baseDate.setDate(baseDate.getDate() + 3);
  baseDate.setHours(10, 0, 0, 0);

  for (let i = 0; i < tutorProfiles.length; i++) {
    const profile = tutorProfiles[i];
    const existing = await prisma.classSession.findFirst({
      where: { tutorId: profile.id, title: { contains: '[Demo]' } },
    });
    if (!existing) {
      const sessionDate = new Date(baseDate);
      sessionDate.setDate(sessionDate.getDate() + i);
      await prisma.classSession.create({
        data: {
          tutorId: profile.id,
          title: `[Demo] ${profile.subjects[0]} — Revisão`,
          subject: profile.subjects[0],
          type: ClassType.ONE_ON_ONE,
          maxCapacity: 1,
          scheduledAt: sessionDate,
          durationMin: 60,
        },
      });
      console.log(`[ aula ] demo para ${profile.user.email}`);
    }
  }

  // Ofertas de pacotes
  for (const offer of PACKAGE_OFFERS) {
    const existing = await prisma.packageOffer.findFirst({ where: { name: offer.name } });
    if (!existing) {
      await prisma.packageOffer.create({
        data: {
          name: offer.name,
          hours: offer.hours.toString(),
          price: offer.price.toString(),
          currency: 'AOA',
          validityDays: offer.validityDays,
          active: true,
        },
      });
      console.log(`[ pacote ] ${offer.name}`);
    } else {
      console.log(`[ pacote ] ${offer.name} → já existe`);
    }
  }

  console.log('');
  console.log('[ seed ] concluído ✓');
  console.log('');
  console.log('  Credenciais de acesso (desenvolvimento):');
  console.log(`  Password comum: ${DEV_PASSWORD}`);
  console.log('');
  console.log('  admin@educa.ao          → ADMIN');
  for (const t of TUTORS) {
    console.log(`  ${t.email.padEnd(36)} → TUTOR (${t.subjects[0]})`);
  }
  for (const s of STUDENTS) {
    console.log(`  ${s.email.padEnd(36)} → STUDENT`);
  }
  console.log(`  ${GUARDIAN.email.padEnd(36)} → GUARDIAN`);
}

main()
  .catch((e) => {
    console.error('[seed] erro:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
