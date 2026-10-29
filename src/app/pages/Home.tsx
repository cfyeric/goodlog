import type { CSSProperties } from "react";
import type { Ledger } from "../../core/types";
import { pd, ymd } from "../../core/dates";
import { findCategory, pendingList, transfersOfDay, transfersOfMonth, txOfDay } from "../../core/ledger";
import { formatMoney, net } from "../../core/money";
import { budgetAlerts, type BudgetStatus } from "../../core/budget";
import { useApp } from "../state";
import { useNav } from "../nav";
import { useOverlay } from "../editor/context";
import { Ic, Seal, UiIcon } from "../ui/Icon";
import { MonthSwiper } from "./MonthSwiper";
import { TxRow } from "../ui/TxRow";

const WD = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];

export function Home({ ledger }: { ledger: Ledger }) {
  const { today } = useApp();
  const { nav, go } = useNav();
  const { setSearchOpen } = useOverlay();
  const s = ledger.settings;
  const [Y, M] = nav.ym.split("-").map(Number);
  const pick = (ds: string) => go({ sel: ds, ym: ds.slice(0, 7) });
  const mItems = (ledger.months[nav.ym]?.items || []).filter((t) => !t.pending && t.type !== "transfer");
  const mExp = mItems.filter((t) => t.type === "expense").reduce((a, t) => a + net(t), 0);
  const mInc = mItems.filter((t) => t.type === "income").reduce((a, t) => a + net(t), 0);
  // 轉到儲蓄帳戶：另外一條，不算支出
  const mSaves = transfersOfMonth(ledger, nav.ym);
  const mSave = mSaves.reduce((a, t) => a + (+t.amount || 0), 0);
  const hasSave = mSave > 0 || Object.values(ledger.months).some((m) => m.items.some((t) => t.type === "transfer"));
  const spent = txOfDay(ledger, nav.sel);
  // 轉到儲蓄帳戶的轉帳也列在當天明細（不算支出）
  const list = spent.concat(transfersOfDay(ledger, nav.sel)).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  const sd = pd(nav.sel);
  const dExp = spent.filter((t) => t.type === "expense").reduce((a, t) => a + net(t), 0);
  const mon = (k: number) => {
    const ym = addYm(nav.ym, k);
    go({ ym, sel: ym === today.slice(0, 7) ? today : ym + "-01" });
  };

  return (
    <>
      <div className="top">
        <h1 className="num">
          {Y} 年 {M} 月<small>{mItems.length} 筆記錄</small>
        </h1>
        <button className="iconbtn" aria-label="搜尋記錄" title="搜尋記錄" onClick={() => setSearchOpen(true)}>
          <Ic name="search" />
        </button>
        <button className="iconbtn" aria-label="回到今天" title="回到今天" onClick={() => go({ sel: today, ym: today.slice(0, 7) })}>
          <UiIcon name="today" />
        </button>
      </div>
      <div className="cal">
        <div className="wk">
          {["一", "二", "三", "四", "五", "六", "日"].map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
        <MonthSwiper ym={nav.ym} onMonth={mon} render={(ym) => <MonthGrid ledger={ledger} ym={ym} sel={nav.sel} today={today} onPick={pick} />} />
      </div>
      <MonthBars exp={mExp} expN={mItems.filter((t) => t.type === "expense").length} inc={mInc} incN={mItems.filter((t) => t.type === "income").length} save={mSave} saveN={mSaves.length} showSave={hasSave} />
      <BudgetStrip ledger={ledger} ym={nav.ym} />
      <PendingCard ledger={ledger} />
      <div className="sechead">
        <h2 className="num">
          {sd.getMonth() + 1}/{sd.getDate()} {WD[sd.getDay()]}
        </h2>
        <span>{spent.length ? "支出 " + formatMoney(dExp) : ""}</span>
      </div>
      {list.length ? (
        <div className="card" style={{ padding: "4px 12px" }}>
          <div className="list">
            {list.map((t) => (
              <TxRow key={t.id} t={t} s={s} />
            ))}
          </div>
        </div>
      ) : (
        <div className="empty">
          <b>這天還沒有記錄</b>點下方的 ＋ 記一筆，會記在這一天。
        </div>
      )}
    </>
  );
}

/** 本月支出、收入、儲蓄的長條，和結餘（收入 − 支出，儲蓄不算支出） */
function MonthBars({ exp, expN, inc, incN, save, saveN, showSave }: { exp: number; expN: number; inc: number; incN: number; save: number; saveN: number; showSave: boolean }) {
  const mx = Math.max(exp, inc, showSave ? save : 0, 1);
  const bal = inc - exp;
  const bar = (l: string, v: number, c: string, n: number) => (
    <div className="bar">
      <span>{l}</span>
      <span className="track">
        <span className="fill" style={{ display: "block", width: Math.max((v / mx) * 100, v ? 2 : 0) + "%", background: c }} />
      </span>
      <b className="num" style={{ color: c }}>
        {formatMoney(v)} <span style={{ color: "var(--muted)", fontWeight: 500, fontSize: 12 }}>· {n}筆</span>
      </b>
    </div>
  );
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="bars">
        {bar("支出", exp, "var(--exp)", expN)}
        {bar("收入", inc, "var(--inc)", incN)}
        {showSave ? bar("儲蓄", save, "var(--xfer)", saveN) : null}
      </div>
      <div className="row" style={{ marginTop: 8, borderTop: "1px solid var(--line)", borderBottom: 0, paddingBottom: 0 }}>
        <b>結餘</b>
        <b className="num" style={{ color: bal < 0 ? "var(--exp)" : "var(--inc)" }}>
          {bal < 0 ? "−" : "+"}
          {formatMoney(bal)}
        </b>
      </div>
    </div>
  );
}

/** 加減月份：「2026-10」加 1 是「2026-11」 */
function addYm(ym: string, k: number): string {
  const d = pd(ym + "-01");
  d.setMonth(d.getMonth() + k);
  return ymd(d).slice(0, 7);
}

/** 一個月的日期格子（含前後月份補滿的日子） */
function MonthGrid({ ledger, ym, sel, today, onPick }: { ledger: Ledger; ym: string; sel: string; today: string; onPick: (ds: string) => void }) {
  const [Y, M] = ym.split("-").map(Number);
  const first = new Date(Y, M - 1, 1);
  const off = (first.getDay() + 6) % 7;
  const start = new Date(Y, M - 1, 1 - off);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const ds = ymd(d);
    if (i === 35 && d.getMonth() !== M - 1) break;
    const list = txOfDay(ledger, ds);
    const e = list.some((t) => t.type === "expense");
    const n = list.some((t) => t.type === "income");
    const cls = ["day"];
    if (d.getMonth() !== M - 1) cls.push("out");
    if (d.getDay() % 6 === 0) cls.push("we");
    if (ds === today) cls.push("today");
    if (ds === sel) cls.push("sel");
    cells.push(
      <button key={ds} className={cls.join(" ")} aria-label={`${d.getMonth() + 1}月${d.getDate()}日${list.length ? "，" + list.length + "筆" : ""}`} onClick={() => onPick(ds)}>
        <span className="d">{d.getDate()}</span>
        <span className="dots">
          {e ? <i className="e" /> : null}
          {n ? <i className="n" /> : null}
        </span>
      </button>,
    );
  }
  return <div className="grid">{cells}</div>;
}

/** 花到 80% 以上的預算，可以左右滑動 */
function BudgetStrip({ ledger, ym }: { ledger: Ledger; ym: string }) {
  const { today } = useApp();
  const { go, view } = useNav();
  const all = budgetAlerts(ledger, ym);
  if (!all.length) return null;
  const cur = today.slice(0, 7) === ym;
  const [Y, M] = ym.split("-").map(Number);
  const daysLeft = cur ? new Date(Y, M, 0).getDate() - +today.slice(8, 10) + 1 : 0;
  const open = (b: BudgetStatus) => {
    if (b.kind === "pay") {
      view("acc");
      go({ payYm: ym, accSel: "cardall" });
      return;
    }
    view("report");
    go({ rTab: b.kind, rMode: "month", rAnchor: ym + "-01", rType: "expense", rDrill: null, rSub: null, rKey: b.key });
  };
  const card = (b: BudgetStatus) => {
    const over = b.pct >= 1;
    const left = Math.round((b.budget - b.spent) * 100) / 100;
    const col = over ? "var(--exp)" : "var(--warn,#d97706)";
    const hint = over
      ? `已超支 ${formatMoney(-left)}`
      : `還剩 ${formatMoney(left)}` + (b.per === "month" && cur && daysLeft > 0 ? `，${daysLeft} 天內每天約 ${formatMoney(Math.floor(left / daysLeft))}` : "");
    const clickable = b.per === "month";
    const label = `${b.name}${b.per === "month" ? M + " 月" : "總"}預算 ${formatMoney(b.budget)}，已花 ${formatMoney(b.spent)}，${hint}`;
    const inner = (
      <>
        <div className="bhd">
          <Seal c={{ name: b.name, icon: b.kind === "proj" ? "briefcase" : b.key === "cash" ? "banknote" : "credit-card", color: "#8A8F8B" }} sm />
          <span className="bnm">
            {b.name}
            <small>{b.per === "month" ? M + " 月預算" : "總預算"}</small>
          </span>
          <b className="bpc num">{Math.round(b.pct * 100)}%</b>
        </div>
        <div className="bbar">
          <i style={{ width: Math.min(100, b.pct * 100).toFixed(1) + "%" }} />
        </div>
        <div className="bft num">
          <span>
            {formatMoney(b.spent)} / {formatMoney(b.budget)}
          </span>
          <span className="bhint">{hint}</span>
        </div>
      </>
    );
    const style = { "--bc": col } as CSSProperties;
    return clickable ? (
      <button key={b.key} className={"bcard" + (over ? " over" : "")} style={style} aria-label={label} onClick={() => open(b)}>
        {inner}
      </button>
    ) : (
      <div key={b.key} className={"bcard" + (over ? " over" : "")} style={style} aria-label={label}>
        {inner}
      </div>
    );
  };
  return (
    <>
      <div className="sechead" style={{ marginTop: 14 }}>
        <h2>預算提醒</h2>
        <span>{all.length > 1 ? all.length + " 筆，左右滑動" : ""}</span>
      </div>
      <div className={"bstrip" + (all.length === 1 ? " one" : "")}>{all.map(card)}</div>
    </>
  );
}

/** 待入帳：提醒入帳的記錄到期後列在這裡，確認後才算 */
function PendingCard({ ledger }: { ledger: Ledger }) {
  const { setMonth, canWrite, toast } = useApp();
  const { openEditor } = useOverlay();
  const ps = pendingList(ledger);
  if (!ps.length) return null;
  const s = ledger.settings;
  return (
    <div className="card" style={{ marginTop: 12, padding: "12px 14px 4px" }}>
      <div className="lbl-s" style={{ display: "flex", justifyContent: "space-between" }}>
        待入帳{" "}
        <span className="cnt" style={{ fontSize: 12, fontWeight: 500, color: "var(--muted)" }}>
          {ps.length} 筆
        </span>
      </div>
      {ps.map((t) => {
        const c = findCategory(s, t.catId);
        const inc = t.type === "income";
        return (
          <div className="irow" key={t.id}>
            <span className="d">
              {+t.date.slice(5, 7)}/{+t.date.slice(8, 10)}
            </span>
            <span className="m">
              {t.name || (c ? c.name : "未分類")}
              <small>{[t.inst ? "分期 " + t.inst.i + "/" + t.inst.n : "", t.rec ? "週期 #" + t.rec.i : "", c && t.name ? c.name : ""].filter(Boolean).join(" · ")}</small>
            </span>
            <span className="a" style={{ color: inc ? "var(--inc)" : "var(--exp)" }}>
              {(inc ? "+" : "−") + formatMoney(net(t))}
            </span>
            <span className="acts2">
              <button
                className="btn sm"
                onClick={() => {
                  if (!canWrite()) return;
                  setMonth(t.date.slice(0, 7), (its) => its.filter((x) => x.id !== t.id));
                  toast("已略過");
                }}
              >
                略過
              </button>
              <button className="btn sm primary" onClick={() => canWrite() && openEditor({ tx: t, confirmPending: true })}>
                入帳
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}
