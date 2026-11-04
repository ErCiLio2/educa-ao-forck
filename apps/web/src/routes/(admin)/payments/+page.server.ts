import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { PUBLIC_API_URL } from '$env/static/public';

export const load: PageServerLoad = async ({ locals, fetch }) => {
  const res = await fetch(`${PUBLIC_API_URL}/api/v1/payments/offers/all`, {
    headers: { Authorization: `Bearer ${locals.token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    error(res.status, body.error?.message ?? 'Erro ao carregar pacotes');
  }

  const body = await res.json();
  return { offers: body.offers };
};

export const actions: Actions = {
  create: async ({ request, locals, fetch }) => {
    const data = await request.formData();
    const name = data.get('name')?.toString().trim() ?? '';
    const hours = Number(data.get('hours'));
    const price = Number(data.get('price'));
    const validityDays = data.get('validityDays') ? Number(data.get('validityDays')) : undefined;

    if (!name || isNaN(hours) || isNaN(price)) {
      return fail(422, { createError: 'Preencha todos os campos obrigatórios.' });
    }

    const res = await fetch(`${PUBLIC_API_URL}/api/v1/payments/offers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${locals.token}`,
      },
      body: JSON.stringify({ name, hours, price, currency: 'AOA', validityDays }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return fail(res.status, { createError: body.error?.message ?? 'Erro ao criar pacote' });
    }

    return { created: true };
  },

  toggle: async ({ request, locals, fetch }) => {
    const data = await request.formData();
    const id = data.get('id')?.toString() ?? '';
    const active = data.get('active') === 'true';

    const res = await fetch(`${PUBLIC_API_URL}/api/v1/payments/offers/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${locals.token}`,
      },
      body: JSON.stringify({ active }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return fail(res.status, { toggleError: body.error?.message ?? 'Erro ao actualizar pacote' });
    }

    return { toggled: true };
  },
};
