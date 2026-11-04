import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { PUBLIC_API_URL } from '$env/static/public';

export const load: PageServerLoad = async ({ locals, url }) => {
  if (locals.user) {
    const role = locals.user.role;
    const dest = role === 'ADMIN' ? '/dashboard'
      : role === 'TUTOR' ? '/tutor/painel'
      : role === 'GUARDIAN' ? '/encarregado/painel'
      : '/painel';
    redirect(302, dest);
  }
  return { papel: url.searchParams.get('papel') ?? '' };
};

export const actions: Actions = {
  default: async ({ request, cookies, fetch }) => {
    const data = await request.formData();
    const role       = data.get('role')?.toString() ?? '';
    const fullName   = data.get('fullName')?.toString().trim() ?? '';
    const email      = data.get('email')?.toString().trim() ?? '';
    const password   = data.get('password')?.toString() ?? '';
    const birthDate  = data.get('birthDate')?.toString() ?? '';
    const terms      = data.get('terms');

    if (!role || !fullName || !email || !password) {
      return fail(422, { error: 'Preenche todos os campos obrigatórios.' });
    }
    if (!terms) {
      return fail(422, { error: 'Tens de aceitar os termos e condições.' });
    }

    const payload: Record<string, string> = {
      role: role.toUpperCase(),
      fullName,
      email,
      password,
    };
    if (role === 'aluno' && birthDate) payload.birthDate = birthDate;

    let res: Response;
    try {
      res = await fetch(`${PUBLIC_API_URL}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      return fail(503, { error: 'Não foi possível contactar o servidor.' });
    }

    const body = await res.json();
    if (!res.ok) {
      return fail(res.status, { error: body.error?.message ?? 'Erro ao criar conta.' });
    }

    // Registo com login automático (se a API devolver accessToken)
    if (body.accessToken) {
      const refreshToken = (() => {
        const match = res.headers.get('set-cookie')?.match(/refresh_token=([^;]+)/);
        return match ? match[1] : null;
      })();
      cookies.set('access_token', body.accessToken, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 15 * 60 });
      if (refreshToken) {
        cookies.set('refresh_token', refreshToken, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 });
      }
      const dest = role === 'tutor' ? '/tutor/painel' : role === 'encarregado' ? '/encarregado/painel' : '/painel';
      redirect(302, dest);
    }

    // Se não há login automático, redireciona para o login com mensagem
    redirect(302, '/login?registado=1');
  },
};
