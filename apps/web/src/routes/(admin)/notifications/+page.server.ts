import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { PUBLIC_API_URL } from '$env/static/public';

export const load: PageServerLoad = async ({ locals, fetch }) => {
  const res = await fetch(`${PUBLIC_API_URL}/api/v1/notifications/admin/channels`, {
    headers: { Authorization: `Bearer ${locals.token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    error(res.status, body.error?.message ?? 'Erro ao carregar canais');
  }

  const body = await res.json();
  return { channels: body.channels };
};

export const actions: Actions = {
  toggle: async ({ request, locals, fetch }) => {
    const data = await request.formData();
    const channel = data.get('channel')?.toString() ?? '';
    const enabled = data.get('enabled') === 'true';

    const res = await fetch(`${PUBLIC_API_URL}/api/v1/notifications/admin/channels/${channel}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${locals.token}`,
      },
      body: JSON.stringify({ enabled }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return fail(res.status, { error: body.error?.message ?? 'Operação falhou' });
    }

    return { success: true };
  },
};
