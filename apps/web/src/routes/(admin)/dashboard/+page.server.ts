import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { PUBLIC_API_URL } from '$env/static/public';

export const load: PageServerLoad = async ({ locals, fetch, url }) => {
  const days = Number(url.searchParams.get('days') ?? 30);

  const res = await fetch(
    `${PUBLIC_API_URL}/api/v1/activity/admin/metrics?days=${days}`,
    { headers: { Authorization: `Bearer ${locals.token}` } },
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    error(res.status, body.error?.message ?? 'Erro ao carregar métricas');
  }

  const body = await res.json();
  return { metrics: body.metrics, days };
};
