/** 名稱、商家欄位下方的常用選項（兩個欄位互相連動） */
import { useEffect, useRef } from "react";
import type { Ledger, Tx } from "../../core/types";
import { fieldSuggest } from "../../core/editor";

export function SuggestBar({ ledger, t, field, onPick }: { ledger: Ledger; t: Tx; field: "name" | "merchant" | null; onPick: (f: "name" | "merchant", v: string) => void }) {
  const row = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const R = field ? fieldSuggest(ledger, t, field, (field === "name" ? t.name : t.merchant) || "", { name: t.name || "", merchant: t.merchant || "" }) : null;
  const has = !!R && R.list.length > 0;
  useEffect(() => {
    if (row.current) row.current.scrollLeft = 0;
  }, [field, R?.ov]);
  useEffect(() => {
    if (!has) return;
    const id = setTimeout(() => {
      const b = bar.current;
      if (!b) return;
      const r = b.getBoundingClientRect();
      const vv = window.visualViewport;
      const vh = vv ? vv.height + vv.offsetTop : window.innerHeight;
      if (r.bottom > vh - 8) b.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 350);
    return () => clearTimeout(id);
  }, [field, has]);
  if (!field || !R || !R.list.length) return <div className="field full sugbar" id="sugbar" hidden role="listbox" aria-label="常用選項" />;
  const hd = R.nLink ? (field === "name" ? `在「${R.ov}」買過` : `「${R.ov}」在這些店家買過`) : field === "name" ? "常用名稱" : "常用商家";
  return (
    <div className="field full sugbar" id="sugbar" role="listbox" aria-label="常用選項" ref={bar}>
      <span className="sughd">{hd}</span>
      <div className="sugrow" ref={row}>
        {R.list.map((v, i) => (
          <span key={v} style={{ display: "contents" }}>
            {R.nLink && i === R.nLink ? <span className="sugsep" aria-hidden="true" /> : null}
            <button type="button" className={"sugchip" + (i < R.nLink ? " link" : "")} role="option" aria-selected="false" onPointerDown={(e) => e.preventDefault()} onClick={() => onPick(field, v)}>
              <span>{v}</span>
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
