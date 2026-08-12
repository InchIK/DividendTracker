# DividendTracker 技術開發指南

## 系統組成

- Cloudflare Worker 提供 Hono API、cron 與靜態網站。
- Cloudflare D1 保存公開市場資料與使用者隔離資料。
- React 前端使用 HttpOnly session cookie。
- Scriptable Widget 使用每次下載產生的 installation-scoped Token 與 cache。

## 本機設定

`settings.example.json` 是不含個資的範本。`npm run setup` 會複製並個人化全新 Worker/D1 名稱；既有 `settings.json` 永遠維持原名稱與 ID。`npm run config:generate` 會產生未追蹤的 Wrangler 設定與本機 secret 檔。

## 資料與安全

密碼使用 PBKDF2-HMAC-SHA-256；session 使用 HttpOnly cookie；Widget Token 以雜湊驗證並以 Worker secret 保護必要的加密資料。Token 不應寫入日誌、generic bundle、文件或測試 fixture。

所有使用者私有資料查詢都必須使用 authenticated `user_id` 條件。公開市場目錄、股利事件與價格快照才可共用。

## 更新與 migration

- 每小時更新價格。
- 每日台北時間 13:35（UTC cron `35 5 * * *`）更新股利資料。
- 使用者設定當下立即回補至少一年資料。
- 支援全台 ETF 與股票的動態設定。

隱私重置與完整 migration 後，第一個 owner 是空白資料；舊帳號、Token、持股、股利、價格、同步紀錄與設定會一次清除。這是一次性升級警告，未來正常 migration 不會每次清除資料。

## 安裝、測試與隱私檢查

```bash
npm run setup
npm run setup:cloudflare
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run check:privacy:current
node scripts/check-personal-data.mjs --history
```

Build 會先清理產物，再執行 tracked/build privacy scan。掃描器是提交前的輔助防線，不取代 secret manager、金鑰輪替或 Cloudflare 權限治理。

## Widget 流程

Dashboard 每次下載都驗證目前密碼、輪替新 Token、產生新 installation ID、嵌入目前 Origin，並在連線測試成功後才下載。舊 Widget 立即失效；頁面不顯示或複製 Token，Scriptable 也不會使用舊 Keychain/cache。更換設定必須重新下載。
