import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const powershellScript = join(ROOT, 'install.ps1');
const bashScript = join(ROOT, 'install.sh');

function findBash() {
  const candidates = process.platform === 'win32'
    ? ['bash', join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe')]
    : ['bash'];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return null;
}

async function pathExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

void test('guided installers contain the required safety and setup markers', async () => {
  const [powershell, bash] = await Promise.all([
    readFile(powershellScript, 'utf8'),
    readFile(bashScript, 'utf8'),
  ]);
  assert.match(powershell, /\[switch\]\$DryRun/);
  assert.match(powershell, /Git\.Git/);
  assert.match(powershell, /OpenJS\.NodeJS\.LTS/);
  assert.match(powershell, /accept-package-agreements/);
  assert.match(powershell, /npm run setup:cloudflare/);
  assert.doesNotMatch(powershell, /Invoke-Expression/);
  assert.match(bash, /set -Eeuo pipefail/);
  assert.match(bash, /--dry-run/);
  assert.match(bash, /v0\.40\.6/);
  assert.match(bash, /mktemp -d/);
  assert.match(bash, /npm run setup:cloudflare/);
  assert.doesNotMatch(bash, /curl\s*\|\s*bash/);
});

void test('PowerShell dry-run performs no filesystem mutation when available', async (t) => {
  const command = process.platform === 'win32' ? 'powershell.exe' : 'powershell';
  const probe = spawnSync(command, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    t.skip('PowerShell is not available on this host');
    return;
  }
  const parent = await mkdtemp(join(tmpdir(), 'dividend-tracker-installer-test-'));
  const target = join(parent, 'missing path');
  try {
    const result = spawnSync(command, [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', powershellScript,
      '-InstallDir', target, '-DryRun',
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await pathExists(target), false);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('Bash syntax and dry-run perform no filesystem mutation', async (t) => {
  const bash = findBash();
  if (!bash) {
    t.skip('Bash is not available on this host');
    return;
  }
  const parent = await mkdtemp(join(tmpdir(), 'dividend-tracker-installer-test-'));
  const target = join(parent, 'missing path');
  try {
    assert.equal(execFileSync(bash, ['-n', bashScript], { encoding: 'utf8' }), '');
    const result = spawnSync(bash, [bashScript, target, '--dry-run'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await pathExists(target), false);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
