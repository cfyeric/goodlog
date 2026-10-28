import type { Months, Settings, Tx } from "../core/types";

/**
 * 帳本資料的存取介面。畫面只透過這個介面讀寫，不直接碰資料庫，
 * 所以本機開發可以換成範例資料（demoStore），發佈到 claude.ai 用雲端資料庫（claudeStore）。
 */
export interface LedgerSnapshot {
  settings: Settings | null;
  months: Months;
  /** 月份資料是否已經讀完（讀完才能跑週期規則，否則會重複產生） */
  monthsReady: boolean;
}

export type StoreMode = "demo" | "live" | "readonly" | "offline";

export interface LedgerStore {
  readonly mode: StoreMode;
  /** 開始連線；之後有資料變動就呼叫 onChange */
  start(onChange: (snap: LedgerSnapshot) => void, onError?: (message: string) => void): Promise<void>;
  stop(): void;
  /** 寫入某個月（只送出這台裝置改動的記錄，跟雲端最新內容合併） */
  writeMonth(key: string, items: Tx[]): void;
  /** 整個月直接取代（還原備份用） */
  replaceMonth(key: string, items: Tx[]): Promise<void>;
  /** 寫入設定（短時間內多次呼叫只會寫最後一次） */
  writeSettings(settings: Settings): void;
}
