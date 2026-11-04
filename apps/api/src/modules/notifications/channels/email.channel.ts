import nodemailer from 'nodemailer';
import { env } from '../../../shared/core/env';
import prisma from '../../../shared/core/database';
import { getContent } from './content';
import type { NotifTypeValue } from '../notifications.types';

export const EMAIL_CHANNEL = 'EMAIL' as const;

export function isEmailConfigured(): boolean {
  return !!env.SMTP_HOST;
}

function getTransporter() {
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
}

export async function sendEmail(userId: string, type: NotifTypeValue, data: Record<string, unknown>): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
  if (!user) return;

  const { title, body } = getContent(type, data);
  const transporter = getTransporter();

  await transporter.sendMail({
    from: env.SMTP_FROM,
    to: user.email,
    subject: title,
    text: `Olá ${user.name},\n\n${body}\n\n— Equipa Educa`,
    html: `<p>Olá <strong>${user.name}</strong>,</p><p>${body}</p><p>— Equipa Educa</p>`,
  });
}
