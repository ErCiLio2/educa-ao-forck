import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { PUBLIC_API_URL } from '$env/static/public';

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.user) {
    const role = locals.user.role;
    if (role === 'ADMIN') redirect(302, '/dashboard');
    redirect(302, '/');
  }
};

export const actions: Actions = {
  default: async ({ request, cookies, fetch }) => {
    const data = await request.formData();
    const email = data.get('email')?.toString() ?? '';
    const password = data.get('password')?.toString() ?? '';

    if (!email || !password) {
      return fail(422, { error: 'Email e palavra-passe são obrigatórios' });
    }

    let res: Response;
    try {
      res = await fetch(`${PUBLIC_API_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
    } catch {
      return fail(503, { error: 'Não foi possível contactar o servidor' });
    }

    const body = await res.json();

    if (!res.ok) {
      return fail(res.status, { error: body.error?.message ?? 'Credenciais inválidas' });
    }

    // MFA obrigatório para admin
    if (body.kind === 'mfa') {
      return { challenge: body.challenge as string };
    }

    // Login directo (não deveria acontecer para admin, mas tratamos)
    const accessToken: string = body.accessToken;
    const refreshToken = extractRefreshToken(res.headers.get('set-cookie'));

    cookies.set('access_token', accessToken, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 15 * 60,
    });
    if (refreshToken) {
      cookies.set('refresh_token', refreshToken, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60,
      });
    }
    const role: string = body.user?.role ?? '';
    const dest = role === 'ADMIN' ? '/dashboard'
      : role === 'TUTOR' ? '/tutor/painel'
      : role === 'GUARDIAN' ? '/encarregado/painel'
      : '/painel';
    redirect(302, dest);
  },
};

function extractRefreshToken(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const match = setCookie.match(/refresh_token=([^;]+)/);
  return match ? match[1] : null;
}
