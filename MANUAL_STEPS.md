# DividendTracker 安裝步驟

推薦使用自動流程；它會從 `settings.example.json` 建立唯一的 Worker 與 D1 名稱。

## 1. 建立本機設定

```bash
npm install
npm run setup
npm run config:generate
```

第一次 setup 會產生新的隨機名稱與 Token 加密金鑰。既有 `settings.json` 會保留原本的名稱與 D1 ID，不會被自動改名。

## 2. 建立或重新部署 Cloudflare 資源

```bash
npm run setup:cloudflare
```

全新設定會先確認同名 Worker 不存在，再確認同名 D1 不存在，最後才建立 D1 並套用所有 migration。若任一探查回傳無法判定的錯誤，流程會停止且不建立資源；同名資源也不會被重用。

若 `settings.json` 已有明確 `cloudflare.d1.databaseId`，流程視為既有安裝，只會重新套用目前資源並部署。

## 3. 本機開發與檢查

```bash
npm run db:migrate:local
npm run dev
npm run check
npm run check:privacy:current
```

## 4. Widget 安裝

在 Dashboard 的 Widget 頁面輸入目前帳號密碼並下載。每次下載都會驗證密碼、輪替全新 Token、產生新的 installation ID，並綁定目前頁面 Origin；連線測試成功後才產生腳本。舊 Widget 會立即失效，頁面不會顯示或複製 Token。

將下載的 `DividendTrackerWidget.js` 分享至 Scriptable，再加入主畫面或鎖定畫面。背景、排列方式與更新間隔可直接在 Dashboard 儲存，既有 Widget 會在下次更新時套用；若要更換連線憑證，才需要重新下載，不要在 Scriptable 內貼上舊 Token。

每日完整同步時間由 owner 在「資料同步」頁以台北時間設定，不需重新部署。Widget 更新間隔是 Scriptable 提交給 iOS 的最早更新時間，實際喚醒時間仍由系統決定。

## 5. 隱私重置

```bash
npm run clean:personal-data -- --confirm
```

這只清理本機生成檔，不會刪除 Cloudflare 遠端 Worker、D1 或其他資源。完整 migration 與隱私重置後，第一個註冊帳號是空白 owner。
