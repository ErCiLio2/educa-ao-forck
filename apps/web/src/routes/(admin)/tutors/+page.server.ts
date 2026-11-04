import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { PUBLIC_API_URL } from '$env/static/public';

export const load: PageServerLoad = async ({ locals, fetch, url }) => {
  const page = Number(url.searchParams.get('page') ?? 1);
  const limit = 20;

  const res = await fetch(
    `${PUBLIC_API_URL}/api/v1/tutors/admin/pending?page=${page}&limit=${limit}`,
    { headers: { Authorization: `Bearer ${locals.token}` } },
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    error(res.status, body.error?.message ?? 'Erro ao carregar tutores');
  }

  const body = await res.json();
  return { tutors: body.tutors, total: body.total, page, limit };
};

export const actions: Actions = {
  review: async ({ request, locals, fetch }) => {
    const data = await request.formData();
    const id = data.get('id')?.toString() ?? '';
    const status = data.get('status')?.toString() ?? '';
    const reason = data.get('reason')?.toString() ?? undefined;

    if (!id || !['APPROVED', 'REJECTED'].includes(status)) {
      return fail(422, { error: 'Dados inválidos' });
    }
    if (status === 'REJECTED' && !reason?.trim()) {
      return fail(422, { error: 'Motivo de rejeição obrigatório' });
    }

    const res = await fetch(`${PUBLIC_API_URL}/api/v1/tutors/${id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${locals.token}`,
      },
      body: JSON.stringify({ status, reason: reason ?? null }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return fail(res.status, { error: body.error?.message ?? 'Operação falhou' });
    }

    return { success: true };
  },
};
