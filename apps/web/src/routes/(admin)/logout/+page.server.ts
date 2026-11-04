import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { PUBLIC_API_URL } from '$env/static/public';

export const actions: Actions = {
  default: async ({ cookies, locals, fetch }) => {
    if (locals.token) {
      try {
        await fetch(`${PUBLIC_API_URL}/api/v1/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${locals.token}` },
        });
      } catch {
        // ignora falhas de rede — limpa os cookies de qualquer forma
      }
    }

    cookies.delete('access_token', { path: '/' });
    cookies.delete('refresh_token', { path: '/' });
    redirect(302, '/login');
  },
};
