/**
 * esbuild bundler — bundle widget source into the Cloudflare static-assets tree.
 * Single file, no imports after bundle, readable comments retained.
 */
import { build } from 'esbuild';
import { mkdirSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { Script } from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

const entry = resolve(rootDir, 'widget-src/DividendTrackerWidget.ts');
const outdir = resolve(rootDir, 'dist/client/widget');
const outfile = resolve(outdir, 'DividendTrackerWidget.js');
const BASE_PLACEHOLDER = '__DIVIDEND_TRACKER_BASE_URL__';
const TOKEN_PLACEHOLDER = '__DIVIDEND_TRACKER_WIDGET_TOKEN__';
const INSTALLATION_ID_PLACEHOLDER = '__DIVIDEND_TRACKER_INSTALLATION_ID__';

mkdirSync(outdir, { recursive: true });

try {
  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    outfile,
    minify: false,
    sourcemap: false,
    banner: {
      js: '// Variables: [widgetFamily]\n// Defines: ["module"]',
    },
    legalComments: 'inline',
    logLevel: 'info',
  });
  const genericBundle = readFileSync(outfile, 'utf8');
  if (!genericBundle.includes(JSON.stringify(BASE_PLACEHOLDER))
      || !genericBundle.includes(JSON.stringify(TOKEN_PLACEHOLDER))
      || !genericBundle.includes(JSON.stringify(INSTALLATION_ID_PLACEHOLDER))) {
    throw new Error('Widget bundle is missing personalised-download placeholders');
  }
  for (const marker of [
    String.raw`\u6708\u914D\u606F`,
    String.raw`\u9810\u8A08\u914D\u606F`,
    String.raw`\u6628\u6536`,
    String.raw`\u4ECA\u6536`,
    'compactYuanAmount', 'startColor', 'endColor',
    '#071426', '#BE123C', '#166534',
  ]) {
    if (!genericBundle.includes(marker)) {
      throw new Error(`Widget bundle is missing visual-layout marker: ${marker}`);
    }
  }
  const lockRendererStart = genericBundle.indexOf('function renderLockScreen(widget, res)');
  const lockRendererEnd = genericBundle.indexOf('var HOME_PALETTES', lockRendererStart);
  const lockRenderer = lockRendererStart >= 0 && lockRendererEnd > lockRendererStart
    ? genericBundle.slice(lockRendererStart, lockRendererEnd)
    : '';
  const lockTextCalls = lockRenderer.match(/\.addText\(/g)?.length ?? 0;
  if (lockTextCalls !== 2 || lockRenderer.includes('res.items') || !lockRenderer.includes('cornerRadius = 13')) {
    throw new Error('Lock Screen bundle must contain only the rounded month and total text');
  }
  const smokeBundle = genericBundle
    .replaceAll(JSON.stringify(BASE_PLACEHOLDER), JSON.stringify('https://worker.example.test'))
    .replaceAll(JSON.stringify(TOKEN_PLACEHOLDER), JSON.stringify('read-only-"quoted"-token'))
    .replaceAll(JSON.stringify(INSTALLATION_ID_PLACEHOLDER), JSON.stringify('00000000-0000-4000-8000-000000000000'));
  if (smokeBundle.includes(BASE_PLACEHOLDER)
      || smokeBundle.includes(TOKEN_PLACEHOLDER)
      || smokeBundle.includes(INSTALLATION_ID_PLACEHOLDER)) {
    throw new Error('Widget bundle placeholders were not fully replaceable');
  }
  if (smokeBundle.includes('ADMIN_TOKEN')) {
    throw new Error('Widget bundle must never contain an admin-token setting');
  }
  for (const forbidden of [
    'etfDividendHub',
    'etf-dividend-widget-cache.json',
    'dividendTracker.baseUrl',
    'dividendTracker.widgetToken',
    '0050',
    '0056',
    '00878',
    '00919',
    '.workers.dev',
  ]) {
    if (genericBundle.includes(forbidden) || smokeBundle.includes(forbidden)) {
      throw new Error(`Widget bundle contains forbidden personal/legacy value: ${forbidden}`);
    }
  }
  // Compile without executing Scriptable globals to verify injected quotes and
  // backslashes cannot produce an invalid downloaded script.
  new Script(smokeBundle);
  console.log('✅ Widget bundled to dist/client/widget/DividendTrackerWidget.js');
} catch (err) {
  console.error('❌ Widget build failed:', err);
  process.exit(1);
}
