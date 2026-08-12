# DividendTracker

DividendTracker 是以 Cloudflare Workers、D1 與 Scriptable Widget 建立的多使用者股利追蹤工具。公開市場資料共用，持股、股利覆寫、Widget 外觀與帳號資料依使用者隔離。

## 快速開始

```bash
git clone https://github.com/OWNER/REPOSITORY.git
cd REPOSITORY
npm install
npm run setup
npm run config:generate
npm run dev
```

`npm run setup` 第一次建立 `settings.json` 時，會以密碼學隨機值產生唯一的 Worker 名稱與 D1 名稱，並產生新的加密金鑰。範本不含個人資料；既有 `settings.json` 永遠不會自動改名或重設 ID。

## Cloudflare 設定

```bash
npm run setup:cloudflare
```

全新設定會先登入 Cloudflare，再依序檢查同名 Worker、檢查同名 D1，兩者都不存在才建立 D1。任何同名資源或無法判定的 API 錯誤都會 fail closed，不會重用、接管或刪除既有資源。已存在 `databaseId` 的設定可重新套用 migration 並重新部署目前的 Worker/D1。

第一次註冊的帳號是全新空白 owner，不會接管舊資料。完成隱私重置與完整 migration 後，先前帳號、Token、持股、股利、價格、同步紀錄與設定資料會一次清除；未來一般 migration 不會每次清除資料。

## Widget

在 Dashboard 的 Widget 頁面按下下載時：

1. 先驗證目前帳號密碼。
2. 取得乾淨腳本，輪替一次全新 Widget Token，並建立新的 installation ID。
3. 將目前頁面 Origin、新 Token 與 installation ID 嵌入腳本，再測試連線成功後才下載。

每按一次下載，先前下載的 Widget 會立即失效。頁面不顯示、不複製、不重用 Token，也不接管舊 Keychain 或舊 cache；更換設定必須回到 Dashboard 重新下載。Widget 的預覽只使用中性欄位標籤。

已設定且啟用的標的會在每日台北時間 13:35 更新；完成設定後會立即回補至少一年資料，並支援全台 ETF 與股票的動態設定。

## 隱私與安全檢查

```bash
npm run check:privacy:current
npm run check:privacy
npm run check
```

Build 會在清理產物後執行 tracked 與 build privacy scan。要檢查所有可達 Git 歷史，請另外執行：

```bash
node scripts/check-personal-data.mjs --history
```

掃描器只能降低誤提交風險，不能取代真正的 secret management、金鑰輪替與權限控管。

## 主要指令

```bash
npm run setup
npm run setup:cloudflare
npm run db:migrate:local
npm run build
npm run test:e2e
npm run clean:personal-data -- --confirm
```

`clean:personal-data` 只刪除工作區內經過驗證的本機生成設定、建置產物與報告，絕不刪除 Cloudflare 遠端資源。

## 文件

- [手動步驟](./MANUAL_STEPS.md)
- [多使用者架構](./docs/MULTI_USER_ARCHITECTURE.md)
- [技術開發指南](./docs/TECHNICAL_DEVELOPMENT_GUIDE.md)
- [資料來源](./docs/DATA_SOURCES.md)
