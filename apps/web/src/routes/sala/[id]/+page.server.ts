import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { PUBLIC_API_URL } from '$env/static/public';

export const load: PageServerLoad = async ({ params, locals, fetch }) => {
  if (!locals.user) redirect(302, '/login');

  const { id } = params;

  // Carrega os dados da sessão
  const sessionRes = await fetch(`${PUBLIC_API_URL}/api/v1/bookings/sessions/${id}`, {
    headers: locals.token ? { Authorization: `Bearer ${locals.token}` } : {},
  });
  if (!sessionRes.ok) {
    error(sessionRes.status === 404 ? 404 : 403, 'Aula não encontrada ou sem acesso');
  }
  const { session } = await sessionRes.json();

  // Obtém o token LiveKit
  const tokenRes = await fetch(`${PUBLIC_API_URL}/api/v1/bookings/sessions/${id}/join-token`, {
    headers: locals.token ? { Authorization: `Bearer ${locals.token}` } : {},
  });
  if (!tokenRes.ok) {
    error(403, 'Não foi possível obter o token de acesso à sala');
  }
  const livekit = await tokenRes.json();

  return {
    session,
    livekit: livekit as { token: string; url: string; room: string },
    user: locals.user,
    token: locals.token,
  };
};
