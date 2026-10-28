import type { LedgerStore } from "./store";
import { connectClaude, createClaudeStore } from "./claudeStore";
import { createDemoStore } from "./demoStore";

export * from "./store";
export { createDemoStore, demoLedger } from "./demoStore";

/** 在 claude.ai 上就用雲端資料庫，否則（本機開發）用範例資料 */
export async function openStore(): Promise<LedgerStore> {
  const c = await connectClaude();
  return c ? createClaudeStore(c.db, c.uid) : createDemoStore();
}
