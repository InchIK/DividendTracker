import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  SETTINGS_EXAMPLE_PATH,
  generatedWrangler,
  resolveCloudflareAccount,
  personalizeNewSettings,
  validateSettings,
} from './settings-lib.mjs';
import {
  classifyResourceProbe,
  extractDeploymentUrl,
  findDatabase,
  parseWranglerWhoamiAccounts,
  parseWranglerRows,
  resolveToolSpec,
} from './setup-cloudflare.mjs';

async function exampleSettings() {
  const settings = JSON.parse(await readFile(SETTINGS_EXAMPLE_PATH, 'utf8'));
  settings.secrets.tokenEncryptionKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  return settings;
}

void test('validates the documented example and emits a secret-free Wrangler config', async () => {
  const settings = await exampleSettings();
  validateSettings(settings);
  const output = generatedWrangler(settings);
  const config = JSON.parse(output);

  assert.equal(config.name, 'dividend-tracker');
  assert.deepEqual(config.triggers.crons, ['* * * * *']);
  assert.deepEqual(config.compatibility_flags, ['nodejs_compat']);
  assert.deepEqual(config.secrets.required, ['TOKEN_ENCRYPTION_KEY']);
  assert.equal(config.d1_databases[0].database_id, undefined);
  assert.equal(output.includes(settings.secrets.tokenEncryptionKey), false);
});

void test('includes an explicit D1 id only in the local generated config', async () => {
  const settings = await exampleSettings();
  settings.cloudflare.d1.databaseId = '11111111-2222-3333-4444-555555555555';
  const config = JSON.parse(generatedWrangler(settings));
  assert.equal(config.d1_databases[0].database_id, settings.cloudflare.d1.databaseId);
});

void test('rejects an incorrect Taipei daily refresh schedule', async () => {
  const settings = await exampleSettings();
  settings.cloudflare.crons.scheduler = '35 13 * * *';
  assert.throws(() => validateSettings(settings), /scheduler.*\* \* \* \* \*/);
});

void test('accepts the legacy two-cron shape but emits only the minute scheduler', async () => {
  const settings = await exampleSettings();
  delete settings.cloudflare.crons.scheduler;
  settings.cloudflare.crons.hourlyPrices = '0 * * * *';
  settings.cloudflare.crons.dailyDividendsTaipei1335Utc = '35 5 * * *';
  validateSettings(settings);
  const config = JSON.parse(generatedWrangler(settings));
  assert.deepEqual(config.triggers.crons, ['* * * * *']);
});

void test('rejects incomplete legacy cron settings', async () => {
  const settings = await exampleSettings();
  delete settings.cloudflare.crons.scheduler;
  settings.cloudflare.crons.hourlyPrices = '0 * * * *';
  settings.cloudflare.crons.dailyDividendsTaipei1335Utc = '35 13 * * *';
  assert.throws(() => validateSettings(settings), /35 5 \* \* \*/);
});

void test('rejects PBKDF2 iterations above the Cloudflare WebCrypto limit', async () => {
  const settings = await exampleSettings();
  settings.app.passwordPbkdf2Iterations = 100001;
  assert.throws(() => validateSettings(settings), /100000～100000/);
});

void test('personalises a fresh template with isolated Worker and D1 names', async () => {
  const template = await exampleSettings();
  const original = JSON.stringify(template);
  const first = personalizeNewSettings(template, '0123abcd');
  const second = personalizeNewSettings(template, 'fedcba98');
  assert.equal(JSON.stringify(template), original);
  assert.equal(first.cloudflare.workerName, 'dividend-tracker-0123abcd');
  assert.equal(first.cloudflare.d1.databaseName, 'dividend-tracker-0123abcd-db');
  assert.equal(first.cloudflare.d1.databaseId, '');
  assert.notEqual(first.cloudflare.workerName, second.cloudflare.workerName);
  assert.notEqual(first.cloudflare.d1.databaseName, second.cloudflare.d1.databaseName);
  validateSettings(first);
  validateSettings(second);
  assert.equal(generatedWrangler(first).includes(first.secrets.tokenEncryptionKey), false);
});

void test('rejects malformed fresh setup suffixes', async () => {
  const template = await exampleSettings();
  assert.throws(() => personalizeNewSettings(template, 'ABCDEF12'));
  assert.throws(() => personalizeNewSettings(template, '1234'));
});

void test('Cloudflare resource probes fail closed', () => {
  assert.deepEqual(classifyResourceProbe({ status: 0, stdout: '[]', stderr: '' }), { exists: true });
  assert.deepEqual(classifyResourceProbe({ status: 1, stdout: '', stderr: 'Cloudflare code: 10007' }), { exists: false });
  assert.throws(
    () => classifyResourceProbe({ status: 1, stdout: '', stderr: 'network not found' }),
    /資源檢查失敗/,
  );
});

void test('Wrangler row parsing and D1 name collision checks fail closed', () => {
  assert.deepEqual(parseWranglerRows('[{"name":"sample"}]'), [{ name: 'sample' }]);
  assert.throws(() => parseWranglerRows('{"unexpected":true}'), /安全停止/);
  assert.throws(() => parseWranglerRows('not-json'), /安全停止/);
  assert.deepEqual(findDatabase([{ name: 'same-name' }], 'same-name'), { name: 'same-name', id: '' });
});

void test('parses only authorised Cloudflare account ids and display names', () => {
  const raw = JSON.stringify({ result: { accounts: [
    { id: 'ABCDEFABCDEFABCDEFABCDEFABCDEFAB', name: 'Primary' },
    { id: 'not-an-account', name: 'Ignored' },
    { id: '11111111111111111111111111111111', name: '' },
    { id: '22222222222222222222222222222222', display_name: 'Secondary', email: 'hidden@example.test' },
  ] } });
  assert.deepEqual(parseWranglerWhoamiAccounts(raw), [
    { id: 'abcdefabcdefabcdefabcdefabcdefab', name: 'Primary' },
    { id: '22222222222222222222222222222222', name: 'Secondary' },
  ]);
  assert.throws(
    () => parseWranglerWhoamiAccounts('{"accounts":[{"id":"bad","name":"x"}]}'),
    /合法的 Cloudflare 帳戶/,
  );
});

void test('resolves configured and single Cloudflare accounts, requiring selection for many', () => {
  const accounts = [
    { id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', name: 'A' },
    { id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', name: 'B' },
  ];
  assert.deepEqual(resolveCloudflareAccount(accounts.slice(0, 1)), accounts[0]);
  assert.deepEqual(resolveCloudflareAccount(accounts, accounts[1].id), accounts[1]);
  assert.throws(() => resolveCloudflareAccount(accounts), { code: 'ACCOUNT_SELECTION_REQUIRED' });
  assert.throws(() => resolveCloudflareAccount(accounts, 'cccccccccccccccccccccccccccccccc'), {
    code: 'CONFIGURED_ACCOUNT_NOT_AUTHORIZED',
  });
});

void test('extracts only HTTPS workers.dev deployment URLs', () => {
  assert.equal(
    extractDeploymentUrl('Published https://dividend-tracker.example.workers.dev'),
    'https://dividend-tracker.example.workers.dev',
  );
  assert.equal(extractDeploymentUrl('https://example.com'), null);
  assert.equal(extractDeploymentUrl('deployment completed without URL'), null);
});

void test('resolves npm through npm_execpath on Windows', () => {
  const spec = resolveToolSpec('npm', {
    platform: 'win32',
    env: { npm_execpath: 'C:\\project\\node_modules\\npm\\bin\\npm-cli.js' },
    nodeExecutable: 'C:\\Program Files\\nodejs\\node.exe',
  });
  assert.deepEqual(spec, {
    command: 'C:\\Program Files\\nodejs\\node.exe',
    prefixArgs: ['C:\\project\\node_modules\\npm\\bin\\npm-cli.js'],
  });
});

void test('fails closed for Windows npm without npm_execpath', () => {
  assert.throws(
    () => resolveToolSpec('npm', { platform: 'win32', env: {}, nodeExecutable: 'node' }),
    /npm run setup:cloudflare/,
  );
});

void test('resolves Wrangler through the Node executable and local JS CLI', () => {
  const cli = 'C:\\project\\node_modules\\wrangler\\wrangler-dist\\cli.js';
  for (const platform of ['win32', 'linux']) {
    assert.deepEqual(resolveToolSpec('wrangler', {
      platform,
      env: {},
      nodeExecutable: 'node',
      wranglerCli: cli,
    }), { command: 'node', prefixArgs: [cli] });
  }
});

void test('falls back to npm on non-Windows without npm_execpath', () => {
  assert.deepEqual(resolveToolSpec('npm', {
    platform: 'linux',
    env: {},
    nodeExecutable: 'node',
  }), { command: 'npm', prefixArgs: [] });
});
