import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, test } from 'node:test';

/** @type {string[]} */
const roots = [];
const script = resolve('scripts/sanitize-build-artifacts.mjs');

function temporaryBuild() {
  const root = mkdtempSync(join(tmpdir(), 'dividend-tracker-build-security-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

void test('removes forbidden secret files recursively without touching application assets', () => {
  const root = temporaryBuild();
  const worker = join(root, 'worker');
  mkdirSync(worker);
  writeFileSync(join(root, 'index.js'), 'export default {};');
  writeFileSync(join(worker, '.dev.vars'), 'SECRET=never-ship');
  writeFileSync(join(worker, '.dev.vars.production'), 'SECRET=never-ship');
  writeFileSync(join(worker, '.env.production'), 'SECRET=never-ship');
  writeFileSync(join(worker, '.tokens.local'), 'SECRET=never-ship');
  writeFileSync(join(worker, 'settings.json'), '{"secret":"never-ship"}');
  writeFileSync(join(worker, 'wrangler.generated.jsonc'), '{}');
  writeFileSync(join(worker, 'wrangler.json'), JSON.stringify({
    name: 'example-worker',
    configPath: 'C:\\Users\\example-user\\project\\wrangler.jsonc',
    userConfigPath: 'C:\\Users\\example-user\\project\\wrangler.jsonc',
  }));
  writeFileSync(join(worker, 'wrangler.jsonc'), '{}');
  writeFileSync(join(worker, 'widget.tsbuildinfo'), 'local-path-cache');
  writeFileSync(join(worker, 'application.js'), 'console.log("keep");');

  execFileSync(process.execPath, [script, root], { stdio: 'pipe' });

  assert.equal(readFileSync(join(root, 'index.js'), 'utf8'), 'export default {};');
  assert.throws(() => readFileSync(join(worker, '.dev.vars')));
  assert.throws(() => readFileSync(join(worker, '.dev.vars.production')));
  assert.throws(() => readFileSync(join(worker, '.env.production')));
  assert.throws(() => readFileSync(join(worker, '.tokens.local')));
  assert.throws(() => readFileSync(join(worker, 'settings.json')));
  assert.throws(() => readFileSync(join(worker, 'wrangler.generated.jsonc')));
  const wrangler = JSON.parse(readFileSync(join(worker, 'wrangler.json'), 'utf8'));
  assert.deepEqual(wrangler, { name: 'example-worker' });
  assert.throws(() => readFileSync(join(worker, 'wrangler.jsonc')));
  assert.throws(() => readFileSync(join(worker, 'widget.tsbuildinfo')));
  assert.equal(readFileSync(join(worker, 'application.js'), 'utf8'), 'console.log("keep");');
});

void test('fails closed when the target directory does not exist', () => {
  const root = temporaryBuild();
  assert.throws(() => execFileSync(process.execPath, [script, join(root, 'missing')], {
    stdio: 'pipe',
  }));
});
