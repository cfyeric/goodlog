# 好記（GoodLog）

個人記帳網頁，功能參考 MOZE。正在從舊版單檔 HTML（`legacy/goodlog-legacy.html`）改寫成 Vite + React + TypeScript。
正式版目前仍是舊版，發佈在 claude.ai 的網頁上，資料存在 claude.ai 提供給網頁的雲端資料庫。

## 溝通

- 跟使用者（Eric，台灣）一律用**台灣用語的繁體中文**回覆。介面文字、程式註解、commit 訊息也用繁體中文。
- 只根據確定的事實回答；沒有把握（信心低於 90%）就直接說「【資料不足，無法確認】」，不要用「可能、應該」帶過。牽涉數據或規定時附上來源或推論依據。
- 使用者不一定看得懂程式細節，說明改了什麼時講「畫面上會看到什麼不同」。

## 指令

```bash
npm install
npm run dev        # 本機開發，使用範例資料（不會連到真實帳本）
npm test           # 單元測試 + 新舊版比對
npm run typecheck
npm run build      # 輸出到 dist/
```

## 架構

```
src/core/     純邏輯，不碰畫面、不碰資料庫、沒有全域狀態。「今天」一律由參數傳入。
  types.ts        資料格式（等於雲端資料庫裡的格式，改之前看下方「資料不能破壞」）
  dates.ts money.ts ids.ts
  ledger.ts       查找、付款方式、儲值卡（悠遊卡）判斷與餘額
  recurrence.ts   週期／分期／單次規則：日期、金額計畫、補產生到期記錄（runRecurs）
  recurrenceText.ts 規則的文字說明
  budget.ts       預算計算
  reminders.ts    繳費提醒
  alias.ts        帳單說明 → 類別的商家對照
  statement.ts    信用卡帳單解析與比對
  defaults.ts     新帳本預設值、舊格式設定轉換
  editor.ts       記帳畫面的邏輯：算式、數字鍵盤、草稿、儲存（含週期記錄的修改範圍）、刪除
  report.ts       報表期間（週／月／年）
  backup.ts       備份 JSON、還原、匯出 CSV
  moze.ts         從 MOZE 的 CSV 匯入
src/data/     資料存取
  store.ts        LedgerStore 介面（畫面只透過它讀寫）
  claudeStore.ts  claude.ai 雲端資料庫（window.claude.use("db")）
  demoStore.ts    本機範例資料
  merge.ts        多裝置同時寫入同一個月的合併邏輯
src/app/      React 畫面
  state.tsx       帳本狀態與寫入（AppProvider）；nav.tsx 目前在哪一頁
  shell/          頁首提醒、底部選單、提示訊息
  pages/          首頁、帳戶、專案、報表、設定、類別管理
  editor/         記帳畫面、日期、排程、加值對話框
  import/         信用卡帳單比對、MOZE 匯入
  legacy.css      直接沿用舊版的樣式（class 名稱跟舊版相同）
legacy/       舊版完整原始碼，是所有行為的標準答案
scripts/legacy-snapshot.mjs  用舊版算出結果，給新舊版比對測試用
fixtures/     比對用資料；fixtures/private/ 是真實帳本，已在 .gitignore，絕對不要提交
```

## 資料不能破壞（最重要）

使用者的真實帳本已經在雲端，有好幾年、約 6,000 筆記錄。新版必須直接讀得懂現有資料：

- 資料庫路徑：`data/users/<uid>/settings`（設定）、`data/users/<uid>/settings/months/<YYYY-MM>`（每月 `{ items: Tx[] }`）。
- **不要改欄位名稱或結構**。要加欄位就設成選填，舊資料沒有這個欄位也要正常。
- 週期產生的記錄 id 是 `規則id-期數`（很早期轉換來的規則用 `規則id-j`）。改了會造成重複記錄。
- 備份檔裡 `app: "ririzhang"` 是格式辨識用，不要改（舊名稱）。
- 雲端快照的物件是唯讀的，要修改前一定先複製（claudeStore 已處理）。
- 寫入某個月只送出差異，寫入前重新讀雲端再合併（merge.ts），不要整個月覆蓋。

## 新舊版比對測試

`tests/legacy-diff.test.ts` 會把新版模組的結果跟舊版逐項比較（預算、儲值卡餘額、提醒、每條規則 40 期、runRecurs、帳單比對、日期解析、分期計畫、文字）。

- 改 `src/core` 之後一定要跑 `npm test`。比對失敗代表行為變了；除非使用者要求改行為，否則要修到一致。
- 如果是刻意改行為：先改舊版沒有的地方不需要比對；真的要改既有行為，跟使用者確認後，重跑 `scripts/legacy-snapshot.mjs` 更新 fixture，並在 commit 說明。
- 重新產生 fixture（需要 Playwright + Chromium）：`TZ=Asia/Taipei node scripts/legacy-snapshot.mjs`。
- 測試固定用台灣時區（vitest.config.ts）。

## 發佈

正式網址是 claude.ai 上的網頁。發佈不在這個專案裡做：

1. 在這裡改好、測好，push 到 GitHub（`cfyeric/goodlog`）。
2. 到 claude.ai 跟 Claude 說「從 GitHub 更新」，由那邊 pull、build、測試後發佈到原本的網址。
3. 新版還沒完成前，claude.ai 上繼續用 `legacy/` 的舊版。新版要先發佈到另一個測試網址，使用者在手機試用沒問題才換。

- 測試網址：https://claude.ai/artifact/5ZSvAJCpfiehvWoWQq13mu（「好記 測試版」，目前沒有宣告資料庫權限，只會顯示範例資料）。
- 發佈用的檔案：`npm run build:artifact` → `dist-artifact/index.html`（JS、CSS 內嵌成單一檔案，去掉 claude.ai 會自動加上的外層標籤）。
- 注意：claude.ai 每個網頁有自己的資料庫。測試網址就算開了資料庫權限，也是另一個空的帳本，看不到正式帳本的資料。

`vite.config.ts` 的 `base: "./"` 是為了讓打包後用相對路徑引用檔案，不要改。

## 改寫進度

第一階段（已完成）：專案架構、核心邏輯模組、資料層、新舊版比對測試。

第二階段（畫面，一頁一頁做，每頁都要跟舊版對照）：以下都已完成，並在手機寬度、淺色／深色下跟舊版截圖逐像素比對過。下一步是使用者在測試網址試用。

1. 日曆首頁：月曆、本月收支、預算提醒卡片（左右滑動）、待入帳、當日記錄、頁首繳費提醒列
2. 記帳畫面：支出／收入、數字鍵盤與算式、手續費與折扣、類別（主類別＋子類別、拖曳排序）、付款方式與卡片、專案、名稱與商家建議（兩邊連動）、日期時間、標籤、備註、排程（週期／分期／單次、立即／延後／提醒入帳）、編輯週期記錄的範圍（只改這筆／這筆和之後／全部）、刪除、確認入帳
3. 帳戶頁：現金／信用卡統計、各卡刷卡金額與預算、儲值卡（悠遊卡）餘額與加值、帳戶設定頁、新增卡片、封存區、帳單匯入比對、週期與分期排程清單
4. 專案頁：清單、預算、專案設定頁、新增、封存區
5. 報表：總覽、類別（圓餅、下鑽）、帳戶、專案，月／年等期間
6. 設定：類別管理（新增、改名、圖示與顏色、隱藏、排序）、商家對照、備份與匯出（JSON、CSV）、還原、從 MOZE 匯入
7. 跨過午夜自動更新今天並補跑週期規則

尚未決定、不要自己做：一筆記錄多個類別。

## 慣例

- 外觀沿用舊版：shadcn/ui neutral 風格、淺色與深色模式、手機寬度優先。
- 介面上的返回按鈕是黑底白字（深色模式反轉），放在卡片內左上角，不放在頁首。
- 底部選單：帳戶、專案、中間圓形按鈕（在日曆頁是「記一筆」，其他頁是「回到日曆」）、報表、設定。
- 刪除這類不能復原的操作要按兩次確認。
