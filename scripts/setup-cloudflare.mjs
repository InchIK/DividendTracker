import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  GENERATED_WRANGLER_PATH,
  ROOT,
  SETUP_STATE_PATH,
  ensureSettings,
  generatedWrangler,
  normalizeCloudflareAccounts,
  resolveCloudflareAccount,
  writeSettings,
} from './settings-lib.mjs';

const require = createRequire(import.meta.url);
const WORKERS_DEV_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+workers\.dev$/i;
const ANSI_CSI_PATTERN = new RegExp(String.raw`\u001b\[[0-?]*[ -/]*[@-~]`, 'g');

/**
 * Resolve a local CLI to an executable command and argument prefix.  The
 * executable and arguments stay separate so paths containing spaces are safe
 * on every supported platform.
 */
export function resolveToolSpec(tool, {
  platform = process.platform,
  env = process.env,
  nodeExecutable = process.execPath,
  wranglerCli,
} = {}) {
  if (tool === 'wrangler') {
    return {
      command: nodeExecutable,
      prefixArgs: [wranglerCli ?? require.resolve('wrangler')],
    };
  }
  if (tool !== 'npm') throw new Error(`Unknown Cloudflare setup tool: ${String(tool)}`);

  const npmExecPath = typeof env?.npm_execpath === 'string' ? env.npm_execpath : '';
  if (npmExecPath.trim()) return { command: nodeExecutable, prefixArgs: [npmExecPath] };
  if (platform !== 'win32') return { command: 'npm', prefixArgs: [] };
  throw new Error('找不到 npm CLI；請確認 Node.js 安裝正確後再執行 npm run setup:cloudflare。');
}

/** Parse Wrangler JSON arrays from either a bare array or `{ result: [] }`. */
export function parseWranglerRows(raw) {
  try {
    const value = JSON.parse(raw ?? '[]');
    if (Array.isArray(value)) return value;
    if (Array.isArray(value.result)) return value.result;
    throw new Error('not an array');
  } catch {
    throw new Error('Wrangler 回傳格式無法解析，設定已安全停止。');
  }
}

/**
 * Extract only the safe account fields from `wrangler whoami --json`.  The
 * response may be a result object, a direct object, or a result array.  Any
 * malformed account is ignored and no raw Wrangler metadata is returned.
 */
export function parseWranglerWhoamiAccounts(raw) {
  let value;
  try {
    value = JSON.parse(raw ?? '{}');
  } catch {
    throw new Error('Wrangler whoami 回傳格式無法解析，設定已安全停止。');
  }
  const candidates = [];
  if (Array.isArray(value)) candidates.push(...value);
  if (Array.isArray(value?.accounts)) candidates.push(...value.accounts);
  if (Array.isArray(value?.result)) candidates.push(...value.result);
  if (Array.isArray(value?.result?.accounts)) candidates.push(...value.result.accounts);
  if (value?.result && !Array.isArray(value.result) && !Array.isArray(value.result.accounts)) {
    candidates.push(value.result);
  }
  if (Array.isArray(value?.data?.accounts)) candidates.push(...value.data.accounts);
  const accounts = normalizeCloudflareAccounts(candidates);
  if (!candidates.length || !accounts.length) {
    throw new Error('Wrangler whoami 沒有合法的 Cloudflare 帳戶資料，設定已安全停止。');
  }
  return accounts;
}

/**
 * Classify a resource-existence probe.  Only success or Cloudflare's explicit
 * not-found code are safe to interpret; every other failure stops setup.
 */
export function classifyResourceProbe(result) {
  if (result?.status === 0) return { exists: true };
  const text = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`;
  if (/10007|does not exist/i.test(text)) return { exists: false };
  throw new Error('Cloudflare 資源檢查失敗，已停止建立資源。');
}

export function databaseIdentity(row) {
  return {
    name: row?.name ?? row?.database_name ?? row?.title ?? '',
    id: row?.uuid ?? row?.id ?? row?.database_id ?? '',
  };
}

export function findDatabase(rows, databaseName) {
  return rows.map(databaseIdentity).find((database) => database.name === databaseName);
}

/**
 * Accept only an HTTPS workers.dev URL.  Wrangler output often includes
 * surrounding prose and a trailing slash; returning the origin avoids
 * accidentally carrying a path into subsequent health/auth requests.
 */
export function extractDeploymentUrl(text) {
  const matches = String(text ?? '').match(/https:\/\/[^\s"'<>]+/gi) ?? [];
  for (const candidate of matches) {
    const withoutPunctuation = candidate
      .replace(ANSI_CSI_PATTERN, '')
      .replace(/[),.;]+$/g, '');
    try {
      const parsed = new URL(withoutPunctuation);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) continue;
      if (!WORKERS_DEV_HOST.test(parsed.hostname)) continue;
      if (parsed.pathname !== '/' || parsed.search || parsed.hash) continue;
      return parsed.origin;
    } catch {
      // Continue scanning other URLs in the output.
    }
  }
  return null;
}

function toolSpec(tool) {
  return typeof tool === 'string' ? resolveToolSpec(tool) : tool;
}

function invoke(tool, args, options = {}) {
  const spec = toolSpec(tool);
  return spawnSync(spec.command, [...spec.prefixArgs, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
    env: { ...process.env, ...options.env },
    timeout: options.timeout,
    windowsHide: true,
  });
}

function runChecked(tool, args, options = {}) {
  const result = invoke(tool, args, options);
  if (result.error || result.status !== 0) {
    throw new Error(options.message ?? 'Cloudflare 設定指令失敗，已安全停止。');
  }
  return result;
}

function capture(tool, args, options = {}) {
  const result = invoke(tool, args, options);
  if (result.error) throw new Error('找不到必要的 CLI，請確認 Node.js 與 Wrangler 已安裝。');
  return result;
}

async function chooseAccount(settings, accounts) {
  try {
    const selected = resolveCloudflareAccount(accounts, settings.cloudflare.accountId);
    if (settings.cloudflare.accountId !== selected.id) {
      settings.cloudflare.accountId = selected.id;
      await writeSettings(settings);
    }
    return selected;
  } catch (error) {
    if (error?.code !== 'ACCOUNT_SELECTION_REQUIRED') throw error;
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error('目前授權了多個 Cloudflare 帳戶；請先在 ignored 的 settings.json 設定 cloudflare.accountId 後重試。');
    }
    console.log('偵測到多個已授權的 Cloudflare 帳戶，請選擇要部署的帳戶：');
    error.accounts.forEach((_account, index) => console.log(`  ${index + 1}. Cloudflare 帳戶`));
    const rl = createInterface({ input, output });
    try {
      const answer = await rl.question('請輸入編號：');
      const index = Number.parseInt(answer.trim(), 10) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= error.accounts.length) {
        throw new Error('帳戶選擇無效，設定已安全停止。');
      }
      const selected = error.accounts[index];
      settings.cloudflare.accountId = selected.id;
      await writeSettings(settings);
      return selected;
    } finally {
      rl.close();
    }
  }
}

function requireLogin() {
  let whoami = capture('wrangler', ['whoami', '--json']);
  if (whoami.status !== 0) {
    console.log('接下來 Wrangler 會開啟瀏覽器；沒有 Cloudflare 帳號可先免費註冊。登入後請按 Allow／授權，再回到此終端機。');
    runChecked('wrangler', ['login'], { message: 'Cloudflare 授權失敗，請完成瀏覽器授權後重試。' });
    whoami = capture('wrangler', ['whoami', '--json']);
    if (whoami.status !== 0) throw new Error('Cloudflare 授權未完成，請重試。');
  }
  const accounts = parseWranglerWhoamiAccounts(whoami.stdout);
  if (!accounts.length) throw new Error('Wrangler 沒有回傳可用的 Cloudflare 帳戶，請先完成授權後重試。');
  return accounts;
}

function probeWorker(workerName) {
  const result = capture('wrangler', ['deployments', 'list', '--name', workerName, '--json']);
  return classifyResourceProbe({ status: result.status, stdout: result.stdout, stderr: result.stderr });
}

function listD1() {
  const result = capture('wrangler', ['d1', 'list', '--json']);
  if (result.status !== 0) throw new Error('Cloudflare D1 資源檢查失敗，設定已安全停止。');
  return parseWranglerRows(result.stdout);
}

async function fetchWithTimeout(url, { timeoutMs = 7000 } = {}) {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await globalThis.fetch(url, { signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export async function waitForHealth(deploymentUrl, {
  attempts = 5,
  timeoutMs = 7000,
  delayMs = 700,
  fetchImpl = globalThis.fetch,
} = {}) {
  const healthUrl = `${deploymentUrl}/health`;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(healthUrl, { signal: controller.signal });
      if (response.ok) return true;
    } catch {
      // Retry transient deployment propagation/network failures.
    } finally {
      globalThis.clearTimeout(timer);
    }
    if (attempt + 1 < attempts) await new Promise((resolveDelay) => globalThis.setTimeout(resolveDelay, delayMs));
  }
  return false;
}

async function readAuthConfig(deploymentUrl) {
  try {
    const response = await fetchWithTimeout(`${deploymentUrl}/api/v1/auth/config`);
    if (!response.ok) return null;
    const body = await response.json();
    return { firstAccount: body?.firstAccount === true };
  } catch {
    return null;
  }
}

function openBrowser(url) {
  if (!WORKERS_DEV_HOST.test(new URL(url).hostname)) return false;
  let result;
  if (process.platform === 'win32') {
    // `start` is a cmd builtin; the URL was strictly validated immediately
    // above and is passed as a separate argument with shell mode disabled.
    result = spawnSync('cmd.exe', ['/d', '/s', '/c', 'start', '', url], {
      stdio: 'ignore',
      shell: false,
      windowsHide: true,
    });
  } else if (process.platform === 'darwin') {
    result = spawnSync('open', [url], { stdio: 'ignore', shell: false });
  } else {
    result = spawnSync('xdg-open', [url], { stdio: 'ignore', shell: false });
  }
  return !result.error && result.status === 0;
}

async function maybeCreateFirstOwner(deploymentUrl) {
  const config = await readAuthConfig(deploymentUrl);
  if (!config?.firstAccount) return;

  openBrowser(deploymentUrl);
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log(deploymentUrl);
    return;
  }
  console.log('尚未建立第一個 owner，請在瀏覽器開啟下列網址完成註冊：');
  console.log(deploymentUrl);

  const rl = createInterface({ input, output });
  try {
    await rl.question('完成第一個 owner 後按 Enter 繼續：');
  } finally {
    rl.close();
  }
  const after = await readAuthConfig(deploymentUrl);
  if (!after || after.firstAccount) console.warn('尚未確認 owner 已建立；可稍後重新開啟部署網址完成設定。');
}

async function writeSetupState(settings, deploymentUrl) {
  const state = {
    workerName: settings.cloudflare.workerName,
    databaseName: settings.cloudflare.d1.databaseName,
    deploymentUrl,
    completedAt: new Date().toISOString(),
  };
  await writeFile(SETUP_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await chmod(SETUP_STATE_PATH, 0o600);
}

async function writeGeneratedConfig(settings) {
  await writeFile(GENERATED_WRANGLER_PATH, generatedWrangler(settings), {
    encoding: 'utf8',
    mode: 0o600,
  });
  await chmod(GENERATED_WRANGLER_PATH, 0o600);
}

async function main() {
  console.log('DividendTracker Cloudflare 設定開始');
  let settings = await ensureSettings();
  console.log('正在確認 npm 套件…');
  runChecked('npm', ['install'], { message: 'npm install 失敗，設定已安全停止。' });

  console.log('正在確認 Cloudflare 登入與授權…');
  const accounts = requireLogin();
  await chooseAccount(settings, accounts);
  await writeGeneratedConfig(settings);
  console.log('正在執行專案測試、建置與隱私檢查…');
  runChecked('npm', ['run', 'check'], { message: '專案檢查或建置失敗，設定已安全停止。' });

  const established = Boolean(settings.cloudflare.d1.databaseId);
  if (!established) {
    console.log('正在檢查並建立獨立的 Worker 與 D1 資源…');
    // Probe in this order so a name collision cannot leave an orphan D1.
    const worker = probeWorker(settings.cloudflare.workerName);
    if (worker.exists) throw new Error('指定的 Worker 名稱已存在，請刪除或修改 ignored 的 settings.json 後重試。');

    const databases = listD1();
    if (findDatabase(databases, settings.cloudflare.d1.databaseName)) {
      throw new Error('指定的 D1 名稱已存在，請修改 ignored 的 settings.json 後重試。');
    }

    const created = capture('wrangler', [
      'd1', 'create', settings.cloudflare.d1.databaseName,
      '--location', settings.cloudflare.d1.location,
    ]);
    if (created.status !== 0) throw new Error('D1 建立失敗，設定已安全停止。');
    const database = findDatabase(listD1(), settings.cloudflare.d1.databaseName);
    if (!database?.id) throw new Error('D1 建立後無法確認資源，設定已安全停止。');
    settings.cloudflare.d1.databaseId = database.id;
    await writeSettings(settings);
  }

  await writeGeneratedConfig(settings);
  console.log('正在套用 D1 migrations…');
  runChecked('wrangler', [
    'd1', 'migrations', 'apply', settings.cloudflare.d1.binding,
    '--remote', '--config', GENERATED_WRANGLER_PATH,
  ], { env: { CI: 'true' }, message: 'D1 migration 失敗，設定已安全停止。' });

  const secretDirectory = await mkdtemp(join(tmpdir(), 'dividend-tracker-secrets-'));
  const secretPath = join(secretDirectory, '.dev.vars');
  try {
    await writeFile(secretPath, `TOKEN_ENCRYPTION_KEY=${settings.secrets.tokenEncryptionKey}\n`, { mode: 0o600 });
    await chmod(secretPath, 0o600);
    console.log('正在部署 Cloudflare Worker…');
    const deployed = capture('wrangler', [
      'deploy', '--config', GENERATED_WRANGLER_PATH, '--secrets-file', secretPath,
    ]);
    const deploymentOutput = `${deployed.stdout ?? ''}${deployed.stderr ?? ''}`;
    // Deployment output is intentionally shown verbatim for Wrangler's useful
    // status messages; the temporary secrets file is never read or displayed.
    if (deploymentOutput) process.stdout.write(deploymentOutput);
    if (deployed.status !== 0) throw new Error('Worker 部署失敗，設定已安全停止。');
    const deploymentUrl = extractDeploymentUrl(deploymentOutput);
    if (!deploymentUrl) {
      throw new Error('部署輸出中找不到合法 workers.dev URL；部署可能已成功，請修正後重新執行（流程可重複）。');
    }
    console.log('正在驗證線上健康狀態…');
    if (!await waitForHealth(deploymentUrl)) {
      throw new Error('部署後健康檢查失敗；請稍後重新執行設定（流程可重複）。');
    }
    await writeSetupState(settings, deploymentUrl);
    await maybeCreateFirstOwner(deploymentUrl);
    console.log('Cloudflare Worker 與 D1 已完成設定。');
    console.log(`Worker 名稱：${settings.cloudflare.workerName}`);
    console.log(`D1 名稱：${settings.cloudflare.d1.databaseName}`);
    console.log(`部署網址：${deploymentUrl}`);
  } finally {
    await rm(secretDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
