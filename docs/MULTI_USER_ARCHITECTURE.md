# DividendTracker 多使用者架構

## 範圍

DividendTracker 使用帳號與密碼驗證。公開市場目錄、股利事件、價格快照與來源狀態可共用；帳號、持股、股利覆寫、Widget 外觀與 Widget 憑證都以 `user_id` 隔離。

## 驗證與註冊

- 密碼以每位使用者的 salt 和 PBKDF2-HMAC-SHA-256 雜湊保存。
- 瀏覽器使用 HttpOnly、SameSite 的 session cookie，D1 只保存雜湊值。
- 第一個註冊帳號成為全新空白 owner，不會接管舊的單一使用者資料。
- owner 可透過 registration policy 控制後續註冊與 Google 登入的新帳號分支。

## 資料邊界

| 資料 | 範圍 |
| --- | --- |
| users、credentials、sessions | 使用者 |
| watchlist、持股與啟用狀態 | 使用者 |
| Widget 外觀與 Widget 憑證 | 使用者 |
| 手動股利覆寫與鎖定 | 使用者 |
| instruments、股利事件與公開價格 | 共用市場資料 |
| source status 與 sync runs | 共用作業狀態 |

每個需要私有資料的 API 都必須使用 middleware 解析出的 `authUserId`，並在查詢與寫入時加入明確的使用者條件。Widget bearer credential 也只解析到同一個 `user_id`。

## Widget 憑證與安裝

每位使用者可取得獨立的 Widget Token。Dashboard 每次下載都輪替 Token、建立新的 installation ID，並嵌入目前頁面 Origin；測試新 Token 成功後才產生腳本。舊腳本會立即失效，generic 或舊 Keychain/cache 不會被接管。

## 設定與資源

第一次 setup 會產生唯一的 Worker 與 D1 名稱。建立資源前會先查同名 Worker，再查同名 D1；任何碰撞或無法判定的錯誤都會 fail closed。已有 D1 ID 的安裝可以重新部署目前資源。

## 接受條件

- 私有 API 不得缺少使用者條件。
- 瀏覽器不接收可重用的 session bearer token。
- Widget Token 不出現在 generic bundle、日誌或設定讀取回應。
- 密碼變更會撤銷其他 session。
- 測試必須涵蓋跨使用者拒絕、Widget 憑證隔離、密碼撤銷與全新 owner 行為。
