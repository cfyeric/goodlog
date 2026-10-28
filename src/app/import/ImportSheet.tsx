/** 信用卡帳單比對：上傳網銀下載的帳單，跟帳本的刷卡記錄配對 */
import { useEffect, useState, type ReactNode } from "react";
import type { Ledger, Tx } from "../../core/types";
import { cardOf, findCard, findCategory, makeTopup } from "../../core/ledger";
import { formatMoney, net } from "../../core/money";
import { uid8 } from "../../core/ids";
import { findAlias, learnAlias } from "../../core/alias";
import {
  buildItems, decodeText, findCloseDate, guessHeader, guessMap, initSecMap, matchStatement, parseCSV,
  type ColumnMap, type MatchRow, type StatementItem,
} from "../../core/statement";
import { useApp } from "../state";
import { useOverlay } from "../editor/context";
import { Ic, UiIcon } from "../ui/Icon";

const XLSX_URL = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";

declare global {
  interface Window {
    XLSX?: {
      read(buf: ArrayBuffer, o: object): { SheetNames: string[]; Sheets: Record<string, unknown> };
      utils: { sheet_to_json(sh: unknown, o: object): unknown[][] };
    };
  }
}

export function loadScript(src: string): Promise<void> {
  return new Promise((ok, no) => {
    const sc = document.createElement("script");
    sc.src = src;
    sc.onload = () => ok();
    sc.onerror = () => no(new Error("load"));
    document.head.appendChild(sc);
  });
}

/** 讀檔成表格列：Excel 用 SheetJS、網頁檔讀 <table>、其餘當 CSV */
async function readRows(file: File): Promise<string[][]> {
  const buf = await file.arrayBuffer();
  if (/\.(xlsx|xls)$/i.test(file.name)) {
    if (!window.XLSX) {
      try {
        await loadScript(XLSX_URL);
      } catch {
        throw new Error("Excel 讀取元件載入失敗，請改用 CSV 檔，或稍後再試。");
      }
    }
    const wb = window.XLSX!.read(buf, { type: "array", cellDates: false, raw: false });
    let rows: string[][] = [];
    wb.SheetNames.forEach((n) => {
      rows = rows.concat(
        window.XLSX!.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: "" })
          .map((r) => (r as unknown[]).map((c) => String(c).trim()))
          .filter((r) => r.some((c) => c)),
      );
    });
    return rows;
  }
  if (/\.html?$/i.test(file.name) || /^\s*<(!doctype|html|table|meta)/i.test(decodeText(buf.slice(0, 400)))) {
    const doc = new DOMParser().parseFromString(decodeText(buf), "text/html");
    const rows: string[][] = [];
    doc.querySelectorAll("tr").forEach((tr) => {
      const r = [...tr.children].filter((c) => /^T[DH]$/.test(c.tagName)).map((c) => (c.textContent || "").replace(/\s+/g, " ").trim());
      if (r.some(Boolean)) rows.push(r);
    });
    if (!rows.length) throw new Error("這個網頁檔裡沒有找到表格。");
    return rows;
  }
  return parseCSV(decodeText(buf));
}

interface Imp {
  cardId: string;
  fileName?: string;
  loading?: boolean;
  err?: string;
  rows?: string[][] | null;
  ref?: string | null;
  headerIdx: number;
  map: ColumnMap;
  items: StatementItem[];
  secs: string[];
  secMap: Record<string, string>;
  pays: number;
  acc: Set<number>;
  rej: Set<number>;
}

export function ImportHost() {
  const { importOpen } = useOverlay();
  const { ledger } = useApp();
  if (!importOpen || !ledger) return null;
  return <ImportSheet ledger={ledger} />;
}

function ImportSheet({ ledger }: { ledger: Ledger }) {
  const { today, mode, setSettings, commit, canWrite, toast } = useApp();
  const { setImportOpen, openEditor } = useOverlay();
  const s = ledger.settings;
  const [I2, setI] = useState<Imp>({ cardId: "", headerIdx: 0, map: { date: -1, desc: -1, amount: -1 }, items: [], secs: [], secMap: {}, pays: 0, acc: new Set(), rej: new Set() });
  const upd = (p: Partial<Imp>) => setI((x) => ({ ...x, ...p }));

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const rebuild = (base: Imp, map: ColumnMap): Imp => {
    const b = buildItems(base.rows || [], base.headerIdx, map, base.ref || null, today);
    return { ...base, map, items: b.items, secs: b.secs, pays: b.pays, secMap: initSecMap(s, b.secs, base.cardId, base.secMap), acc: new Set(), rej: new Set() };
  };
  const saveCsvMap = (x: Imp) => {
    const c = findCard(s, x.cardId);
    if (!c || !x.rows || mode !== "live") return;
    const h = x.rows[x.headerIdx] || [];
    const nm = { date: h[x.map.date] || "", desc: x.map.desc >= 0 ? h[x.map.desc] || "" : "", amount: h[x.map.amount] || "" };
    const old = c.csvMap || { date: "", desc: "", amount: "" };
    if (old.date === nm.date && old.desc === nm.desc && old.amount === nm.amount) return;
    setSettings((st) => ({ ...st, cards: st.cards.map((y) => (y.id === c.id ? { ...y, csvMap: nm } : y)) }));
  };
  const onFile = async (file: File) => {
    upd({ fileName: file.name, err: "", loading: true });
    try {
      const rows = await readRows(file);
      if (!rows.length) throw new Error("檔案裡沒有讀到資料，請確認是從網銀下載的帳單明細。");
      const ref = findCloseDate(rows, today);
      const headerIdx = guessHeader(rows, ref, today);
      const hdr = rows[headerIdx] || [];
      const saved = findCard(s, I2.cardId)?.csvMap;
      const byName = (n: string) => hdr.findIndex((h) => h === n);
      const map = saved && byName(saved.date) >= 0 && byName(saved.amount) >= 0 ? { date: byName(saved.date), desc: byName(saved.desc), amount: byName(saved.amount) } : guessMap(hdr);
      setI((x) => {
        const n = rebuild({ ...x, rows, ref, headerIdx, loading: false, fileName: file.name }, map);
        if (!n.items.length) n.err = "沒有讀到任何明細。請在下方確認「日期」「金額」各是哪一欄。";
        saveCsvMap(n);
        return n;
      });
    } catch (e) {
      upd({ err: (e as Error)?.message || "讀取失敗，請確認檔案格式。", rows: null, loading: false });
    }
  };

  const m = I2.items.length ? matchStatement(ledger, { items: I2.items, cardId: I2.cardId, secMap: I2.secMap, rejected: I2.rej, accepted: I2.acc }) : null;
  const md = (d: string) => +d.slice(5, 7) + "/" + +d.slice(8, 10);
  const headers = (I2.rows?.[I2.headerIdx] || []).map((h, i) => h || "第 " + (i + 1) + " 欄");
  const cards = s.cards || [];

  const addMissing = (r: MatchRow) => {
    const it = r.it;
    const al = findAlias(s, it.desc);
    const t: Partial<Tx> = { date: it.date, merchant: it.desc, pay: "card" };
    if (I2.cardId) t.cardId = I2.cardId;
    if (al) {
      const c = findCategory(s, al.catId);
      if (c && c.type === "expense") t.catId = c.id;
      if (al.name) t.name = al.name;
      if (al.merchant) t.merchant = al.merchant;
    }
    const ex = { amount: String(it.fee ? Math.round((it.amount - it.fee) * 100) / 100 : it.amount), ...(it.fee ? { fee: String(it.fee) } : {}) };
    openEditor({ tx: null, prefill: { t, ex, fromImp: { desc: it.desc } } });
  };
  const markTopup = (r: MatchRow) => {
    if (!canWrite()) return;
    const it = r.it;
    const cid = it.sec && I2.secMap[it.sec] !== undefined ? I2.secMap[it.sec] : I2.cardId;
    const sv = cards.filter((c) => c.svOf && !c.archived && (!cid || c.svOf === cid));
    if (!sv.length) return toast("先在帳戶設定開啟這張卡的悠遊聯名卡");
    const t = makeTopup({ cardId: sv[0].id, amount: it.amount, date: it.date, note: it.desc }, uid8());
    const k = t.date.slice(0, 7);
    commit({ months: { [k]: (ledger.months[k]?.items || []).filter((x) => x.id !== t.id).concat([t]) } });
    toast("已記為加值，不算支出");
  };
  const addFee = (rs: MatchRow[]) => {
    if (!canWrite()) return;
    const months: Record<string, Tx[]> = {};
    let n = 0;
    rs.forEach((r) => {
      const k = r.tx!.date.slice(0, 7);
      const items = months[k] || (ledger.months[k]?.items || []);
      const i = items.findIndex((x) => x.id === r.tx!.id);
      if (i < 0) return;
      const nx = items.slice();
      nx[i] = { ...nx[i], fee: Math.round(((nx[i].fee || 0) + (r.feeMissing || 0)) * 100) / 100 };
      months[k] = nx;
      n++;
    });
    commit({ months });
    if (n) toast(n > 1 ? `已補上 ${n} 筆手續費` : "已補上手續費");
  };

  const row = (r: MatchRow, acts?: ReactNode) => {
    const al = !r.tx ? findAlias(s, r.it.desc) : null;
    return (
      <div className="irow" key={r.i}>
        <span className="d">{md(r.it.date)}</span>
        <span className="m">
          {r.it.desc || "（無說明）"}
          {r.it.fee ? <small>含國外交易手續費 {formatMoney(r.it.fee)}</small> : null}
          {al ? <small>對照：{(findCategory(s, al.catId)?.name || "") + (al.name ? " · " + al.name : "")}</small> : null}
          {r.tx ? (
            <small>
              帳本：{md(r.tx.date)} {r.tx.name || findCategory(s, r.tx.catId)?.name || ""}
              {r.diff ? ` · 差 ${r.diff} 天` : ""}
              {r.feeMissing ? ` · 帳本沒記手續費 ${formatMoney(r.feeMissing)}` : ""}
              {r.amtDiff ? ` · 金額差 ${r.amtDiff > 0 ? "+" : "−"}${formatMoney(r.amtDiff)}` : ""}
            </small>
          ) : null}
        </span>
        <span className="a">
          {r.it.amount < 0 ? "−" : ""}
          {formatMoney(r.it.amount)}
        </span>
        {acts ? <span className="acts2">{acts}</span> : null}
      </div>
    );
  };
  const sect = (color: string, title: string, n: number, inner: ReactNode) => (
    <>
      <div className="sect">
        <span className="dot" style={{ background: color }} />
        {title}
        <span className="cnt">{n}</span>
      </div>
      <div className="card" style={{ padding: "2px 14px" }}>
        {inner}
      </div>
    </>
  );
  const sel = (k: keyof ColumnMap, label: string, opt?: boolean) => (
    <div className="namefield">
      <label htmlFor={"map-" + k}>{label}</label>
      <select
        id={"map-" + k}
        value={String(I2.map[k])}
        onChange={(e) =>
          setI((x) => {
            const n = rebuild(x, { ...x.map, [k]: +e.target.value });
            n.err = n.items.length ? "" : "沒有讀到任何明細。請確認「日期」「金額」對應的欄位。";
            saveCsvMap(n);
            return n;
          })
        }
      >
        {opt ? <option value="-1">（不使用）</option> : null}
        {headers.map((h, i) => (
          <option key={i} value={String(i)}>
            {h}
          </option>
        ))}
      </select>
    </div>
  );

  let result: ReactNode = null;
  if (m) {
    const ok = m.res.filter((r) => r.kind === "ok");
    const mb = m.res.filter((r) => r.kind === "maybe");
    const miss = m.res.filter((r) => r.kind === "missing");
    const rf = m.res.filter((r) => r.kind === "refund");
    const sum = (a: MatchRow[]) => a.reduce((x, r) => x + r.it.amount, 0);
    const fm = ok.filter((r) => r.feeMissing);
    const okr = ok.filter((r) => !r.feeMissing);
    result = (
      <>
        <div className="stats4">
          <div className="pill">
            <span>帳單合計 · {m.res.length} 筆</span>
            <b>{formatMoney(sum(m.res))}</b>
          </div>
          <div className="pill">
            <span>已對上 · {ok.length} 筆</span>
            <b style={{ color: "var(--inc)" }}>{formatMoney(sum(ok))}</b>
          </div>
          <div className="pill">
            <span>漏記 · {miss.length} 筆</span>
            <b style={{ color: "var(--exp)" }}>{formatMoney(sum(miss))}</b>
          </div>
          <div className="pill">
            <span>待確認 · {mb.length} 筆</span>
            <b>{formatMoney(sum(mb))}</b>
          </div>
        </div>
        <p className="pkhint" style={{ marginTop: 0 }}>
          帳單期間 {md(m.lo)}–{md(m.hi)}。金額相同且日期差 3 天內算對上；日期差 4–7 天，或金額差 5% 內（外幣匯率常見），要你確認。
        </p>
        {miss.length
          ? sect(
              "var(--exp)",
              "漏記：帳單有、帳本沒有",
              miss.length,
              miss.map((r) =>
                row(
                  r,
                  /加值/.test(r.it.desc || "") ? (
                    <>
                      <button className="btn sm" onClick={() => addMissing(r)}>
                        補記成支出
                      </button>
                      <button className="btn sm primary" onClick={() => markTopup(r)}>
                        記為加值
                      </button>
                    </>
                  ) : (
                    <button className="btn sm primary" onClick={() => addMissing(r)}>
                      補記
                    </button>
                  ),
                ),
              ),
            )
          : null}
        {mb.length
          ? sect(
              "var(--chart-amber,#d97706)",
              "待確認：日期差較多",
              mb.length,
              mb.map((r) =>
                row(
                  r,
                  <>
                    <button className="btn sm" onClick={() => setI((x) => ({ ...x, rej: new Set(x.rej).add(r.i) }))}>
                      不是同一筆
                    </button>
                    <button
                      className="btn sm primary"
                      onClick={() => {
                        if (r.tx) {
                          const al = learnAlias(s, r.it.desc, r.tx, uid8());
                          if (al && mode !== "readonly") setSettings((st) => ({ ...st, aliases: al }));
                        }
                        setI((x) => ({ ...x, acc: new Set(x.acc).add(r.i) }));
                      }}
                    >
                      是同一筆
                    </button>
                  </>,
                ),
              ),
            )
          : null}
        {fm.length
          ? sect(
              "var(--chart-amber,#d97706)",
              "對上了，但帳本那筆沒記手續費",
              fm.length,
              <>
                {fm.map((r) =>
                  row(
                    r,
                    <button className="btn sm primary" onClick={() => addFee([r])}>
                      補上手續費
                    </button>,
                  ),
                )}
                {fm.length > 1 ? (
                  <button className="addbtn" style={{ width: "100%", height: 36, margin: "8px 0 10px" }} onClick={() => addFee(fm)}>
                    全部補上（{fm.length} 筆，共 {formatMoney(fm.reduce((a, r) => a + (r.feeMissing || 0), 0))}）
                  </button>
                ) : null}
              </>,
            )
          : null}
        {m.extra.length
          ? sect(
              "var(--xfer)",
              "帳本有、帳單沒有",
              m.extra.length,
              <>
                {m.extra.map((t) => (
                  <div className="irow" key={t.id}>
                    <span className="d">{md(t.date)}</span>
                    <span className="m">
                      {t.name || findCategory(s, t.catId)?.name || ""}
                      <small>
                        {cardOf(s, t)?.name || "未指定卡片"}
                        {t.merchant ? " · " + t.merchant : ""}
                      </small>
                    </span>
                    <span className="a">{formatMoney(net(t))}</span>
                    <span className="acts2">
                      <button className="btn sm" onClick={() => openEditor({ tx: t })}>
                        查看
                      </button>
                    </span>
                  </div>
                ))}
                <p className="pkhint">可能是記錯卡、記成現金，或還沒入帳。</p>
              </>,
            )
          : null}
        {rf.length ? sect("var(--muted-foreground)", "退款／負數", rf.length, rf.map((r) => row(r))) : null}
        {okr.length ? (
          <details style={{ marginTop: 14 }}>
            <summary className="sect" style={{ cursor: "pointer", margin: 0 }}>
              已對上<span className="cnt">{okr.length}</span>
            </summary>
            <div className="card" style={{ padding: "2px 14px", marginTop: 6 }}>
              {okr.map((r) => row(r))}
            </div>
          </details>
        ) : null}
      </>
    );
  }

  const secCards = cards.filter((c) => !c.archived || Object.values(I2.secMap || {}).includes(c.id));
  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="信用卡帳單比對">
      <div className="in">
        <div className="shead">
          <button className="iconbtn" aria-label="關閉" onClick={() => setImportOpen(false)}>
            <UiIcon name="x" />
          </button>
          <h2>帳單比對</h2>
          <span style={{ width: 36 }} />
        </div>
        <div className="sbody" id="isbody">
          <div className="namefield" style={{ marginBottom: 12 }}>
            <label htmlFor="imp-card">比對哪張卡</label>
            <select
              id="imp-card"
              value={I2.cardId}
              onChange={(e) => {
                const v = e.target.value;
                setI((x) => {
                  const secMap = { ...x.secMap };
                  for (const k in secMap) if (secMap[k] === x.cardId && !(s.stmtSec || {})[k]) secMap[k] = v;
                  return { ...x, cardId: v, secMap };
                });
              }}
            >
              <option value="">所有信用卡支出</option>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <label className="filebtn">
            <Ic name="plus" />
            <span>{I2.fileName ? I2.fileName + "（重新選擇）" : "選擇帳單檔案（CSV、Excel 或網頁檔）"}</span>
            <input
              id="imp-file"
              type="file"
              accept=".csv,.txt,.tsv,.xls,.xlsx,.html,.htm,text/csv,text/html"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
              }}
            />
          </label>
          <p className="pkhint">到網路銀行下載信用卡帳單明細（CSV、Excel；只有網頁版的可以另存成 .html 檔）再上傳。檔案只在你的瀏覽器裡讀取，不會上傳到其他地方。</p>
          {I2.loading ? (
            <div className="empty" style={{ marginTop: 12 }}>
              <b>讀取中…</b>
            </div>
          ) : null}
          {I2.err ? (
            <div className="err" role="alert">
              {I2.err}
            </div>
          ) : null}
          {I2.rows && !I2.loading ? (
            <>
              {I2.secs.length ? (
                <div className="card" style={{ marginTop: 12 }}>
                  <div className="lbl-s">帳單裡的卡片</div>
                  <p className="pkhint" style={{ margin: "0 0 6px" }}>
                    這份帳單有 {I2.secs.length} 張卡，分別對應到你的哪張卡片？設定會記住，下次自動套用。
                  </p>
                  {I2.secs.map((k) => (
                    <div className="namefield" style={{ marginTop: 8 }} key={k}>
                      <label>{k}</label>
                      <select
                        value={I2.secMap[k] || ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          setI((x) => ({ ...x, secMap: { ...x.secMap, [k]: v } }));
                          if (mode === "live") setSettings((st) => ({ ...st, stmtSec: { ...(st.stmtSec || {}), [k]: v } }));
                        }}
                      >
                        <option value="">所有信用卡支出</option>
                        {secCards.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="card" style={{ marginTop: 12 }}>
                <div className="lbl-s">欄位對應</div>
                <div className="mapgrid">
                  {sel("date", "日期")}
                  {sel("desc", "說明", true)}
                  {sel("amount", "金額")}
                </div>
                <div className="tbl-wrap">
                  <table className="tbl">
                    <tbody>
                      {I2.rows.slice(I2.headerIdx, I2.headerIdx + 4).map((r, ri) => (
                        <tr key={ri}>{r.map((c, ci) => (ri === 0 ? <th key={ci}>{c}</th> : <td key={ci}>{c}</td>))}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="pkhint" style={{ marginBottom: 0 }}>
                  讀到 {I2.items.length} 筆明細{I2.pays ? `（已略過 ${I2.pays} 筆繳款）` : ""}
                  {I2.items.some((x) => x.fee) ? "；國外交易手續費已併入同一筆消費" : ""}。{I2.cardId ? "欄位設定會記在這張卡上，下次自動套用。" : ""}
                </p>
              </div>
            </>
          ) : null}
          {result}
        </div>
      </div>
    </div>
  );
}
