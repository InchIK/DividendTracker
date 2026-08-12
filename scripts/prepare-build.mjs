import { rm } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { ROOT } from './settings-lib.mjs';

const target = resolve(ROOT, 'dist');
const rel = relative(ROOT, target);
if (basename(target) !== 'dist' || !rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
  throw new Error('Refusing to clean an unsafe build target.');
}
await rm(target, { recursive: true, force: true });
console.log('Build preparation: removed the previous dist directory.');
