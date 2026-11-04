import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { PUBLIC_API_URL } from '$env/static/public';

export const load: PageServerLoad = async ({ locals, fetch, url }) => {
  const page = Number(url.searchParams.get('page') ?? 1);
  const status = url.searchParams.get('status') ?? 'PENDING';
  const limit = 20;

  const params = new URLSearchParams({ page: String(page), limit: String(limit), status });
  const res = await fetch(`${PUBLIC_API_URL}/api/v1/admin/role-changes?${params}`, {
    headers: { Authorization: `Bearer ${locals.token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    error(res.status, body.error?.message ?? 'Erro ao carregar pedidos');
  }

  const body = await res.json();
  return { requests: body.requests, total: body.total, page, limit, status };
};

export const actions: Actions = {
  approve: async ({ request, locals, fetch }) => {
    const data = await request.formData();
    const id = data.get('id')?.toString() ?? '';

    const res = await fetch(`${PUBLIC_API_URL}/api/v1/admin/role-changes/${id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${locals.token}` },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return fail(res.status, { error: body.error?.message ?? 'Operação falhou' });
    }

    return { success: true };
  },

  reject: async ({ request, locals, fetch }) => {
    const data = await request.formData();
    const id = data.get('id')?.toString() ?? '';

    const res = await fetch(`${PUBLIC_API_URL}/api/v1/admin/role-changes/${id}/reject`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${locals.token}` },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return fail(res.status, { error: body.error?.message ?? 'Operação falhou' });
    }

    return { success: true };
  },
};
