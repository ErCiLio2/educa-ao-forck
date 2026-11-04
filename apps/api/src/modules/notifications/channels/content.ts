import type { NotifTypeValue } from '../notifications.types';

export type NotifContent = { title: string; body: string };

export function getContent(type: NotifTypeValue, data: Record<string, unknown>): NotifContent {
  switch (type) {
    case 'PAYMENT_CONFIRMED':
      return {
        title: 'Pagamento confirmado',
        body: `O teu pagamento de ${data.amount} ${data.currency} foi confirmado. Recebeste ${data.hours} horas.`,
      };
    case 'PAYMENT_FAILED':
      return {
        title: 'Pagamento falhado',
        body: `O teu pagamento de ${data.amount} ${data.currency} não foi processado. Tenta novamente.`,
      };
    case 'BOOKING_ENROLLED':
      return {
        title: 'Inscrição confirmada',
        body: `Inscreveste-te na aula agendada para ${data.scheduledAt}.`,
      };
    case 'BOOKING_ENROLLMENT_CANCELLED':
      return {
        title: 'Inscrição cancelada',
        body: 'A tua inscrição numa aula foi cancelada e as horas foram devolvidas.',
      };
    case 'TUTOR_APPROVED':
      return {
        title: 'Perfil de tutor aprovado',
        body: 'O teu perfil de tutor foi aprovado. Já podes criar aulas.',
      };
    case 'TUTOR_REJECTED':
      return {
        title: 'Perfil de tutor rejeitado',
        body: data.reason
          ? `O teu perfil foi rejeitado. Motivo: ${data.reason}`
          : 'O teu perfil foi rejeitado. Contacta o suporte para mais informações.',
      };
    case 'ROLE_CHANGE_APPROVED':
      return {
        title: 'Papel alterado',
        body: `O teu pedido de alteração de papel para ${data.toRole} foi aprovado. Volta a iniciar sessão para activar.`,
      };
    case 'ROLE_CHANGE_REJECTED':
      return {
        title: 'Pedido rejeitado',
        body: `O teu pedido de alteração de papel para ${data.toRole} foi rejeitado.`,
      };
    case 'CONTENT_READY':
      return {
        title: 'Conteúdo pronto',
        body: `O teu conteúdo "${data.title}" já está disponível no modo Data-Lite.`,
      };
  }
}
