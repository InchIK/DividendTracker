import { base64UrlToBytes, bytesToBase64Url, randomBytes } from '../auth/encoding';

export const FINMIND_API_TOKEN_SETTING_KEY = 'finmind_api_token_encrypted';

export type FinmindTokenSource = 'database' | 'environment' | 'none';

export interface FinmindTokenStatus {
  configured: boolean;
  source: FinmindTokenSource;
  updatedAt: string | null;
  storedTokenInvalid: boolean;
}

export interface FinmindTokenResolution extends FinmindTokenStatus {
  token: string | null;
}

interface FinmindTokenSettingRow {
  setting_value: string;
  updated_at: string | null;
}

interface EncryptedFinmindTokenSetting {
  version: 1;
  ciphertext: string;
  iv: string;
}

const FINMIND_TOKEN_PATTERN = /^[\x21-\x7E]+$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Read the optional Cloudflare Secret without adding it to the generated Env type. */
export function readOptionalFinmindEnvToken(env: Env): string | null {
  const value: unknown = Reflect.get(env, 'FINMIND_API_TOKEN');
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Normalize and validate a caller-supplied FinMind token. */
export function normalizeFinmindApiToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length < 20 || trimmed.length > 4096) return null;
  return FINMIND_TOKEN_PATTERN.test(trimmed) ? trimmed : null;
}

export function isValidFinmindApiToken(value: unknown): value is string {
  return normalizeFinmindApiToken(value) !== null;
}

function fallbackResolution(
  environmentToken: string | null | undefined,
  updatedAt: string | null,
  storedTokenInvalid: boolean,
): FinmindTokenResolution {
  const token = typeof environmentToken === 'string' ? environmentToken.trim() : '';
  if (token.length > 0) {
    return {
      token,
      configured: true,
      source: 'environment',
      updatedAt,
      storedTokenInvalid,
    };
  }
  return {
    token: null,
    configured: false,
    source: 'none',
    updatedAt,
    storedTokenInvalid,
  };
}

async function importEncryptionKey(encryptionKey: string): Promise<CryptoKey> {
  const raw = base64UrlToBytes(encryptionKey);
  if (raw.byteLength !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be a 32-byte base64url value');
  }
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function isEncryptedFinmindTokenSetting(value: unknown): value is EncryptedFinmindTokenSetting {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 3 || keys[0] !== 'ciphertext' || keys[1] !== 'iv' || keys[2] !== 'version') {
    return false;
  }
  return record.version === 1
    && typeof record.ciphertext === 'string'
    && typeof record.iv === 'string'
    && record.ciphertext.length > 0
    && record.iv.length > 0
    && BASE64URL_PATTERN.test(record.ciphertext)
    && BASE64URL_PATTERN.test(record.iv);
}

async function encryptFinmindToken(
  encryptionKey: string,
  token: string,
): Promise<EncryptedFinmindTokenSetting> {
  const ivBytes = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: ivBytes,
      additionalData: new TextEncoder().encode(FINMIND_API_TOKEN_SETTING_KEY),
    },
    await importEncryptionKey(encryptionKey),
    new TextEncoder().encode(token),
  );
  return {
    version: 1,
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    iv: bytesToBase64Url(ivBytes),
  };
}

async function decryptFinmindToken(
  encryptionKey: string,
  setting: EncryptedFinmindTokenSetting,
): Promise<string | null> {
  try {
    const iv = base64UrlToBytes(setting.iv);
    const ciphertext = base64UrlToBytes(setting.ciphertext);
    if (iv.byteLength !== 12 || ciphertext.byteLength < 16) return null;
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: new TextEncoder().encode(FINMIND_API_TOKEN_SETTING_KEY),
      },
      await importEncryptionKey(encryptionKey),
      ciphertext,
    );
    const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(plaintext);
    return normalizeFinmindApiToken(decoded);
  } catch {
    return null;
  }
}

/** Resolve the effective token while keeping the plaintext out of public status data. */
export async function resolveFinmindApiToken(
  db: D1Database,
  encryptionKey: string,
  environmentToken: string | null | undefined,
): Promise<FinmindTokenResolution> {
  const row = await db.prepare(
    `SELECT setting_value, updated_at
     FROM application_settings
     WHERE setting_key = ?
     LIMIT 1`,
  ).bind(FINMIND_API_TOKEN_SETTING_KEY).first<FinmindTokenSettingRow>();

  if (!row) return fallbackResolution(environmentToken, null, false);

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.setting_value);
  } catch {
    return fallbackResolution(environmentToken, row.updated_at, true);
  }
  if (!isEncryptedFinmindTokenSetting(parsed)) {
    return fallbackResolution(environmentToken, row.updated_at, true);
  }

  const token = await decryptFinmindToken(encryptionKey, parsed);
  if (token === null) return fallbackResolution(environmentToken, row.updated_at, true);

  return {
    token,
    configured: true,
    source: 'database',
    updatedAt: row.updated_at,
    storedTokenInvalid: false,
  };
}

/** Encrypt and atomically persist the owner-approved token. */
export async function saveFinmindApiToken(
  db: D1Database,
  encryptionKey: string,
  token: string,
  updatedByUserId: string,
  now = new Date().toISOString(),
): Promise<FinmindTokenStatus> {
  const normalized = normalizeFinmindApiToken(token);
  if (normalized === null) throw new Error('FinMind API token is invalid');
  const encrypted = await encryptFinmindToken(encryptionKey, normalized);
  await db.prepare(
    `INSERT INTO application_settings (
       setting_key, setting_value, updated_by_user_id, updated_at
     ) VALUES (?, ?, ?, ?)
     ON CONFLICT(setting_key) DO UPDATE SET
       setting_value = excluded.setting_value,
       updated_by_user_id = excluded.updated_by_user_id,
       updated_at = excluded.updated_at`,
  ).bind(
    FINMIND_API_TOKEN_SETTING_KEY,
    JSON.stringify(encrypted),
    updatedByUserId,
    now,
  ).run();

  return {
    configured: true,
    source: 'database',
    updatedAt: now,
    storedTokenInvalid: false,
  };
}

/** Remove only the FinMind token setting. */
export async function deleteFinmindApiToken(db: D1Database): Promise<void> {
  await db.prepare(
    `DELETE FROM application_settings WHERE setting_key = ?`,
  ).bind(FINMIND_API_TOKEN_SETTING_KEY).run();
}
