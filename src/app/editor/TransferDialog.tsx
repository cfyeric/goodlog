/** 記一筆／編輯轉到儲蓄帳戶的轉帳（不算支出、收入） */
import { useState } from "react";
import type { Tx } from "../../core/types";
import { uid8 } from "../../core/ids";
import { useApp } from "../state";
import { useOverlay, type TransferRequest } from "./context";
import { Ic } from "../ui/Icon";

/** 帳本裡出現過的儲蓄帳戶名稱（轉入的帳戶） */
export function savingAccounts(months: Record<string, { items: Tx[] }>): string[] {
  const n: Record<string, number> = {};
  for (const k in months) for (const t of months[k].items || []) if (t.type === "transfer" && t.toAcc) n[t.toAcc] = (n[t.toAcc] || 0) + 1;
  return Object.keys(n).sort((a, b) => n[b] - n[a]);
}

export function TransferHost() {
  const { xfer } = useOverlay();
  if (!xfer) return null;
  return <TransferDialog key={xfer.tx?.id || "new"} R={xfer} />;
}

function TransferDialog({ R }: { R: TransferRequest }) {
  const { ledger, canWrite, commit, toast } = useApp();
  const { openXfer } = useOverlay();
  const t0 = R.tx;
  const [amt, setAmt] = useState(t0 ? String(t0.amount) : "");
  const [date, setDate] = useState(t0 ? t0.date : R.date || "");
  const [to, setTo] = useState(t0?.toAcc || R.toAcc || "");
  const [from, setFrom] = useState(t0?.fromAcc || "");
  const [note, setNote] = useState(t0?.note || t0?.name || "");
  const [err, setErr] = useState("");
  const [armed, setArmed] = useState(false);
  if (!ledger) return null;
  const accs = savingAccounts(ledger.months);
  const close = () => openXfer(null);
  const ok = () => {
    if (!canWrite()) return;
    const a = Math.round((parseFloat(amt) || 0) * 100) / 100;
    if (!(a > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !to.trim()) return setErr("請填金額、日期和轉入的帳戶。");
    const months: Record<string, Tx[]> = {};
    if (t0) months[t0.date.slice(0, 7)] = (ledger.months[t0.date.slice(0, 7)]?.items || []).filter((x) => x.id !== t0.id);
    const t: Tx = { ...(t0 || {}), id: t0?.id || "x" + uid8(), type: "transfer", amount: a, date, toAcc: to.trim() };
    if (from.trim()) t.fromAcc = from.trim();
    else delete t.fromAcc;
    if (note.trim()) t.note = note.trim();
    else delete t.note;
    if (t0?.name && note.trim() !== t0.name) delete t.name;
    const k = date.slice(0, 7);
    months[k] = (months[k] || ledger.months[k]?.items || []).filter((x) => x.id !== t.id).concat([t]);
    commit({ months });
    close();
    toast(t0 ? "已更新轉帳" : "已記下轉帳");
  };
  const del = () => {
    if (!t0 || !canWrite()) return;
    if (!armed) return setArmed(true);
    const k = t0.date.slice(0, 7);
    commit({ months: { [k]: (ledger.months[k]?.items || []).filter((x) => x.id !== t0.id) } });
    close();
    toast("已刪除轉帳");
  };
  return (
    <div className="dlg-ov" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="dlg enter" role="dialog" aria-modal="true" aria-labelledby="xf-t">
        <h3 id="xf-t">{t0 ? "轉到儲蓄帳戶" : "記一筆存款"}</h3>
        <p className="pkhint" style={{ margin: 0 }}>
          轉帳只是把錢換個地方放，不算支出，也不算進預算和報表。
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <div className="namefield">
            <label htmlFor="xf-amt">金額</label>
            <input id="xf-amt" className="num" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} />
          </div>
          <div className="namefield">
            <label htmlFor="xf-date">日期</label>
            <input id="xf-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div className="namefield">
            <label htmlFor="xf-from">從</label>
            <input id="xf-from" value={from} placeholder="例如：薪轉帳戶" onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="namefield">
            <label htmlFor="xf-to">轉到</label>
            <input id="xf-to" list="xf-accs" value={to} placeholder="儲蓄帳戶" onChange={(e) => setTo(e.target.value)} />
            <datalist id="xf-accs">
              {accs.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </div>
        </div>
        <div className="namefield">
          <label htmlFor="xf-note">備註</label>
          <input id="xf-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="err" role="alert">
          {err}
        </div>
        <div className="acts">
          {t0 ? (
            <button className="btn destructive" style={{ marginRight: "auto" }} onClick={del} aria-label="刪除轉帳">
              {armed ? "再按一次刪除" : <Ic name="trash-2" />}
            </button>
          ) : null}
          <button className="btn" onClick={close}>
            取消
          </button>
          <button className="btn primary" onClick={ok}>
            儲存
          </button>
        </div>
      </div>
    </div>
  );
}
