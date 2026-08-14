# DividendTracker

DividendTracker 是以 Cloudflare Workers、D1 與 Scriptable Widget 建立的多使用者股利追蹤工具。公開市場資料共用，持股、股利覆寫、Widget 外觀與帳號資料依使用者隔離。

## 畫面展示

### Web 儀表板與持股設定

<p align="center">
  <a href="./docs/images/showcase/dashboard-and-widget-preview.png">
    <img src="./docs/images/showcase/dashboard-and-widget-preview.png" alt="DividendTracker 儀表板、配息資訊與手機 Widget 預覽" width="100%">
  </a>
</p>

<p align="center">
  <a href="./docs/images/showcase/portfolio-settings.png">
    <img src="./docs/images/showcase/portfolio-settings.png" alt="DividendTracker ETF 與個股持股設定" width="100%">
  </a>
</p>

### iPhone Scriptable Widget

<p align="center">
  <a href="./docs/images/showcase/iphone-home-widget.png">
    <img src="./docs/images/showcase/iphone-home-widget.png" alt="iPhone 主畫面的 DividendTracker Scriptable Widget" width="42%">
  </a>
  &nbsp;&nbsp;
  <a href="./docs/images/showcase/scriptable-widget-preview.png">
    <img src="./docs/images/showcase/scriptable-widget-preview.png" alt="Scriptable 中的 DividendTracker Widget 預覽" width="42%">
  </a>
</p>

點擊圖片可查看原始尺寸。

## 快速開始

```bash
git clone https://github.com/InchIK/DividendTracker.git
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

每按一次下載，先前下載的 Widget 會立即失效。頁面不顯示、不複製、不重用 Token，也不接管舊 Keychain 或舊 cache。背景、排列方式與更新間隔保存在 D1，既有 Widget 會在下次更新時套用，不必重新下載；只有更換連線憑證時才需要下載新腳本。Widget 的預覽只使用中性欄位標籤。

owner 可在「資料同步」頁調整每日完整同步的台北時間，不必重新部署；行情仍於每個整點更新。完成標的設定後會立即回補至少一年資料，並支援全台 ETF 與股票的動態設定。

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
