import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import { scanBuildDirectory, scanHistoryRepository, scanText } from './check-personal-data.mjs';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

void test('classifies privacy findings without returning matched literals', () => {
  const privatePath = ['C:', 'Users', 'real-person', 'repo'].join('\\');
  const privateEmail = ['real.person', 'example.org'].join('@');
  const privateWorker = `https://${['private-app', 'workers', 'dev'].join('.')}`;
  const privateToken = ['dtw', 'abcdefghijklmnopqrstuvwxyz123456'].join('_');
  const privateResourceId = ['11111111', '2222', '3333', '4444', '555555555555'].join('-');
  const findings = scanText([
    privatePath,
    privateEmail,
    privateWorker,
    privateToken,
    `{"database_id":"${privateResourceId}"}`,
    'PRIVATE_TERM',
  ].join('\n'), { path: 'fixture.txt', terms: ['PRIVATE_TERM'] });
  assert.deepEqual(new Set(findings.map((finding) => finding.category)), new Set([
    'absolute-user-path', 'email', 'workers-url', 'widget-token', 'dynamic-term',
    'cloudflare-resource-id',
  ]));
  assert.equal(JSON.stringify(findings).includes('PRIVATE_TERM'), false);
});

void test('allows example domains and rejects build content only when present', async () => {
  assert.deepEqual(scanText('https://demo.example.workers.dev\nuser@example.test', { path: 'fixture.txt' }), []);
  const root = mkdtempSync(join(tmpdir(), 'dividend-tracker-privacy-'));
  roots.push(root);
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'assets', 'app.js'), 'const ok = true;');
  assert.deepEqual(await scanBuildDirectory(root), []);
  writeFileSync(join(root, 'assets', '.env.production'), 'SECRET=not-for-build');
  const findings = await scanBuildDirectory(root, ['not-for-build']);
  assert.equal(findings.some((finding) => finding.category === 'dynamic-term'), true);
});

void test('fails closed when a requested build directory is missing', async () => {
  await assert.rejects(() => scanBuildDirectory(join(tmpdir(), 'missing-privacy-build')));
});

void test('finds a forbidden term that exists only in an older Git commit', () => {
  const root = mkdtempSync(join(tmpdir(), 'dividend-tracker-history-'));
  roots.push(root);
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init');
  git('config', 'user.name', 'Example Maintainer');
  git('config', 'user.email', 'maintainer@example.invalid');
  writeFileSync(join(root, 'history.txt'), 'OLD_PRIVATE_MARKER');
  git('add', 'history.txt');
  git('commit', '-m', 'add old marker');
  unlinkSync(join(root, 'history.txt'));
  writeFileSync(join(root, 'clean.txt'), 'clean');
  git('add', '--all');
  git('commit', '-m', 'remove old marker');

  const findings = scanHistoryRepository(root, ['OLD_PRIVATE_MARKER']);
  assert.equal(findings.some((finding) => finding.category === 'dynamic-term'), true);
  assert.equal(JSON.stringify(findings).includes('OLD_PRIVATE_MARKER'), false);
});
