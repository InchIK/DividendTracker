import { randomBytes } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SETTINGS_PATH = resolve(ROOT, 'settings.json');
export const SETTINGS_EXAMPLE_PATH = resolve(ROOT, 'settings.example.json');
export const GENERATED_WRANGLER_PATH = resolve(ROOT, 'wrangler.generated.jsonc');
export const DEV_VARS_PATH = resolve(ROOT, '.dev.vars');

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Personalise a pristine template for one installation without mutating the
 * caller's object. The suffix is deliberately short, random, and lowercase so
 * both Wrangler names remain within Cloudflare's naming constraints.
 */
export function personalizeNewSettings(template, suffix) {
  if (typeof suffix !== 'string' || !/^[0-9a-f]{8}$/.test(suffix)) {
    throw new Error('Fresh setup suffix must be exactly eight lowercase hexadecimal characters.');
  }
  const settings = JSON.parse(JSON.stringify(template));
  if (!settings.cloudflare?.d1) {
    throw new Error('Settings template is missing cloudflare.d1.');
  }
  settings.cloudflare.workerName = `dividend-tracker-${suffix}`;
  settings.cloudflare.d1.databaseName = `dividend-tracker-${suffix}-db`;
  settings.cloudflare.d1.databaseId = '';
  return settings;
}

export async function ensureSettings() {
  if (!await exists(SETTINGS_PATH)) {
    const template = JSON.parse(await readFile(SETTINGS_EXAMPLE_PATH, 'utf8'));
    const suffix = randomBytes(4).toString('hex');
    const freshSettings = personalizeNewSettings(template, suffix);
    freshSettings.secrets ??= {};
    freshSettings.secrets.tokenEncryptionKey = randomBytes(32).toString('base64url');
    await writeSettings(freshSettings);
  }
  const settings = JSON.parse(await readFile(SETTINGS_PATH, 'utf8'));
  if (!settings.secrets?.tokenEncryptionKey) {
    settings.secrets ??= {};
    settings.secrets.tokenEncryptionKey = randomBytes(32).toString('base64url');
    await writeSettings(settings);
  }
  validateSettings(settings);
  return settings;
}

export async function loadSettings() {
  if (!await exists(SETTINGS_PATH)) {
    throw new Error('找不到 settings.json，請先執行 npm run setup。');
  }
  const settings = JSON.parse(await readFile(SETTINGS_PATH, 'utf8'));
  validateSettings(settings);
  return settings;
}

export async function writeSettings(settings) {
  validateSettings(settings);
  await writeFile(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function requiredObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`settings.json 的 ${name} 必須是物件。`);
  }
  return value;
}

function requiredString(value, name, pattern) {
  if (typeof value !== 'string' || !value.trim() || (pattern && !pattern.test(value))) {
    throw new Error(`settings.json 的 ${name} 格式錯誤。`);
  }
}

function boundedInteger(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`settings.json 的 ${name} 必須介於 ${minimum}～${maximum}。`);
  }
}

export function validateSettings(settings) {
  const app = requiredObject(settings.app, 'app');
  const cloudflare = requiredObject(settings.cloudflare, 'cloudflare');
  const d1 = requiredObject(cloudflare.d1, 'cloudflare.d1');
  const crons = requiredObject(cloudflare.crons, 'cloudflare.crons');
  const google = requiredObject(app.googleAuth, 'app.googleAuth');
  const sources = requiredObject(settings.sources, 'sources');
  const secrets = requiredObject(settings.secrets, 'secrets');

  requiredString(app.name, 'app.name');
  if (app.timezone !== 'Asia/Taipei') throw new Error('目前 app.timezone 必須是 Asia/Taipei。');
  if (typeof app.allowRegistration !== 'boolean') throw new Error('app.allowRegistration 必須是布林值。');
  boundedInteger(app.passwordPbkdf2Iterations, 'app.passwordPbkdf2Iterations', 100000, 100000);
  boundedInteger(app.sessionTtlHours, 'app.sessionTtlHours', 1, 168);
  boundedInteger(app.rememberSessionTtlDays, 'app.rememberSessionTtlDays', 1, 365);
  if (typeof google.enabled !== 'boolean' || typeof google.clientId !== 'string') {
    throw new Error('app.googleAuth 設定格式錯誤。');
  }
  if (google.enabled && !google.clientId.trim()) throw new Error('啟用 Google 登入時必須填入 clientId。');

  requiredString(cloudflare.workerName, 'cloudflare.workerName', /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
  requiredString(cloudflare.compatibilityDate, 'cloudflare.compatibilityDate', /^\d{4}-\d{2}-\d{2}$/);
  if (cloudflare.accountId && !/^[0-9a-f]{32}$/i.test(cloudflare.accountId)) throw new Error('cloudflare.accountId 格式錯誤。');
  if (typeof cloudflare.observability !== 'boolean') throw new Error('cloudflare.observability 必須是布林值。');
  if (d1.binding !== 'DB') throw new Error('cloudflare.d1.binding 必須是 DB。');
  requiredString(d1.databaseName, 'cloudflare.d1.databaseName', /^[A-Za-z0-9_-]+$/);
  if (d1.databaseId && !/^[0-9a-f-]{36}$/i.test(d1.databaseId)) throw new Error('cloudflare.d1.databaseId 格式錯誤。');
  if (!['weur', 'eeur', 'apac', 'oc', 'wnam', 'enam'].includes(d1.location)) throw new Error('cloudflare.d1.location 格式錯誤。');
  if (crons.dailyDividendsTaipei1335Utc !== '35 5 * * *') {
    throw new Error('每日台北時間 13:35 的 Cron 必須是 35 5 * * *。');
  }
  requiredString(crons.hourlyPrices, 'cloudflare.crons.hourlyPrices');

  for (const [key, value] of Object.entries(sources)) {
    requiredString(value, `sources.${key}`, /^https:\/\//);
  }
  requiredString(secrets.tokenEncryptionKey, 'secrets.tokenEncryptionKey', /^[A-Za-z0-9_-]{43}$/);
  if (Buffer.from(secrets.tokenEncryptionKey, 'base64url').byteLength !== 32) {
    throw new Error('secrets.tokenEncryptionKey 必須解碼為 32 bytes。');
  }
}

export function generatedWrangler(settings) {
  const d1 = {
    binding: settings.cloudflare.d1.binding,
    database_name: settings.cloudflare.d1.databaseName,
    migrations_dir: 'migrations',
  };
  if (settings.cloudflare.d1.databaseId) d1.database_id = settings.cloudflare.d1.databaseId;
  const config = {
    $schema: './node_modules/wrangler/config-schema.json',
    name: settings.cloudflare.workerName,
    main: './worker/index.ts',
    compatibility_date: settings.cloudflare.compatibilityDate,
    ...(settings.cloudflare.accountId ? { account_id: settings.cloudflare.accountId } : {}),
    assets: {
      directory: './dist/client',
      not_found_handling: 'single-page-application',
      run_worker_first: ['/api/*', '/health'],
    },
    vars: {
      APP_NAME: settings.app.name,
      APP_TIMEZONE: settings.app.timezone,
      ALLOW_REGISTRATION: String(settings.app.allowRegistration),
      PASSWORD_PBKDF2_ITERATIONS: String(settings.app.passwordPbkdf2Iterations),
      SESSION_TTL_HOURS: String(settings.app.sessionTtlHours),
      REMEMBER_SESSION_TTL_DAYS: String(settings.app.rememberSessionTtlDays),
      GOOGLE_AUTH_ENABLED: String(settings.app.googleAuth.enabled),
      GOOGLE_CLIENT_ID: settings.app.googleAuth.clientId,
      SITCA_DIVIDEND_CSV_URL: settings.sources.sitcaDividendCsvUrl,
      TWSE_FUND_MAPPING_URL: settings.sources.twseFundMappingUrl,
      TWSE_EX_DIVIDEND_URL: settings.sources.twseExDividendUrl,
    },
    secrets: { required: ['TOKEN_ENCRYPTION_KEY'] },
    d1_databases: [d1],
    triggers: {
      crons: [settings.cloudflare.crons.hourlyPrices, settings.cloudflare.crons.dailyDividendsTaipei1335Utc],
    },
    observability: {
      enabled: settings.cloudflare.observability,
      head_sampling_rate: settings.cloudflare.observability ? 1 : 0,
    },
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}
