/** 帳戶頁、專案頁共用的元件 */
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { Budget, Settings, Tx } from "../../core/types";
import { pd, ymd } from "../../core/dates";
import { findCategory } from "../../core/ledger";
import { formatMoney, net } from "../../core/money";
import { BUDGET_WARN, type BudgetStatus } from "../../core/budget";
import { nOcc, normRule, occAt } from "../../core/recurrence";
import { schedText } from "../../core/recurrenceText";
import { useApp } from "../state";
import { useNav } from "../nav";
import { Ic, Seal, UiIcon } from "../ui/Icon";
import { TxRow } from "../ui/TxRow";

/** 帳戶頁和專案頁的頁首：切換月份，右邊是新增按鈕 */
export function MonthHead({ title, onAdd, addLabel }: { title: string; onAdd: () => void; addLabel: string }) {
  const { nav, go } = useNav();
  const [Y, M] = nav.payYm.split("-").map(Number);
  const mon = (k: number) => {
    const d = pd(nav.payYm + "-01");
    d.setMonth(d.getMonth() + k);
    go({ payYm: ymd(d).slice(0, 7) });
  };
  return (
    <div className="top">
      <button className="iconbtn" aria-label="上個月" onClick={() => mon(-1)}>
        <UiIcon name="left" />
      </button>
      <h1 className="num" style={{ textAlign: "center" }}>
        {Y} 年 {M} 月<small>{title}</small>
      </h1>
      <button className="iconbtn" aria-label="下個月" onClick={() => mon(1)}>
        <UiIcon name="right" />
      </button>
      <button className="iconbtn" aria-label={addLabel} title={addLabel} onClick={onAdd}>
        <UiIcon name="plus" />
      </button>
    </div>
  );
}

/** 清單列裡的小預算進度條 */
export function BMini({ b }: { b?: BudgetStatus | null }) {
  if (!b) return null;
  const over = b.pct >= 1;
  const warn = b.pct >= BUDGET_WARN;
  const col = over ? "var(--exp)" : warn ? "var(--warn,#d97706)" : "var(--inc)";
  return (
    <span className="bmini" style={{ "--bc": col } as CSSProperties}>
      <span className="bbar">
        <i style={{ width: Math.min(100, b.pct * 100).toFixed(1) + "%" }} />
      </span>
      <small className="num">
        {b.per === "total" ? "總" : ""}預算 {formatMoney(b.budget)} · {over ? "超支 " + formatMoney(b.spent - b.budget) : "剩 " + formatMoney(b.budget - b.spent)}
      </small>
    </span>
  );
}

export interface EntRowProps {
  name: string;
  icon: string;
  v: number;
  n: number;
  b?: BudgetStatus | null;
  extra?: string;
  onClick: () => void;
}

/** 帳戶或專案清單的一列 */
export function EntRow({ name, icon, v, n, b, extra, onClick }: EntRowProps) {
  return (
    <button className="erow" onClick={onClick}>
      <Seal c={{ name, icon, color: "#8A8F8B" }} />
      <span className="enm">
        <span>
          {name}
          <small>
            {n} 筆{extra ? " · " + extra : ""}
          </small>
        </span>
        <BMini b={b} />
      </span>
      <b className="num">{formatMoney(v)}</b>
      <Ic name="chevron-right" />
    </button>
  );
}

/** 點進某個帳戶或專案後的明細卡片 */
export function SelList({ s, title, list, onBack, backLabel, b, totLbl, sum, extra }: { s: Settings; title: string; list: Tx[]; onBack: () => void; backLabel: string; b?: BudgetStatus | null; totLbl?: string; sum?: ReactNode; extra?: ReactNode }) {
  const tot = list.reduce((a, t) => a + (t.type === "topup" ? +t.amount || 0 : net(t)), 0);
  const sorted = list.slice().sort((a, c) => (c.date + (c.time || "")).localeCompare(a.date + (a.time || "")));
  return (
    <div className="card rcard">
      <div className="rdrill">
        <button className="chip-back" onClick={onBack}>
          <UiIcon name="left" />
          <span>{backLabel}</span>
        </button>
        <b>{title}</b>
        {extra}
      </div>
      {sum || (
        <div className="rsum">
          <div>
            <span>{totLbl || "合計"}</span>
            <b className="num" style={{ color: "var(--exp)" }}>
              {formatMoney(tot)}
            </b>
          </div>
          <div>
            <span>筆數</span>
            <b className="num">{list.length}</b>
          </div>
          <div>
            <span>平均</span>
            <b className="num">{list.length ? formatMoney(Math.round(tot / list.length)) : "—"}</b>
          </div>
        </div>
      )}
      {b ? (
        <div style={{ margin: "2px 0 6px" }}>
          <BMini b={b} />
        </div>
      ) : null}
      {sorted.length ? (
        <div className="list">
          {sorted.map((t) => (
            <TxRow key={t.id} t={t} s={s} showDate />
          ))}
        </div>
      ) : (
        <div className="empty" style={{ border: 0, padding: 16 }}>
          這個月沒有記錄
        </div>
      )}
    </div>
  );
}

/** 卡片右上角的設定按鈕 */
export function GearBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button className="iconbtn sm" aria-label={label} title={label} style={{ marginLeft: "auto" }} onClick={onClick}>
      <Ic name="settings-2" />
    </button>
  );
}

/** 設定頁的一列 */
export function OptRow({ label, forId, children }: { label: ReactNode; forId?: string; children: ReactNode }) {
  return (
    <div className="optrow">
      {forId ? <label htmlFor={forId}>{label}</label> : <label>{label}</label>}
      {children}
    </div>
  );
}

/** 開關列 */
export function SwitchRow({ label, hint, on, onToggle }: { label: string; hint?: string; on: boolean; onToggle: () => void }) {
  return (
    <div className="optrow">
      <span>
        {label}
        {hint ? <small style={{ display: "block", color: "var(--muted-foreground)", fontSize: 12, fontWeight: 400 }}>{hint}</small> : null}
      </span>
      <button type="button" className={"switch" + (on ? " on" : "")} role="switch" aria-checked={on} aria-label={label} onClick={onToggle}>
        <i />
      </button>
    </div>
  );
}

/** 離開欄位才存的文字輸入；清空時恢復原值 */
export function LazyInput({ value, onCommit, id, className, style, inputMode, placeholder, allowEmpty, ariaLabel }: { value: string; onCommit: (v: string) => void; id?: string; className?: string; style?: CSSProperties; inputMode?: "numeric" | "decimal"; placeholder?: string; allowEmpty?: boolean; ariaLabel?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      id={id}
      className={className}
      style={style}
      inputMode={inputMode}
      placeholder={placeholder}
      aria-label={ariaLabel}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const t = v.trim();
        if (!t && !allowEmpty) return setV(value);
        if (t !== value) onCommit(t);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

/** 預算設定列：金額與每月／總計 */
export function BudgetRow({ b, name, onChange }: { b?: Budget; name: string; onChange: (b: Budget) => void }) {
  return (
    <OptRow label="預算">
      <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <LazyInput
          className="numin num"
          style={{ width: 110 }}
          inputMode="numeric"
          placeholder="未設定"
          allowEmpty
          ariaLabel={name + "的預算金額"}
          value={b && +(b.budget ?? 0) > 0 ? String(b.budget) : ""}
          onCommit={(raw) => {
            const v = Math.max(0, Math.round(parseFloat(raw.replace(/[,\s$]/g, "")) || 0));
            const nb: Budget = { ...(b || {}) };
            if (v) nb.budget = v;
            else delete nb.budget;
            onChange(nb);
          }}
        />
        <select className="numin" style={{ width: "auto" }} aria-label="預算期間" value={b && b.bper === "total" ? "total" : "month"} onChange={(e) => onChange({ ...(b || {}), bper: e.target.value as "month" })}>
          <option value="month">每月</option>
          <option value="total">總計</option>
        </select>
      </span>
    </OptRow>
  );
}

/** 週期與分期排程清單 */
export function RecursCard() {
  const { ledger, setSettings, toast } = useApp();
  const { nav, arm } = useNav();
  if (!ledger) return null;
  const s = ledger.settings;
  const recurs = s.recurs || [];
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="lbl-s">週期與分期排程</div>
      {recurs.length ? (
        <div className="rows">
          {recurs.map((r0) => {
            const r = normRule(r0);
            const c = findCategory(s, r.tpl.catId);
            const N = nOcc(r);
            const nx = (r.done || 0) < N ? occAt(r, r.done || 0) : null;
            const amt = r.kind === "inst" && r.plan ? r.plan[(r.startIdx || 1) - 1 + (r.done || 0)] : null;
            const k = "recurs:" + r.id;
            const nm = r.tpl.name || "";
            return (
              <div className="setrow" style={{ justifyContent: "space-between" }} key={r.id}>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "block", fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {r.tpl.name || (c ? c.name : "未分類")}{" "}
                    <b className="num" style={{ fontWeight: 600 }}>
                      {r.tpl.type === "income" ? "+" : "−"}
                      {formatMoney(amt ? amt.amount + amt.fee - amt.discount : r.kind === "inst" ? r.total || 0 : net(r.tpl as Tx))}
                    </b>
                  </span>
                  <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>
                    {schedText({ ...r, instN: r.count })} · 已記 {r.done || 0} 筆{nx ? " · 下次 " + +nx.slice(5, 7) + "/" + +nx.slice(8, 10) : " · 已結束"}
                  </span>
                </span>
                <button
                  className={"del ib-del" + (nav.armed === k ? " arm" : "")}
                  data-armable
                  aria-label={(nav.armed === k ? "再按一次確定刪除" : "刪除") + (nm ? "「" + nm + "」" : "")}
                  title={nav.armed === k ? "再按一次確定刪除" : "刪除"}
                  onClick={() => {
                    if (!arm(k)) return;
                    setSettings((st) => ({ ...st, recurs: (st.recurs || []).filter((x) => x.id !== r.id) }));
                    toast("已刪除");
                  }}
                >
                  <Ic name="trash-2" />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>記帳時在「週期」選延後入帳或提醒入帳的排程，會出現在這裡。刪除只會停止之後的入帳，已記的保留。</p>
      )}
    </div>
  );
}
