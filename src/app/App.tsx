import { useMemo } from "react";
import { allTx, budgetAlerts, formatMoney, net, ymd, type Ledger } from "../core";
import { useLedger } from "./useLedger";

/**
 * 暫時的首頁：確認資料層和核心邏輯接得起來。
 * 正式的日曆、記帳畫面等，會在第二階段一頁一頁做（見 CLAUDE.md）。
 * 這個畫面只讀不寫。
 */
export function App() {
  const { store, snap, error } = useLedger();
  const ym = ymd(new Date()).slice(0, 7);
  const ledger: Ledger | null = snap.settings ? { settings: snap.settings, months: snap.months } : null;
  const stats = useMemo(() => {
    if (!ledger) return null;
    const month = allTx(ledger).filter((t) => t.date.startsWith(ym));
    const exp = month.filter((t) => t.type === "expense").reduce((a, t) => a + net(t), 0);
    const inc = month.filter((t) => t.type === "income").reduce((a, t) => a + net(t), 0);
    return { n: month.length, exp, inc, alerts: budgetAlerts(ledger, ym) };
  }, [ledger, ym]);

  return (
    <main className="app">
      <h1>好記</h1>
      <p className="muted">React 版建置中。{store?.mode === "demo" ? "目前顯示的是範例資料，不是你的帳本，變更也不會保存。" : null}</p>
      {error ? <p className="err">{error}</p> : null}
      {!stats ? (
        <p>正在讀取帳本…</p>
      ) : (
        <section className="card">
          <h2>{ym.replace("-", " 年 ")} 月</h2>
          <dl>
            <dt>記錄</dt>
            <dd>{stats.n} 筆</dd>
            <dt>支出</dt>
            <dd>{formatMoney(stats.exp)}</dd>
            <dt>收入</dt>
            <dd>{formatMoney(stats.inc)}</dd>
            <dt>預算提醒</dt>
            <dd>{stats.alerts.length ? stats.alerts.map((b) => `${b.name} ${Math.round(b.pct * 100)}%`).join("、") : "沒有"}</dd>
          </dl>
        </section>
      )}
    </main>
  );
}
