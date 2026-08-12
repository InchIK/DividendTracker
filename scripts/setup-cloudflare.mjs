import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  GENERATED_WRANGLER_PATH,
  ROOT,
  ensureSettings,
  generatedWrangler,
  writeSettings,
} from './settings-lib.mjs';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/** Parse Wrangler JSON arrays from either a bare array or `{ result: [] }`. */
export function parseWranglerRows(raw) {
  try {
    const value = JSON.parse(raw ?? '[]');
    if (Array.isArray(value)) return value;
    if (Array.isArray(value.result)) return value.result;
    throw new Error('Wrangler JSON does not contain a row array.');
  } catch {
    throw new Error('無法解析 Wrangler 回傳資料；設定已安全停止。');
  }
}

/**
 * Classify a resource-existence probe. Only success or Cloudflare's explicit
 * not-found code are safe to interpret; every other failure stops setup.
 */
export function classifyResourceProbe(result) {
  if (result?.status === 0) return { exists: true };
  const text = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`;
  if (/10007|does not exist/i.test(text)) return { exists: false };
  throw new Error('Cloudflare resource probe failed; setup stopped without creating resources.');
}

export function databaseIdentity(row) {
  return {
    name: row?.name ?? row?.database_name ?? row?.title ?? '',
    id: row?.uuid ?? row?.id ?? row?.database_id ?? '',
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...options.env },
  });
  if (result.status !== 0) throw new Error('Cloudflare setup command failed.');
}

function capture(command, args) {
  return spawnSync(command, args, { cwd: ROOT, encoding: 'utf8' });
}

function requireLogin() {
  let whoami = capture(npx, ['wrangler', 'whoami', '--json']);
  if (whoami.status !== 0) {
    run(npx, ['wrangler', 'login']);
    whoami = capture(npx, ['wrangler', 'whoami', '--json']);
    if (whoami.status !== 0) throw new Error('Cloudflare 登入失敗，設定已停止。');
  }
}

function probeWorker(workerName) {
  const result = capture(npx, ['wrangler', 'deployments', 'list', '--name', workerName, '--json']);
  return classifyResourceProbe({ status: result.status, stdout: result.stdout, stderr: result.stderr });
}

function listD1() {
  const result = capture(npx, ['wrangler', 'd1', 'list', '--json']);
  if (result.status !== 0) throw new Error('無法列出 Cloudflare D1，設定已停止。');
  return parseWranglerRows(result.stdout);
}

export function findDatabase(rows, databaseName) {
  return rows.map(databaseIdentity).find((database) => database.name === databaseName);
}

async function main() {
  console.log('DividendTracker Cloudflare 設定開始');
  let settings = await ensureSettings();
  run(npm, ['install']);

  await writeFile(GENERATED_WRANGLER_PATH, generatedWrangler(settings), 'utf8');
  run(npm, ['run', 'check']);

  requireLogin();
  const established = Boolean(settings.cloudflare.d1.databaseId);

  if (!established) {
    // Probe in this order so a name collision cannot leave an orphan D1.
    const worker = probeWorker(settings.cloudflare.workerName);
    if (worker.exists) throw new Error('同名 Cloudflare Worker 已存在；請重新執行 npm run setup 產生新名稱。');

    const databases = listD1();
    if (findDatabase(databases, settings.cloudflare.d1.databaseName)) {
      throw new Error('同名 Cloudflare D1 已存在；設定已停止，未重用既有資料庫。');
    }

    run(npx, [
      'wrangler', 'd1', 'create', settings.cloudflare.d1.databaseName,
      '--location', settings.cloudflare.d1.location,
    ]);
    const created = findDatabase(listD1(), settings.cloudflare.d1.databaseName);
    if (!created?.id) throw new Error('D1 建立後找不到精確同名資料庫 ID，設定已停止。');
    settings.cloudflare.d1.databaseId = created.id;
    await writeSettings(settings);
  }

  await writeFile(GENERATED_WRANGLER_PATH, generatedWrangler(settings), 'utf8');
  run(npx, [
    'wrangler', 'd1', 'migrations', 'apply', settings.cloudflare.d1.binding,
    '--remote', '--config', GENERATED_WRANGLER_PATH,
  ], { env: { CI: 'true' } });

  const secretDirectory = await mkdtemp(join(tmpdir(), 'dividend-tracker-secrets-'));
  const secretPath = join(secretDirectory, '.dev.vars');
  try {
    await writeFile(secretPath, `TOKEN_ENCRYPTION_KEY=${settings.secrets.tokenEncryptionKey}\n`, { mode: 0o600 });
    run(npx, ['wrangler', 'deploy', '--config', GENERATED_WRANGLER_PATH, '--secrets-file', secretPath]);
  } finally {
    await rm(secretDirectory, { recursive: true, force: true });
  }

  console.log('Cloudflare Worker 與 D1 部署完成');
  console.log(`Worker 名稱：${settings.cloudflare.workerName}`);
  console.log(`D1 名稱：${settings.cloudflare.d1.databaseName}`);
  console.log('第一個帳號是全新空白 owner，不會接管舊資料。既有 settings 可重新部署目前資源。');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
