import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, generateSecret, hotp, otpauthUrl, totp, verifyTotp } from '../src/shared/core/totp';
import { decrypt, encrypt, hmac } from '../src/shared/core/crypto';

// RFC 6238, Apêndice B: segredo ASCII "12345678901234567890" (SHA-1). Os vectores oficiais têm 8 dígitos;
// os 6 dígitos são os 6 últimos.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));
const RFC_VECTORS: Array<[number, string]> = [
  [59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'],
  [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130'],
];

describe('TOTP (RFC 6238)', () => {
  it.each(RFC_VECTORS)('vector oficial t=%i → %s', (t, expected) => {
    expect(totp(RFC_SECRET, t * 1000, 8)).toBe(expected);
    expect(totp(RFC_SECRET, t * 1000)).toBe(expected.slice(2));
  });

  it('HOTP (RFC 4226, Apêndice D)', () => {
    const secret = Buffer.from('12345678901234567890');
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    expected.forEach((code, counter) => expect(hotp(secret, counter)).toBe(code));
  });

  it('base32 faz round-trip e rejeita lixo', () => {
    const buf = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(base32Decode(base32Encode(buf))).toEqual(buf);
    expect(() => base32Decode('abc!')).toThrow();
    expect(generateSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('verifica com tolerância de ±1 passo e devolve o passo', () => {
    const now = 1_700_000_000_000;
    const code = totp(RFC_SECRET, now);
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(RFC_SECRET, code, now)).toBe(step);
    expect(verifyTotp(RFC_SECRET, code, now + 30_000)).toBe(step); // relógio 1 passo adiantado
    expect(verifyTotp(RFC_SECRET, code, now - 30_000)).toBe(step);
    expect(verifyTotp(RFC_SECRET, code, now + 90_000)).toBeNull(); // 3 passos: fora da janela
  });

  it('recusa formatos inválidos e códigos errados', () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 456', '000000']) {
      expect(verifyTotp(RFC_SECRET, bad, 59_000)).toBeNull();
    }
  });

  it('gera um otpauth:// válido para as apps de autenticação', () => {
    const url = otpauthUrl('ABCDEFGH', 'admin@educa.ao', 'Educa');
    expect(url).toMatch(/^otpauth:\/\/totp\/Educa%3Aadmin%40educa\.ao\?/);
    expect(url).toContain('secret=ABCDEFGH');
    expect(url).toContain('issuer=Educa');
  });
});

describe('cifragem AES-256-GCM', () => {
  it('cifra e decifra; cada cifra é diferente (IV aleatório)', () => {
    const a = encrypt('JBSWY3DPEHPK3PXP', 'user-1');
    const b = encrypt('JBSWY3DPEHPK3PXP', 'user-1');
    expect(a).not.toBe(b);
    expect(a).not.toContain('JBSWY3DP');
    expect(decrypt(a, 'user-1')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('não decifra noutro contexto (valor copiado para outro utilizador)', () => {
    expect(() => decrypt(encrypt('segredo', 'user-1'), 'user-2')).toThrow();
  });

  it('detecta adulteração e formatos inválidos', () => {
    const [v, iv, tag, ct] = encrypt('segredo', 'u').split(':');
    const flipped = Buffer.from(ct, 'base64');
    flipped[0] ^= 1;
    expect(() => decrypt([v, iv, tag, flipped.toString('base64')].join(':'), 'u')).toThrow();
    expect(() => decrypt('lixo', 'u')).toThrow();
    expect(() => decrypt(`v9:${iv}:${tag}:${ct}`, 'u')).toThrow();
  });

  it('hmac é determinístico e depende da chave do servidor', () => {
    expect(hmac('codigo')).toBe(hmac('codigo'));
    expect(hmac('codigo')).not.toBe(hmac('outro'));
    expect(hmac('codigo')).toMatch(/^[0-9a-f]{64}$/);
  });
});
