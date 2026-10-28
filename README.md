# 好記（GoodLog）

個人記帳網頁，功能參考 MOZE：日曆記帳、帳戶與專案預算、週期與分期、信用卡帳單比對、悠遊卡儲值。

目前正從舊版單檔網頁（`legacy/`）改寫成 React + TypeScript。開發說明和進度見 [CLAUDE.md](./CLAUDE.md)。

## 開始

需要 Node.js 22 以上。

```bash
npm install
npm run dev
```

本機開發時會自動使用範例資料，不會連到真實帳本，改動也不會保存。

## 測試

```bash
npm test
```

包含新舊版比對：確認改寫後的計算結果跟舊版完全相同。
