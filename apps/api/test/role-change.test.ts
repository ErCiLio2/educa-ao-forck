import { describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { changeUserRole } from '../src/modules/auth/auth.service';

// Regras de integridade da alteração de papel, com uma transacção simulada. A regra do "último
// administrador" não se consegue exercitar numa BD de testes partilhada (há sempre mais admins).
interface FakeUser { role: string; guardianId: string | null; birthDate: Date | null; _count: { dependents: number } }

function fakeTx(opts: { admins?: number; user?: Partial<FakeUser> | null }) {
  const updates: unknown[] = [];
  const tx = {
    $queryRaw: async () => Array.from({ length: opts.admins ?? 2 }, (_, i) => ({ id: `a${i}` })),
    user: {
      findUnique: async () =>
        opts.user === null ? null : { role: 'ADMIN', guardianId: null, birthDate: null, _count: { dependents: 0 }, ...opts.user },
      update: async (args: unknown) => { updates.push(args); },
    },
  } as unknown as Prisma.TransactionClient;
  return { tx, updates };
}

describe('changeUserRole', () => {
  it('não deixa o sistema sem administradores', async () => {
    const { tx, updates } = fakeTx({ admins: 1 });
    await expect(changeUserRole(tx, 'u', 'ADMIN', 'TUTOR')).rejects.toThrow(/último administrador/);
    expect(updates).toHaveLength(0);
  });

  it('com 2 ou mais administradores, despromover é possível', async () => {
    const { tx, updates } = fakeTx({ admins: 2 });
    await changeUserRole(tx, 'u', 'ADMIN', 'TUTOR');
    expect(updates).toHaveLength(1);
  });

  it('promover não exige contar administradores', async () => {
    const { tx, updates } = fakeTx({ admins: 1, user: { role: 'TUTOR' } });
    await changeUserRole(tx, 'u', 'TUTOR', 'ADMIN');
    expect(updates).toHaveLength(1);
  });

  it('recusa se o papel mudou entre o pedido e a aprovação', async () => {
    const { tx } = fakeTx({ user: { role: 'GUARDIAN' } });
    await expect(changeUserRole(tx, 'u', 'TUTOR', 'ADMIN')).rejects.toThrow(/mudou entretanto/);
  });

  it('recusa dependentes e encarregados com dependentes', async () => {
    await expect(changeUserRole(fakeTx({ user: { role: 'STUDENT', guardianId: 'g' } }).tx, 'u', 'STUDENT', 'TUTOR')).rejects.toThrow(/dependentes/);
    await expect(changeUserRole(fakeTx({ user: { role: 'GUARDIAN', _count: { dependents: 2 } } }).tx, 'u', 'GUARDIAN', 'TUTOR')).rejects.toThrow(/dependentes/);
  });

  it('um aluno exige data de nascimento', async () => {
    await expect(changeUserRole(fakeTx({ user: { role: 'TUTOR', birthDate: null } }).tx, 'u', 'TUTOR', 'STUDENT')).rejects.toThrow(/nascimento/);
  });

  it('utilizador inexistente → 404', async () => {
    await expect(changeUserRole(fakeTx({ user: null }).tx, 'u', 'TUTOR', 'ADMIN')).rejects.toThrow(/não encontrado/);
  });
});
