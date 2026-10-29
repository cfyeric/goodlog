/** 搜尋記錄：一次顯示 20 筆，快滑到底時再接著顯示 20 筆 */
import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { searchTx } from "../../core/search";
import { formatMoney, net } from "../../core/money";
import { useApp } from "../state";
import { useOverlay } from "../editor/context";
import { TxRow } from "../ui/TxRow";
import { Ic, UiIcon } from "../ui/Icon";

export const PAGE = 20;
/** 關掉再打開時保留上次的關鍵字 */
let lastQuery = "";

export function SearchHost() {
  const { searchOpen } = useOverlay();
  return searchOpen ? <SearchSheet /> : null;
}

function SearchSheet() {
  const { ledger } = useApp();
  const { setSearchOpen } = useOverlay();
  const [q, setQ] = useState(lastQuery);
  const dq = useDeferredValue(q);
  const [shown, setShown] = useState(PAGE);
  const body = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setTimeout(() => input.current?.focus(), 50);
    const k = (e: KeyboardEvent) => {
      // 記帳畫面或其他對話框開著時，Esc 交給它們處理（先於它們檢查，所以用捕獲階段）
      if (e.key === "Escape" && !document.getElementById("sheetRoot") && !document.querySelector(".dlg-ov")) setSearchOpen(false);
    };
    document.addEventListener("keydown", k, true);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", k, true);
    };
  }, [setSearchOpen]);

  useEffect(() => {
    lastQuery = q;
  }, [q]);

  const res = useMemo(() => (ledger ? searchTx(ledger, dq) : []), [ledger, dq]);
  // 換關鍵字時回到前 20 筆、捲回頂端
  useEffect(() => {
    setShown(PAGE);
    body.current?.scrollTo({ top: 0 });
  }, [dq]);

  // 底部的觀察點進入畫面前一段距離，就多顯示 20 筆
  useEffect(() => {
    const el = more.current;
    if (!el || !body.current) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setShown((n) => n + PAGE), { root: body.current, rootMargin: "0px 0px 600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [res, shown]);

  if (!ledger) return null;
  const s = ledger.settings;
  const exp = res.filter((t) => t.type === "expense").reduce((a, t) => a + net(t), 0);
  const inc = res.filter((t) => t.type === "income").reduce((a, t) => a + net(t), 0);
  const list = res.slice(0, shown);
  // 依月份分段，跨年也看得出是哪一年
  const groups: { ym: string; items: typeof list }[] = [];
  list.forEach((t) => {
    const ym = t.date.slice(0, 7);
    const g = groups[groups.length - 1];
    if (g && g.ym === ym) g.items.push(t);
    else groups.push({ ym, items: [t] });
  });

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="搜尋記錄">
      <div className="in">
        <div className="shead">
          <button className="iconbtn" aria-label="關閉" onClick={() => setSearchOpen(false)}>
            <UiIcon name="x" />
          </button>
          <h2>搜尋記錄</h2>
          <span style={{ width: 36 }} />
        </div>
        <div className="sbody" ref={body}>
          <div className="pksearch" style={{ marginBottom: 10 }}>
            <Ic name="search" />
            <input
              ref={input}
              type="search"
              enterKeyHint="search"
              placeholder="名稱、商家、類別、標籤、備註或金額"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              aria-label="搜尋關鍵字"
            />
          </div>
          {!dq.trim() ? (
            <p className="pkhint">
              可以輸入多個關鍵字，用空白分開，例如「午餐 7-11」。輸入數字也會找金額相同的記錄。
            </p>
          ) : !res.length ? (
            <div className="empty" style={{ marginTop: 8 }}>
              <b>找不到「{dq.trim()}」</b>換個關鍵字試試看。
            </div>
          ) : (
            <>
              <div className="sechead" style={{ marginTop: 4 }}>
                <h2>找到 {res.length.toLocaleString("zh-TW")} 筆</h2>
                <span>
                  {exp ? "支出 " + formatMoney(exp) : ""}
                  {exp && inc ? " · " : ""}
                  {inc ? "收入 " + formatMoney(inc) : ""}
                </span>
              </div>
              {groups.map((g) => (
                <Fragment key={g.ym}>
                  <div className="lbl-s" style={{ margin: "12px 2px 6px" }}>
                    {+g.ym.slice(0, 4)} 年 {+g.ym.slice(5, 7)} 月
                  </div>
                  <div className="card" style={{ padding: "4px 12px" }}>
                    <div className="list">
                      {g.items.map((t) => (
                        <TxRow key={t.id} t={t} s={s} showDate />
                      ))}
                    </div>
                  </div>
                </Fragment>
              ))}
              {shown < res.length ? (
                <div ref={more} className="pkhint" style={{ textAlign: "center", padding: "16px 0" }}>
                  載入中…
                </div>
              ) : (
                <p className="pkhint" style={{ textAlign: "center", padding: "12px 0" }}>
                  已經是全部 {res.length.toLocaleString("zh-TW")} 筆
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
