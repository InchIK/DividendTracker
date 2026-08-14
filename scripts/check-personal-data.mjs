import { readFile, readdir } from 'node:fs/promises';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT } from './settings-lib.mjs';

const genericNames = new Set([
  'root', 'user', 'users', 'codex', 'runner', 'administrator', 'default',
  'maintainer', 'example maintainer',
]);
const allowedEmailDomains = new Set(['example.test', 'example.com', 'example.invalid']);
const deploymentCategories = new Set([
  'deployment-artifact', 'dynamic-term', 'workers-url', 'private-key',
  'widget-token', 'cloudflare-resource-id', 'cloudflare-installation-name',
]);
const privateGeneratedPaths = [
  /^settings\.json$/iu,
  /(?:^|\/)wrangler\.(?!jsonc$).+\.jsonc$/iu,
  /(?:^|\/)\.dev\.vars(?:\..+)?$/iu,
  /(?:^|\/)\.env(?:\..+)?$/iu,
  /(?:^|\/)\.tokens\.local$/iu,
  /(?:^|\/)\.setup-cloudflare-state\.json$/iu,
];

function runGit(args, cwd = ROOT) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error('git privacy scan command failed.');
  return result.stdout;
}

function relativePath(path) {
  return relative(ROOT, resolve(path)).replaceAll('\\', '/');
}

function dynamicTerms() {
  const values = [];
  const add = (value) => {
    if (typeof value !== 'string' || value.length < 3 || genericNames.has(value.toLowerCase())) return;
    if (/^[^@\s]+@(?:example\.com|example\.test|example\.invalid)$/iu.test(value)) return;
    if (!values.includes(value)) values.push(value);
  };
  add(process.env.USERNAME);
  add(process.env.USER);
  for (const key of ['user.name', 'user.email']) {
    const result = spawnSync('git', ['config', '--get', key], { cwd: ROOT, encoding: 'utf8' });
    if (result.status === 0) add(result.stdout.trim());
  }
  // The public repository owner is expected in canonical clone/raw URLs and is
  // GitHub identity, not deployment data. Commit author identity remains part
  // of the optional broad history scan below.
  const settingsPath = resolve(ROOT, 'settings.json');
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
      for (const value of [
        settings.cloudflare?.accountId,
        settings.cloudflare?.d1?.databaseId,
        settings.cloudflare?.workerName,
        settings.cloudflare?.d1?.databaseName,
        settings.secrets?.tokenEncryptionKey,
      ]) add(value);
    } catch {
      // Invalid settings are handled by the normal settings validation command.
    }
  }
  for (const value of String(process.env.PRIVACY_FORBIDDEN_TERMS ?? '').split(/\r?\n/u)) add(value.trim());
  return values;
}

/** Deployment values are local-only even when Git author identity is public. */
function deploymentTerms() {
  const values = [];
  const add = (value) => {
    if (typeof value !== 'string' || value.length < 3 || values.includes(value)) return;
    values.push(value);
  };
  const settingsPath = resolve(ROOT, 'settings.json');
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
      for (const value of [
        settings.cloudflare?.accountId,
        settings.cloudflare?.d1?.databaseId,
        settings.cloudflare?.workerName,
        settings.cloudflare?.d1?.databaseName,
        settings.secrets?.tokenEncryptionKey,
      ]) add(value);
    } catch {
      // Normal settings validation reports malformed local configuration.
    }
  }
  for (const value of String(process.env.DEPLOYMENT_PRIVACY_FORBIDDEN_TERMS ?? '').split(/\r?\n/u)) {
    add(value.trim());
  }
  return values;
}

function isPrivateGeneratedPath(path) {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//u, '');
  return privateGeneratedPaths.some((pattern) => pattern.test(normalized));
}

function deploymentOnly(findings) {
  return findings.filter((finding) => deploymentCategories.has(finding.category));
}

function isAllowedEmail(value) {
  const domain = value.slice(value.lastIndexOf('@') + 1).toLowerCase();
  return allowedEmailDomains.has(domain);
}

function isAllowedWorkersHost(value) {
  const host = value.match(/^https:\/\/([^/\s]+)/i)?.[1]?.toLowerCase() ?? '';
  return host.includes('example');
}

/** Return categories only; never include the matched literal in findings. */
export function scanText(text, options = {}) {
  const findings = [];
  const path = options.path ?? '';
  const add = (category) => findings.push({ category, path });
  if (isPrivateGeneratedPath(path)) add('deployment-artifact');
  for (const term of options.terms ?? []) {
    if (term && text.includes(term)) add('dynamic-term');
  }
  const userPath = /[A-Za-z]:[\\/]Users[\\/]([^\\/\s"']+)/giu;
  for (const match of text.matchAll(userPath)) {
    if (!genericNames.has(match[1].toLowerCase())) add('absolute-user-path');
  }
  const emails = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu;
  for (const match of text.matchAll(emails)) {
    if (!isAllowedEmail(match[0])) add('email');
  }
  const workers = /https:\/\/[a-z0-9.-]+\.workers\.dev(?:[^\s"'<>)]*)?/giu;
  for (const match of text.matchAll(workers)) {
    if (!isAllowedWorkersHost(match[0])) add('workers-url');
  }
  if (!options.scannerSource && /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(text)) {
    add('private-key');
  }
  const widgetTokens = /\bdtw_[A-Za-z0-9_-]{24,}\b/gu;
  for (const match of text.matchAll(widgetTokens)) {
    if (!/(?:test|example|placeholder)/iu.test(match[0])) add('widget-token');
  }
  if (/["'](?:account_id|database_id|accountId|databaseId|d1DatabaseId)["']\s*[:=]\s*["'](?:[0-9a-f]{32}|[0-9a-f-]{36})["']/iu.test(text)) {
    add('cloudflare-resource-id');
  }
  if (!options.scannerSource) {
    const encryptionKeys = /TOKEN_ENCRYPTION_KEY\s*[:=]\s*["']?([A-Za-z0-9_-]{43})\b/gu;
    for (const match of text.matchAll(encryptionKeys)) {
      const value = match[1];
      const repeatedFixture = new Set(value).size === 1;
      if (!repeatedFixture && !/(?:test|example|placeholder)/iu.test(value)) add('private-key');
    }
  }
  const installationNames = /\bdividend-tracker-([0-9a-f]{8})(?:-db)?\b/giu;
  for (const match of text.matchAll(installationNames)) {
    if (!['0123abcd', 'fedcba98'].includes(match[1].toLowerCase())) {
      add('cloudflare-installation-name');
    }
  }
  return findings;
}

function isText(buffer) {
  return !buffer.includes(0);
}

function trackedFiles() {
  return runGit(['ls-files', '-z']).split('\0').filter(Boolean);
}

function scanTracked(terms, deployment = false) {
  const findings = [];
  for (const file of trackedFiles()) {
    const absolutePath = resolve(ROOT, file);
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) continue;
    const buffer = readFileSync(absolutePath);
    if (!isText(buffer)) continue;
    findings.push(...scanText(buffer.toString('utf8'), { path: file, terms, scannerSource: file.endsWith('scripts/check-personal-data.mjs') }));
  }
  return deployment ? deploymentOnly(findings) : findings;
}

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesIn(path));
    else result.push(path);
  }
  return result;
}

export async function scanBuildDirectory(directory, terms = [], options = {}) {
  const absoluteDirectory = resolve(directory);
  if (!existsSync(absoluteDirectory) || !statSync(absoluteDirectory).isDirectory()) throw new Error('指定 build scan 時找不到 dist，已安全停止。');
  const findings = [];
  for (const file of await filesIn(absoluteDirectory)) {
    const buffer = await readFile(file);
    if (!isText(buffer)) continue;
    findings.push(...scanText(buffer.toString('utf8'), { path: relativePath(file), terms }));
  }
  return options.deployment ? deploymentOnly(findings) : findings;
}

async function scanBuild(terms, deployment = false) {
  return scanBuildDirectory(resolve(ROOT, 'dist'), terms, { deployment });
}

export function scanHistoryRepository(repositoryRoot, terms = [], options = {}) {
  const findings = [];
  const commits = runGit(['rev-list', '--all'], repositoryRoot).split(/\r?\n/u).filter(Boolean);
  const seen = new Set();
  for (const commit of commits) {
    const tree = runGit(['ls-tree', '-r', '-z', commit], repositoryRoot);
    for (const entry of tree.split('\0').filter(Boolean)) {
      const match = /^\d+ blob ([0-9a-f]+)\t(.+)$/u.exec(entry);
      if (!match || seen.has(match[1])) continue;
      seen.add(match[1]);
      const blob = spawnSync('git', ['cat-file', '-p', match[1]], { cwd: repositoryRoot, encoding: null, maxBuffer: 64 * 1024 * 1024 }).stdout;
      if (blob && isText(blob)) {
        for (const finding of scanText(blob.toString('utf8'), { path: match[2], terms, scannerSource: match[2].endsWith('scripts/check-personal-data.mjs') })) {
          findings.push({ ...finding, commit });
        }
      }
    }
    if (!options.deployment) {
      const metadata = runGit(['show', '-s', '--format=%an\n%ae\n%cn\n%ce', commit], repositoryRoot);
      for (const finding of scanText(metadata, { path: '(git metadata)', terms })) findings.push({ ...finding, commit });
    }
  }
  return options.deployment ? deploymentOnly(findings) : findings;
}

function printFindings(findings) {
  for (const finding of findings) {
    const location = finding.commit ? `${finding.commit} ${finding.path}` : finding.path;
    console.error(`privacy finding: ${finding.category} ${location}`);
  }
}

export async function runPrivacyScan(modes) {
  const terms = modes.deployment ? deploymentTerms() : dynamicTerms();
  const findings = [];
  if (modes.tracked) findings.push(...scanTracked(terms, modes.deployment));
  if (modes.build) findings.push(...await scanBuild(terms, modes.deployment));
  if (modes.history) findings.push(...scanHistoryRepository(ROOT, terms, { deployment: modes.deployment }));
  printFindings(findings);
  return findings.length === 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const modes = {
    tracked: process.argv.includes('--tracked'),
    build: process.argv.includes('--build'),
    history: process.argv.includes('--history'),
    deployment: process.argv.includes('--deployment'),
  };
  if (!modes.tracked && !modes.build && !modes.history) {
    console.error('Usage: node scripts/check-personal-data.mjs --tracked [--build] [--history] [--deployment]');
    process.exitCode = 2;
  } else {
    try {
      if (!await runPrivacyScan(modes)) process.exitCode = 1;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
