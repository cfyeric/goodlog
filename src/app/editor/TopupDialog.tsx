/** 記一筆／編輯悠遊卡加值 */
import { useState } from "react";
import { makeTopup, svParent } from "../../core/ledger";
import { uid8 } from "../../core/ids";
import { useApp } from "../state";
import { useOverlay } from "./context";
import { Ic } from "../ui/Icon";

export function TopupHost() {
  const { topup } = useOverlay();
  if (!topup) return null;
  return <TopupDialog key={topup.id || "new"} />;
}

function TopupDialog() {
  const { ledger, canWrite, commit, toast } = useApp();
  const { topup: T, openTopup } = useOverlay();
  const [amt, setAmt] = useState(T!.amount);
  const [date, setDate] = useState(T!.date);
  const [note, setNote] = useState(T!.note || "");
  const [card, setCard] = useState(T!.cardId);
  const [err, setErr] = useState("");
  const [armed, setArmed] = useState(false);
  if (!T || !ledger) return null;
  const s = ledger.settings;
  const svs = (s.cards || []).filter((c) => c.svOf && (!c.archived || c.id === T.cardId));
  const close = () => openTopup(null);
  const ok = () => {
    if (!canWrite()) return;
    const a = Math.round((parseFloat(amt) || 0) * 100) / 100;
    const cid = svs.length ? card || svs[0].id : "";
    if (!(a > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !cid) return setErr("請填金額、日期和儲值卡。");
    const months: Record<string, typeof ledger.months[string]["items"]> = {};
    if (T.id && T.m) months[T.m] = (ledger.months[T.m]?.items || []).filter((x) => x.id !== T.id);
    const t = makeTopup({ id: T.id, cardId: cid, amount: a, date, note: note.trim() }, uid8());
    const k = date.slice(0, 7);
    months[k] = (months[k] || ledger.months[k]?.items || []).filter((x) => x.id !== t.id).concat([t]);
    commit({ months });
    close();
    toast(T.id ? "已更新加值" : "已記下加值");
  };
  const del = () => {
    if (!T.id || !T.m) return;
    if (!armed) return setArmed(true);
    commit({ months: { [T.m]: (ledger.months[T.m]?.items || []).filter((x) => x.id !== T.id) } });
    close();
    toast("已刪除加值");
  };
  return (
    <div className="dlg-ov" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="dlg enter" role="dialog" aria-modal="true" aria-labelledby="tp-t">
        <h3 id="tp-t">{T.id ? "編輯加值" : "記一筆加值"}</h3>
        <p className="pkhint" style={{ margin: 0 }}>
          加值會算進信用卡的刷卡金額和帳單比對，但不算支出；之後用儲值付的消費才算支出。
        </p>
        {svs.length ? (
          <div className="namefield">
            <label htmlFor="tp-card">儲值卡</label>
            <select id="tp-card" value={card || svs[0].id} onChange={(e) => setCard(e.target.value)}>
              {svs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}（從 {svParent(s, c)?.name || ""} 加值）
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p>還沒有儲值卡。請到帳戶頁點進信用卡，在帳戶設定開啟「悠遊聯名卡」。</p>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <div className="namefield">
            <label htmlFor="tp-amt">金額</label>
            <input id="tp-amt" className="num" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} />
          </div>
          <div className="namefield">
            <label htmlFor="tp-date">日期</label>
            <input id="tp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="namefield">
          <label htmlFor="tp-note">備註</label>
          <input id="tp-note" value={note} placeholder="例如：自動加值" onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="err" role="alert">
          {err}
        </div>
        <div className="acts">
          {T.id ? (
            <button className="btn destructive" style={{ marginRight: "auto" }} onClick={del} aria-label="刪除加值">
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
