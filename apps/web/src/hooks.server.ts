import type { Handle } from '@sveltejs/kit';
import { PUBLIC_API_URL } from '$env/static/public';

export const handle: Handle = async ({ event, resolve }) => {
  const accessToken = event.cookies.get('access_token');

  event.locals.token = null;
  event.locals.user = null;

  if (accessToken) {
    // Valida o token chamando /auth/me
    try {
      const res = await event.fetch(`${PUBLIC_API_URL}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const body = await res.json();
        event.locals.token = accessToken;
        event.locals.user = body.user;
      } else {
        // Token expirado: tenta refresh
        await tryRefresh(event);
      }
    } catch {
      await tryRefresh(event);
    }
  } else {
    await tryRefresh(event);
  }

  return resolve(event);
};

async function tryRefresh(event: Parameters<Handle>[0]['event']): Promise<void> {
  const refreshToken = event.cookies.get('refresh_token');
  if (!refreshToken) return;

  try {
    const res = await event.fetch(`${PUBLIC_API_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { cookie: `refresh_token=${refreshToken}` },
    });
    if (!res.ok) return;

    const body = await res.json();
    const newToken: string = body.accessToken;

    event.cookies.set('access_token', newToken, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 15 * 60,
    });

    // Extrai o refresh token do Set-Cookie da resposta e repropaga
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const match = setCookie.match(/refresh_token=([^;]+)/);
      if (match) {
        event.cookies.set('refresh_token', match[1], {
          path: '/',
          httpOnly: true,
          sameSite: 'lax',
          maxAge: 7 * 24 * 60 * 60,
        });
      }
    }

    // Carrega os dados do utilizador com o novo token
    const meRes = await event.fetch(`${PUBLIC_API_URL}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${newToken}` },
    });
    if (meRes.ok) {
      const me = await meRes.json();
      event.locals.token = newToken;
      event.locals.user = me.user;
    }
  } catch {
    // refresh falhou — utilizador não autenticado
  }
}
