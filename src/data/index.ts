import type { LedgerStore } from "./store";
import { connectClaude, createClaudeStore } from "./claudeStore";
import { createDemoStore } from "./demoStore";

export * from "./store";
export { createDemoStore, demoLedger } from "./demoStore";

declare global {
  interface Window {
    /** 自動化測試用：指定範例資料的內容 */
    __GOODLOG_DEMO__?: { settings: import("../core/types").Settings; months: import("../core/types").Months };
  }
}

/** 在 claude.ai 上就用雲端資料庫，否則（本機開發）用範例資料 */
export async function openStore(): Promise<LedgerStore> {
  const c = await connectClaude();
  if (c) return createClaudeStore(c.db, c.uid);
  const fx = window.__GOODLOG_DEMO__;
  return createDemoStore(fx ? JSON.parse(JSON.stringify(fx)) : undefined);
}
