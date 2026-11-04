import webpush from 'web-push';
import jwt from 'jsonwebtoken';
import { env } from '../../../shared/core/env';
import prisma from '../../../shared/core/database';
import { getContent } from './content';
import type { NotifTypeValue } from '../notifications.types';

export const PUSH_CHANNEL = 'PUSH' as const;

export function isPushConfigured(): boolean {
  return !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) || !!env.FCM_SERVICE_ACCOUNT_JSON;
}

// ── Web Push (VAPID) ──────────────────────────────────────────────────────────

let vapidInitialised = false;
function initVapid() {
  if (vapidInitialised || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  vapidInitialised = true;
}

// ── FCM HTTP v1 (sem firebase-admin SDK) ─────────────────────────────────────

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

let fcmAccount: ServiceAccount | null = null;
let fcmAccessToken: { token: string; expiresAt: number } | null = null;

function getServiceAccount(): ServiceAccount | null {
  if (fcmAccount) return fcmAccount;
  if (!env.FCM_SERVICE_ACCOUNT_JSON) return null;
  try {
    fcmAccount = JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON) as ServiceAccount;
    return fcmAccount;
  } catch {
    console.error('[Push] FCM_SERVICE_ACCOUNT_JSON inválido');
    return null;
  }
}

async function getFcmAccessToken(): Promise<string | null> {
  const account = getServiceAccount();
  if (!account) return null;

  if (fcmAccessToken && Date.now() < fcmAccessToken.expiresAt) return fcmAccessToken.token;

  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss: account.client_email,
      sub: account.client_email,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
    },
    account.private_key,
    { algorithm: 'RS256' },
  );

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!res.ok) {
    console.error('[Push] falha ao obter token FCM:', await res.text());
    return null;
  }
  const { access_token, expires_in } = (await res.json()) as { access_token: string; expires_in: number };
  fcmAccessToken = { token: access_token, expiresAt: Date.now() + (expires_in - 120) * 1000 };
  return access_token;
}

async function sendFcm(fcmToken: string, title: string, body: string): Promise<void> {
  const account = getServiceAccount();
  if (!account) return;
  const accessToken = await getFcmAccessToken();
  if (!accessToken) return;

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { token: fcmToken, notification: { title, body } } }),
    },
  );
  if (!res.ok) console.error('[Push] FCM send failed:', await res.text());
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

export async function sendPush(userId: string, type: NotifTypeValue, data: Record<string, unknown>): Promise<void> {
  const tokens = await prisma.pushToken.findMany({ where: { userId } });
  if (tokens.length === 0) return;

  const { title, body } = getContent(type, data);
  const payload = JSON.stringify({ title, body });

  for (const t of tokens) {
    try {
      if (t.p256dh && t.auth) {
        // Web Push (VAPID)
        initVapid();
        await webpush.sendNotification(
          { endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
          payload,
        );
      } else {
        // FCM
        await sendFcm(t.token, title, body);
      }
    } catch (err) {
      console.error(`[Push] falha a enviar para token ${t.id}:`, (err as Error).message);
      // Token inválido/expirado → remover
      if ((err as { statusCode?: number }).statusCode === 410) {
        await prisma.pushToken.delete({ where: { id: t.id } }).catch(() => {});
      }
    }
  }
}
