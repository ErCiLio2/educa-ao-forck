import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// TOTP (RFC 6238) sobre HOTP (RFC 4226), HMAC-SHA1, 30 s, 6 dígitos — compatível com Google Authenticator,
// Microsoft Authenticator, Authy, 1Password, etc. Sem dependências: o algoritmo é curto e tem vectores de teste oficiais.

const STEP_SECONDS = 30;
const DIGITS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error('base32 inválido');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// 160 bits, o tamanho recomendado pelo RFC 4226
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return code.toString().padStart(digits, '0');
}

export const stepOf = (nowMs: number) => Math.floor(nowMs / 1000 / STEP_SECONDS);

export function totp(secretBase32: string, nowMs = Date.now(), digits = DIGITS): string {
  return hotp(base32Decode(secretBase32), stepOf(nowMs), digits);
}

// Devolve o passo (time-step) que corresponde ao código, ou null. Tolera ±window passos
// (relógios ligeiramente desfasados). O passo devolvido serve para impedir a reutilização do código.
export function verifyTotp(secretBase32: string, code: string, nowMs = Date.now(), window = 1): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretBase32);
  const current = stepOf(nowMs);
  const given = Buffer.from(code);
  let matched: number | null = null;
  // Percorre sempre todos os passos (sem sair cedo) para não variar o tempo consoante o acerto
  for (let step = current - window; step <= current + window; step++) {
    const expected = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(given, expected) && matched === null) matched = step;
  }
  return matched;
}

export function otpauthUrl(secretBase32: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
