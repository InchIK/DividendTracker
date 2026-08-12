import { readdir, rm } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { ROOT } from './settings-lib.mjs';

function assertInsideRoot(target) {
  const absolute = resolve(target);
  const rel = relative(ROOT, absolute);
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error('拒絕刪除工作區外或工作區根目錄。');
  }
  return absolute;
}

function shouldRemoveRootFile(name) {
  if (new Set([
    'settings.json', '.dev.vars', '.env', '.tokens.local', '.setup-cloudflare-state.json',
  ]).has(name)) return true;
  if (name.startsWith('.dev.vars.')) return true;
  if (name.startsWith('.env.')) return true;
  if (/^wrangler\..+\.jsonc$/u.test(name)) return true;
  return name.endsWith('.tsbuildinfo');
}

const directoryNames = new Set([
  '.wrangler', 'dist', 'reports', 'playwright-report', 'test-results', 'coverage',
]);

if (!process.argv.includes('--confirm')) {
  console.error('這個命令會刪除本機生成設定、建置產物與測試報告。');
  console.error('如確定要執行，請使用：npm run clean:personal-data -- --confirm');
  console.error('不會刪除任何 Cloudflare 遠端資源。');
  process.exitCode = 2;
} else {
  const entries = await readdir(ROOT, { withFileTypes: true });
  for (const entry of entries) {
    if (!shouldRemoveRootFile(entry.name) && !(entry.isDirectory() && directoryNames.has(entry.name))) continue;
    // wrangler.jsonc is the tracked static config and is intentionally kept.
    if (entry.name === 'wrangler.jsonc') continue;
    const target = assertInsideRoot(resolve(ROOT, entry.name));
    await rm(target, { recursive: true, force: true });
    console.log(`已移除 ${relative(ROOT, target)}`);
  }
  console.log('本機個資與生成檔清理完成；不會刪除任何 Cloudflare 遠端資源。');
}
