import { base64UrlToBytes, bytesToBase64Url, randomBytes } from './encoding';
import { constantTimeEqual } from './constant-time';

export interface PasswordDigest {
  hash: string;
  salt: string;
  iterations: number;
}

const MINIMUM_ITERATIONS = 100_000;
const MAXIMUM_ITERATIONS = 100_000;

function normalizePassword(password: string): string {
  return password.normalize('NFKC');
}

async function derivePasswordHash(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  if (
    !Number.isSafeInteger(iterations)
    || iterations < MINIMUM_ITERATIONS
    || iterations > MAXIMUM_ITERATIONS
  ) {
    throw new Error('Password iteration setting is invalid');
  }
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(normalizePassword(password)),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  );
  return bytesToBase64Url(new Uint8Array(bits));
}

export async function hashPassword(password: string, iterations: number): Promise<PasswordDigest> {
  const salt = randomBytes(16);
  return {
    hash: await derivePasswordHash(password, salt, iterations),
    salt: bytesToBase64Url(salt),
    iterations,
  };
}

export async function verifyPassword(password: string, digest: PasswordDigest): Promise<boolean> {
  if (digest.hash === 'unusable' || digest.salt === 'unusable') return false;
  const candidate = await derivePasswordHash(password, base64UrlToBytes(digest.salt), digest.iterations);
  return constantTimeEqual(candidate, digest.hash);
}
