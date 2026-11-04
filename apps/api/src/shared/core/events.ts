// Bus de eventos interno (síncrono no processo) para desacoplar módulos (RNF-MAN-01).
// Um módulo emite um facto; quem se interessa subscreve. Assim, "A avisa B" não obriga A a importar B,
// o que evita ciclos de dependência entre módulos. Quando houver BullMQ, a interface mantém-se.

export interface DomainEvents {
  'attendance.changed': { tutorId: string };
  'content.uploaded': { contentId: string; tutorProfileId: string; type: 'VIDEO' | 'DOCUMENT' };
  // Notificações — emitidos pelos módulos após acções com efeito visível para o utilizador
  'payment.confirmed': { userId: string; amount: string; currency: string; hours: number };
  'payment.failed': { userId: string; amount: string; currency: string };
  'payment.refunded': { userId: string; amount: string; currency: string };
  'booking.enrolled': { sessionId: string; studentId: string; tutorUserId: string; scheduledAt: string };
  'booking.enrollment_cancelled': { sessionId: string; studentId: string; tutorUserId: string };
  'tutor.status_changed': { userId: string; status: 'APPROVED' | 'REJECTED'; reason?: string };
  'role_change.decided': { targetId: string; toRole: string; approved: boolean };
  'content.ready': { contentId: string; tutorUserId: string; title: string };
}

type Handler<K extends keyof DomainEvents> = (payload: DomainEvents[K]) => Promise<void>;

// A API pública (on/emit) é tipada por evento; o armazenamento interno não precisa de o ser
const handlers = new Map<keyof DomainEvents, Set<Handler<keyof DomainEvents>>>();

// Registar a mesma função duas vezes é inofensivo (Set): buildApp() pode correr várias vezes nos testes
export function on<K extends keyof DomainEvents>(event: K, handler: Handler<K>): void {
  const set = handlers.get(event) ?? new Set<Handler<keyof DomainEvents>>();
  set.add(handler as Handler<keyof DomainEvents>);
  handlers.set(event, set);
}

// Espera pelos handlers, pelo que o efeito é visível quando a resposta sai. Um handler que falhe
// não derruba o emissor: é registado e o estado derivado recalcula-se no evento seguinte.
export async function emit<K extends keyof DomainEvents>(event: K, payload: DomainEvents[K]): Promise<void> {
  for (const handler of handlers.get(event) ?? []) {
    try {
      await handler(payload);
    } catch (err) {
      console.error(`[Events] handler de "${event}" falhou:`, err);
    }
  }
}
