import { describe, expect, it } from 'vitest';
import { ChangePasswordSchema, UpdateProfileSchema } from '../src/modules/auth/auth.types';
import { UpdateTutorProfileSchema } from '../src/modules/tutors/tutors.types';
import { PasswordSchema } from '../src/shared/core/schemas';

describe('password', () => {
  it('exige maiúscula, número e tamanho entre 8 e 128', () => {
    expect(PasswordSchema.safeParse('Abcdefg1').success).toBe(true);
    for (const bad of ['abcdefg1', 'Abcdefgh', 'Abc1', `A1${'x'.repeat(130)}`]) {
      expect(PasswordSchema.safeParse(bad).success, bad.slice(0, 12)).toBe(false);
    }
  });
});

describe('NameSchema', () => {
  it('apara espaços e recusa nomes que ficam vazios ou curtos depois disso', async () => {
    const { NameSchema } = await import('../src/shared/core/schemas');
    expect(NameSchema.parse('  Maria Silva  ')).toBe('Maria Silva');
    for (const bad of ['', '  ', ' A ', 'x'.repeat(101)]) expect(NameSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});

describe('ChangePasswordSchema', () => {
  it('a nova password tem de ser forte e diferente da actual', () => {
    expect(ChangePasswordSchema.safeParse({ currentPassword: 'Antiga123', newPassword: 'Nova12345' }).success).toBe(true);
    expect(ChangePasswordSchema.safeParse({ currentPassword: 'Igual1234', newPassword: 'Igual1234' }).success).toBe(false);
    expect(ChangePasswordSchema.safeParse({ currentPassword: 'Antiga123', newPassword: 'fraca' }).success).toBe(false);
    expect(ChangePasswordSchema.safeParse({ newPassword: 'Nova12345' }).success).toBe(false);
  });
});

describe('UpdateProfileSchema', () => {
  it('exige algo para actualizar e a password actual para mudar o email', () => {
    expect(UpdateProfileSchema.safeParse({}).success).toBe(false);
    expect(UpdateProfileSchema.safeParse({ name: 'Ana Silva' }).success).toBe(true);
    expect(UpdateProfileSchema.safeParse({ email: 'novo@x.com' }).success).toBe(false);
    expect(UpdateProfileSchema.safeParse({ email: 'novo@x.com', currentPassword: 'Abcdefg1' }).success).toBe(true);
  });
  it('normaliza o email e recusa nomes curtos; não aceita mudar o papel nem a data de nascimento', () => {
    expect(UpdateProfileSchema.parse({ email: '  Novo@X.COM ', currentPassword: 'x' }).email).toBe('novo@x.com');
    expect(UpdateProfileSchema.safeParse({ name: 'A' }).success).toBe(false);
    const parsed = UpdateProfileSchema.parse({ name: 'Ana Silva', role: 'ADMIN', birthDate: '2000-01-01' });
    expect(parsed).toEqual({ name: 'Ana Silva' }); // campos desconhecidos são descartados
  });
});

describe('UpdateTutorProfileSchema', () => {
  it('bio opcional (null apaga), disciplinas 1..20, pelo menos um campo', () => {
    expect(UpdateTutorProfileSchema.safeParse({}).success).toBe(false);
    expect(UpdateTutorProfileSchema.safeParse({ bio: null }).success).toBe(true);
    expect(UpdateTutorProfileSchema.safeParse({ subjects: [] }).success).toBe(false);
    expect(UpdateTutorProfileSchema.safeParse({ subjects: Array(21).fill('M') }).success).toBe(false);
    expect(UpdateTutorProfileSchema.safeParse({ bio: 'x'.repeat(1001) }).success).toBe(false);
    expect(UpdateTutorProfileSchema.parse({ bio: '  olá  ' }).bio).toBe('olá');
  });
});
