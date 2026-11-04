import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { PUBLIC_API_URL } from '$env/static/public';

export const load: PageServerLoad = async ({ locals, url }) => {
  if (locals.user) redirect(302, '/dashboard');
  const challenge = url.searchParams.get('challenge');
  if (!challenge) redirect(302, '/login');
  return { challenge };
};

export const actions: Actions = {
  default: async ({ request, cookies, fetch }) => {
    const data = await request.formData();
    const challenge = data.get('challenge')?.toString() ?? '';
    const code = data.get('code')?.toString().replace(/\s/g, '') ?? '';

    if (!code || code.length !== 6) {
      return fail(422, { challenge, error: 'Código de 6 dígitos obrigatório' });
    }

    let res: Response;
    try {
      res = await fetch(`${PUBLIC_API_URL}/api/v1/auth/mfa/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge, code }),
      });
    } catch {
      return fail(503, { challenge, error: 'Não foi possível contactar o servidor' });
    }

    const body = await res.json();
    if (!res.ok) {
      return fail(res.status, { challenge, error: body.error?.message ?? 'Código inválido' });
    }

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
    redirect(302, '/dashboard');
  },
};

function extractRefreshToken(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const match = setCookie.match(/refresh_token=([^;]+)/);
  return match ? match[1] : null;
}
