import type { FastifyReply, FastifyRequest } from 'fastify';
import { ForbiddenError, UnauthorizedError } from '../../shared/core/errors';
import { getConsentStatus } from './guardians.service';

// Usar depois de `authenticate` em toda a rota que trate dados de um aluno (agendamento,
// pagamentos, histórico...). Avalia a BD em cada pedido, por isso a revogação tem efeito imediato.
export async function requireConsent(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!request.user) throw new UnauthorizedError();
  if (request.user.role !== 'STUDENT') return;

  const { required, granted } = await getConsentStatus(request.user.id);
  if (required && !granted) {
    throw new ForbiddenError('Aguarda o consentimento do Encarregado de Educação');
  }
}
