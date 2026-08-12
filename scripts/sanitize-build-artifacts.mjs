import { lstat, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, parse, resolve } from 'node:path';

const target = resolve(process.argv[2] ?? 'dist');
const forbiddenExactNames = new Set([
  '.dev.vars', '.tokens.local', '.env', 'settings.json',
  'wrangler.generated.jsonc', 'wrangler.jsonc',
]);

/** @param {string} name @returns {boolean} */
function isForbidden(name) {
  return forbiddenExactNames.has(name)
    || name.startsWith('.dev.vars.')
    || name.startsWith('.env.')
    || name.endsWith('.tsbuildinfo');
}

/** @param {string} directory @returns {Promise<string[]>} */
async function sanitize(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  /** @type {string[]} */
  const removed = [];

  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isFile() && entry.name === 'wrangler.json') {
      const config = JSON.parse(await readFile(path, 'utf8'));
      delete config.configPath;
      delete config.userConfigPath;
      await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
      continue;
    }
    if (isForbidden(entry.name)) {
      await rm(path, { recursive: true });
      removed.push(path);
      continue;
    }
    if (entry.isDirectory()) removed.push(...await sanitize(path));
  }

  return removed;
}

/** @param {string} directory @returns {Promise<string[]>} */
async function findForbidden(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  /** @type {string[]} */
  const found = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (isForbidden(entry.name)) found.push(path);
    else if (entry.isDirectory()) found.push(...await findForbidden(path));
  }
  return found;
}

try {
  const canonicalTarget = await realpath(target);
  const stats = await lstat(canonicalTarget);
  if (!stats.isDirectory()) throw new Error(`Build target is not a directory: ${target}`);
  const projectRoot = await realpath(resolve('.'));
  if (canonicalTarget === projectRoot || canonicalTarget === parse(canonicalTarget).root || canonicalTarget === '/') {
    throw new Error(`Refusing to sanitize unsafe target: ${canonicalTarget}`);
  }

  const removed = await sanitize(canonicalTarget);
  const remaining = await findForbidden(canonicalTarget);
  if (remaining.length > 0) {
    throw new Error(`Forbidden build artifacts remain: ${remaining.join(', ')}`);
  }

  console.log(`Build artifact security: removed ${removed.length} forbidden file(s) from ${basename(canonicalTarget)}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
