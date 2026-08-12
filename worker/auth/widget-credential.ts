import { base64UrlToBytes, bytesToBase64Url, randomBytes, sha256Base64Url } from './encoding';

export interface EncryptedWidgetCredential {
  token: string;
  tokenHash: string;
  ciphertext: string;
  iv: string;
  suffix: string;
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const raw = base64UrlToBytes(secret);
  if (raw.byteLength !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be a 32-byte base64url value');
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function createWidgetCredential(secret: string): Promise<EncryptedWidgetCredential> {
  const token = `dtw_${bytesToBase64Url(randomBytes(32))}`;
  const ivBytes = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ivBytes },
    await encryptionKey(secret),
    new TextEncoder().encode(token),
  );
  return {
    token,
    tokenHash: await sha256Base64Url(token),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    iv: bytesToBase64Url(ivBytes),
    suffix: token.slice(-6),
  };
}

export async function decryptWidgetCredential(
  secret: string,
  ciphertext: string,
  iv: string,
): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlToBytes(iv) },
    await encryptionKey(secret),
    base64UrlToBytes(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}
