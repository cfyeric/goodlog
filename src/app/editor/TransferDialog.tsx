/** 記一筆／編輯轉到儲蓄帳戶的轉帳（不算支出、收入） */
import { useState } from "react";
import type { Tx } from "../../core/types";
import { uid8 } from "../../core/ids";
import { useApp } from "../state";
import { useOverlay, type TransferRequest } from "./context";
import { Ic } from "../ui/Icon";

/** 存款固定轉到這個帳戶 */
export const SAVE_ACC = "國泰存錢帳戶";

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
  // 轉入帳戶固定；編輯舊記錄時保留它原本的帳戶（例如從 MOZE 匯入的名稱）
  const to = t0?.toAcc || R.toAcc || SAVE_ACC;
  const [note, setNote] = useState(t0?.note || t0?.name || "");
  const [err, setErr] = useState("");
  const [armed, setArmed] = useState(false);
  if (!ledger) return null;
  const close = () => openXfer(null);
  const ok = () => {
    if (!canWrite()) return;
    const a = Math.round((parseFloat(amt) || 0) * 100) / 100;
    if (!(a > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return setErr("請填金額和日期。");
    const months: Record<string, Tx[]> = {};
    if (t0) months[t0.date.slice(0, 7)] = (ledger.months[t0.date.slice(0, 7)]?.items || []).filter((x) => x.id !== t0.id);
    const t: Tx = { ...(t0 || {}), id: t0?.id || "x" + uid8(), type: "transfer", amount: a, date, toAcc: to };
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
          存到「{to}」。轉帳只是把錢換個地方放，不算支出，也不算進預算。
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <div className="namefield">
            <label htmlFor="xf-amt">金額</label>
            <input id="xf-amt" className="num" inputMode="decimal" placeholder="0" value={amt} onChange={(e) => setAmt(e.target.value)} />
          </div>
          <div className="namefield">
            <label htmlFor="xf-date">日期</label>
            <input id="xf-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="namefield">
          <label htmlFor="xf-note">備註</label>
          <input id="xf-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {err ? (
          <div className="err" role="alert">
            {err}
          </div>
        ) : null}
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
