import { writeFile } from 'node:fs/promises';
import {
  DEV_VARS_PATH,
  GENERATED_WRANGLER_PATH,
  generatedWrangler,
  loadSettings,
} from './settings-lib.mjs';

const settings = await loadSettings();
await writeFile(GENERATED_WRANGLER_PATH, generatedWrangler(settings), 'utf8');
await writeFile(
  DEV_VARS_PATH,
  `TOKEN_ENCRYPTION_KEY=${settings.secrets.tokenEncryptionKey}\n`,
  { encoding: 'utf8', mode: 0o600 },
);
console.log(`已產生 ${GENERATED_WRANGLER_PATH}`);
console.log(`已產生本機 Secret ${DEV_VARS_PATH}`);
