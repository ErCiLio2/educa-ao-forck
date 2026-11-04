import prisma from '../src/shared/core/database';
import redis from '../src/shared/core/redis';
import { revokeUserSessions } from '../src/modules/auth/auth.service';
import { writeAuditLog } from '../src/shared/core/audit';

// Saída de emergência: administrador que perdeu o autenticador E os códigos de recuperação.
// Não existe endpoint para isto de propósito (seria uma porta de entrada para contornar o MFA): exige acesso
// à BD e ao Redis, ou seja, a um operador. Desactiva o MFA, apaga os códigos, revoga as sessões e audita.
// O administrador entra só com a password e tem de configurar o MFA outra vez antes de poder administrar.
// Uso: pnpm --filter educa-api mfa:reset <email>
async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error('Uso: mfa:reset <email>');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true, mfaEnabled: true } });
  if (!user) {
    console.error(`Utilizador ${email} não encontrado`);
    process.exit(1);
  }
  if (!user.mfaEnabled) {
    console.log(`${email} não tem MFA activo — nada a fazer`);
    return;
  }

  await prisma.$transaction([
    prisma.mfaRecoveryCode.deleteMany({ where: { userId: user.id } }),
    prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: false, mfaSecret: null, mfaEnabledAt: null } }),
  ]);
  await revokeUserSessions(user.id);
  await writeAuditLog({ entityType: 'User', entityId: user.id, action: 'MFA_RESET_BY_OPERATOR' });
  console.log(`MFA de ${email} reposto. Tem de o configurar de novo no próximo login.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await redis.quit();
  });
