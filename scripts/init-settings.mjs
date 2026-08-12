import { ensureSettings, SETTINGS_PATH } from './settings-lib.mjs';

await ensureSettings();
console.log(`已準備個人設定：${SETTINGS_PATH}`);
console.log('此檔已列入 .gitignore，不會被提交。');
