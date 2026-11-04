import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { PUBLIC_API_URL } from '$env/static/public';

export const load: PageServerLoad = async ({ locals, fetch, url }) => {
  const page = Number(url.searchParams.get('page') ?? 1);
  const limit = 25;
  const q = url.searchParams.get('q') ?? '';

  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (q) params.set('q', q);

  const res = await fetch(`${PUBLIC_API_URL}/api/v1/admin/users?${params}`, {
    headers: { Authorization: `Bearer ${locals.token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    error(res.status, body.error?.message ?? 'Erro ao carregar utilizadores');
  }

  const body = await res.json();
  return { users: body.users, total: body.total, page, limit, q };
};
