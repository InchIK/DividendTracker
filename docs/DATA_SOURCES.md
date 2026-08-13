# 資料來源說明

> 最後依目前實作核對：2026-08-11。規劃文件中的來源不代表已接線；本文件只列出目前程式實際使用的來源與限制。

## 核心資料邊界

- 標的 identity 為 `market:code`，例如 `twse:0050`、`twse:2330`、`tpex:6488`。
- 官方全市場 metadata 可在單次搜尋 request 的記憶體中暫存，但只有管理員明確選取的標的可寫入 D1。
- 價格與配息同步必須先讀取 enabled、active、未封存的 watchlist；空清單不得呼叫上游。
- 全市場 response 必須先在 Worker 記憶體篩選，D1 observation、hash 與 raw payload 只能包含 selected records。
- 上游失敗或資料缺漏時保留 last-good，不得寫成 `0` 或刪除既有事件。

## 標的 metadata 與搜尋

### 1. TWSE 上市公司基本資料

- **API**：`https://openapi.twse.com.tw/v1/opendata/t187ap03_L`
- **程式來源名稱**：`twse_stock_master`／`twse_t187ap03_L`
- **用途**：搜尋上市股票代號與名稱。
- **主要欄位**：`公司代號`、`公司簡稱`。
- **保存方式**：搜尋結果不直接寫入 D1；使用者選取後才建立 instrument/watchlist。

### 2. TWSE 基金基本資料

- **API**：`https://openapi.twse.com.tw/v1/opendata/t187ap47_L`
- **程式來源名稱**：`twse_etf_master`／`twse_t187ap47_L`／`twse_fund_mapping`
- **用途**：搜尋上市 ETF，並取得 selected ETF 代號至基金統一編號的對應。
- **主要欄位**：`基金代號`、`基金簡稱`、`基金統一編號`。
- **限制**：此資料不是完整上櫃 ETF catalog，也不得用來宣稱涵蓋全部台灣證券。

### 3. TPEx 上櫃公司基本資料

- **API**：`https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O`
- **程式來源名稱**：`tpex_stock_master`／`tpex_mopsfin_t187ap03_O`
- **用途**：搜尋上櫃股票代號與名稱。
- **主要欄位**：`SecuritiesCompanyCode`、`CompanyAbbreviation`。
- **限制**：目前沒有已實證、單一且完整的官方上櫃 ETF metadata catalog。搜尋 API 可能回傳 partial 狀態，不能把上櫃股票來源冒充上櫃 ETF 完整來源。

標的搜尋會並行查詢上述來源；單一來源失敗時回傳其他有效結果及 `partial=true`，全部失敗才視為來源不可用。最多只對查詢命中的 bounded 結果呼叫 TWSE MIS 取得報價預覽。

## 價格來源

### 4. TWSE MIS 最新成交

- **API**：`https://mis.twse.com.tw/stock/api/getStockInfo.jsp`
- **程式來源名稱**：`twstock_twse_mis`
- **用途**：以 mlouielu/twstock 相容協定查詢 selected 上市／上櫃股票與 ETF 的最後成交、前收、交易日期與時間。
- **查詢方式**：只組合 selected symbol channels，例如 `tse_2330.tw`、`otc_6488.tw`。
- **限制**：無成交、429、schema drift 或超過盤中新鮮度門檻時，必須標示 `no_trade`、`stale` 或 `error`；不得以前收冒充最新成交。

### 5. TWSE 全部證券每日收盤行情

- **API**：`https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL`
- **程式來源名稱**：`twse_stock_day_all`
- **用途**：取得 selected 上市標的的官方收盤／前一交易日收盤價。
- **主要欄位**：`Code`、`ClosingPrice`。
- **保存方式**：全市場 response 在記憶體篩選，僅 selected rows 可進入 price observation。

### 6. TPEx 上櫃股票行情

- **API**：`https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes`
- **程式來源名稱**：`tpex_mainboard_quotes`
- **用途**：取得 selected 上櫃標的的官方收盤／前收資料。
- **主要欄位**：`Date`、`SecuritiesCompanyCode`、`Close`。
- **限制**：空價、`-` 或 `--` 代表沒有可用成交，不是價格 `0`。

Worker 使用每分鐘 scheduler Cron；只有每個整點才執行價格同步。同步會先讀取 selected instruments，依市場查官方盤後來源，再以 TWSE MIS 補最新成交。`latest_prices` 與 `price_observations` 都只能包含 selected instruments；來源失敗時保留 last-good。

## 配息來源

### 7. TWSE 除權息預告

- **API**：`https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL`
- **程式來源名稱**：`twse_ex_schedule`
- **用途**：取得 selected TWSE 股票與 ETF 的除息排程。
- **主要欄位**：`Date`、`Code`、`Name`、`CashDividend`。
- **優先級**：20。
- **限制**：此來源不提供發放日；`CashDividend` 空字串表示尚未公告，不是 `0`。

### 8. SITCA 境內基金配息資料

- **API**：`https://www.sitca.org.tw/MemberK0000/F/03/160547投信投顧公會境內基金配息資料.csv`
- **程式來源名稱**：`sitca_open_data`
- **格式**：UTF-8 CSV（可含 BOM）。
- **用途**：透過基金統一編號取得 selected ETF 的基準日、除息日、發放日與每單位分派金額。
- **主要欄位**：`基金統編`、`配息幣別`、`配息基準日`、`除息日`、`收益分配發放日`、`每單位分派金額`。
- **篩選**：只接受 `TWD` 且基金統一編號已對應到 selected ETF 的 rows。
- **優先級**：80。
- **限制**：CSV 是移動時間窗，不保證每次包含所有 selected ETF；下載失敗或缺列不得刪除既有資料。

### 9. TWSE e添富配息表

- **URL**：`https://www.twse.com.tw/zh/ETFortune/dividendList`
- **程式來源名稱**：`etfortune_html`
- **格式**：HTML `table#myTable`。
- **用途**：低頻回填 selected TWSE ETF 的年度除息日、基準日、發放日與每受益權單位配發金額。
- **必要表頭**：`證券代號`、`證券名稱`、`除息交易日`、`收益分配基準日`、`收益分配發放日`、`每受益權單位配發金額`。
- **優先級**：90。
- **保護措施**：嚴格檢查表頭、欄位數、重複 event key、資料筆數與 selected coverage；異常驟降或 selected coverage 為空時整批拒絕。
- **保存方式**：完整 HTML 只存在單次函式記憶體；D1 只保存 selected rows 的 bounded raw payload 與 selected payload hash。

### 10. FinMind 台股股利資料

- **API**：`https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockDividend`
- **程式來源名稱**：`finmind_dividend`
- **用途**：使用者新增或重新啟用標的時，立即依代碼回補至少 370 天的上市／上櫃 ETF 與股票除息日、發放日及現金股利；每日排程再逐一更新所有 enabled 標的。
- **主要欄位**：`stock_id`、`CashExDividendTradingDate`、`CashDividendPaymentDate`、`CashEarningsDistribution`、`CashStatutorySurplus`。
- **優先級**：70；ETF 的 e添富／SITCA 官方資料仍可覆蓋，股票則用來補足 TWSE 除權息預告沒有的發放日。
- **限制**：無 Token 的公開介面不允許一次下載全市場，因此只查使用者已設定代碼；同一除息日若有修訂列，採公告日期／時間最新版本，零現金股利不建立事件。

Cloudflare 以 `* * * * *`（UTC）喚醒輕量 scheduler。owner 設定的每日台北時間保存在 D1，scheduler 只在該分鐘原子取得當日執行權後進行完整同步；同一天最多執行一次。所有 enabled 標的行情仍在每個整點更新，若每日同步恰逢整點則只更新一次行情。

## 來源優先級

| 來源 | 優先級 | 規則 |
|---|---:|---|
| 人工覆核並鎖定 | 100 | 最高，自動同步不得覆蓋 |
| TWSE e添富完整公告 | 90 | selected TWSE ETF 低頻回填 |
| SITCA 開放資料 | 80 | selected ETF 官方結構化資料 |
| FinMind `TaiwanStockDividend` | 70 | selected ETF／股票至少一年股利與發放日回補 |
| TWSE 除權息預告 | 20 | 排程來源，通常沒有發放日 |
| TWSE 基金對應 | 10 | metadata/mapping，不直接決定配息事件 |

同一 `instrument_id + ex_date` 的不同來源若資料衝突，由 reconciliation 規則選擇 canonical 值；人工鎖定永遠優先，且 observation 歷史必須保留。

## 狀態與期間語意

- `schedule_only`：只有除息排程，發放日或金額尚未公告。
- `pending_amount`：已有發放日但金額尚未公告。
- `announced`：已有發放日與金額。
- `verified`：人工覆核並鎖定。
- `conflict`：高可信來源資料不一致。
- `paid`／`cancelled`：已發放／事件取消。

配息月份只依 `pay_date` 判定，不得用 `ex_date` 代替。例如除息日在 7 月、發放日在 8 月的事件，必須顯示在 8 月。

## 已知未接線範圍

- 規劃文件提到的 MOPS 股利決議、重大訊息與歷史 HTML adapters，目前不在 `worker/sources` 中，不得標示為已完成來源。
- TPEx 上櫃 ETF 完整官方 metadata catalog 仍待確認。
- 官方欄位可能改版；schema 不符、空表或 selected coverage 異常下降時應拒絕該批次並保留 last-good。
