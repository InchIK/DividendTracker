import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  SETTINGS_EXAMPLE_PATH,
  generatedWrangler,
  personalizeNewSettings,
  validateSettings,
} from './settings-lib.mjs';
import {
  classifyResourceProbe,
  findDatabase,
  parseWranglerRows,
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
  assert.deepEqual(config.triggers.crons, ['0 * * * *', '35 5 * * *']);
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
    /probe failed/,
  );
});

void test('Wrangler row parsing and D1 name collision checks fail closed', () => {
  assert.deepEqual(parseWranglerRows('[{"name":"sample"}]'), [{ name: 'sample' }]);
  assert.throws(() => parseWranglerRows('{"unexpected":true}'), /安全停止/);
  assert.throws(() => parseWranglerRows('not-json'), /安全停止/);
  assert.deepEqual(findDatabase([{ name: 'same-name' }], 'same-name'), { name: 'same-name', id: '' });
});
