/** 信用卡帳單比對：上傳網銀下載的帳單，跟帳本的刷卡記錄配對 */
import { useEffect, useState, type ReactNode } from "react";
import type { Ledger, Tx } from "../../core/types";
import { cardOf, findCard, findCategory, makeTopup } from "../../core/ledger";
import { formatMoney, net, r2 } from "../../core/money";
import { addDays } from "../../core/dates";
import { uid8 } from "../../core/ids";
import { findAlias, learnAlias } from "../../core/alias";
import {
  buildItems, decodeText, findCloseDate, guessHeader, guessMap, initSecMap, linkCandidates, markNext, matchStatement, mergeGroup, parseCSV,
  reconcile, stmtKey, type ColumnMap, type MatchInput, type MatchRow, type StatementItem,
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
  /** 手動對應：明細索引 → 記錄 id */
  links: Record<number, string[]>;
  /** 說過「不是這幾筆加起來」的明細索引 */
  noCombo: Set<number>;
  /** 正在幫哪一行選帳本記錄（手動對應） */
  pick: number | null;
  pickSel: string[];
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
  const [I2, setI] = useState<Imp>({ cardId: "", headerIdx: 0, map: { date: -1, desc: -1, amount: -1 }, items: [], secs: [], secMap: {}, pays: 0, acc: new Set(), rej: new Set(), links: {}, noCombo: new Set(), pick: null, pickSel: [] });
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
    return { ...base, map, items: b.items, secs: b.secs, pays: b.pays, secMap: initSecMap(s, b.secs, base.cardId, base.secMap), acc: new Set(), rej: new Set(), links: {}, noCombo: new Set(), pick: null, pickSel: [] };
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

  const key = I2.items.length ? stmtKey(I2.cardId, I2.items) : "";
  const mi: MatchInput = { items: I2.items, cardId: I2.cardId, secMap: I2.secMap, rejected: I2.rej, accepted: I2.acc, key, links: I2.links, noCombo: I2.noCombo };
  const m = I2.items.length ? matchStatement(ledger, mi) : null;
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

  /* ---------- 多筆、手動對應、下期入帳、完成對帳 ---------- */
  const tname = (t: Tx) => t.name || findCategory(s, t.catId)?.name || "";
  const sameDay = (list: Tx[]) => list.length > 1 && list.every((t) => t.date === list[0].date) && list.every((t) => !t.grp);
  const acceptCombo = (r: MatchRow) => {
    if (!r.combo || !canWrite()) return;
    commit({ months: mergeGroup(ledger, r.combo, "g" + uid8()) });
    toast(`已把 ${r.combo.length} 筆合成一組，對上這行帳單`);
  };
  const saveLink = () => {
    const i = I2.pick;
    if (i == null || !I2.pickSel.length) return;
    const list = allLedgerTx.filter((t) => I2.pickSel.includes(t.id));
    setI((x) => ({ ...x, links: { ...x.links, [i]: x.pickSel.slice() }, pick: null, pickSel: [] }));
    if (sameDay(list) && mode === "live") {
      commit({ months: mergeGroup(ledger, list, "g" + uid8()) });
      toast(`已對應 ${list.length} 筆，並合成一組`);
    } else toast(list.length > 1 ? `已對應 ${list.length} 筆` : "已對應");
  };
  const unlink = (i: number) =>
    setI((x) => {
      const links = { ...x.links };
      delete links[i];
      return { ...x, links };
    });
  const setNext = (t: Tx, on: boolean) => {
    if (!canWrite()) return;
    commit({ months: markNext(ledger, t, on) });
    toast(on ? "已標成下期入帳，下次匯入帳單會再拿來比對" : "已取消下期入帳");
  };
  const finish = () => {
    if (!m) return;
    if (!canWrite()) return;
    const r = reconcile(ledger, key, m.res);
    if (r.n) commit({ months: r.months });
    setImportOpen(false);
    toast(r.n ? `已記下對帳（${r.n} 筆記錄）` : "已對上的記錄之前就記過了");
  };
  const allLedgerTx = Object.values(ledger.months).flatMap((x) => x.items || []);
  const linkPicker = () => {
    const i = I2.pick!;
    const it = I2.items[i];
    const cands = linkCandidates(ledger, mi, m!, i);
    const selSum = r2(cands.filter((t) => I2.pickSel.includes(t.id)).reduce((a, t) => a + net(t), 0));
    const toggle = (id: string) => setI((x) => ({ ...x, pickSel: x.pickSel.includes(id) ? x.pickSel.filter((y) => y !== id) : x.pickSel.concat([id]) }));
    const close = () => setI((x) => ({ ...x, pick: null, pickSel: [] }));
    return (
      <div className="dlg-ov" onClick={(e) => e.target === e.currentTarget && close()}>
        <div className="dlg linkdlg enter" role="dialog" aria-modal="true" aria-labelledby="lk-t">
          <h3 id="lk-t">選帳本記錄對應</h3>
          <p>
            帳單 {md(it.date)} {it.desc || "（無說明）"} <b className="num">{formatMoney(it.amount)}</b>
          </p>
          <p>可以勾好幾筆（例如同一張發票分開記的），同一天的會自動合成一組。</p>
          <div className="linklist">
            {cands.length ? (
              cands.map((t) => (
                <label key={t.id} className={"linkrow" + (I2.pickSel.includes(t.id) ? " on" : "")}>
                  <input type="checkbox" checked={I2.pickSel.includes(t.id)} onChange={() => toggle(t.id)} />
                  <span className="d">{md(t.date)}</span>
                  <span className="m">
                    {tname(t)}
                    <small>
                      {cardOf(s, t)?.name || "未指定卡片"}
                      {t.merchant ? " · " + t.merchant : ""}
                      {t.rc === "next" ? " · 下期入帳" : ""}
                    </small>
                  </span>
                  <span className="a num">{formatMoney(net(t))}</span>
                </label>
              ))
            ) : (
              <p className="pkhint">前後 30 天內沒有還沒對上的刷卡記錄。</p>
            )}
          </div>
          <p className="num" style={{ color: I2.pickSel.length && Math.abs(selSum - it.amount) > 0.5 ? "var(--exp)" : undefined }}>
            已選 {I2.pickSel.length} 筆，合計 {formatMoney(selSum)}
            {I2.pickSel.length && Math.abs(selSum - it.amount) > 0.5 ? `（跟帳單差 ${formatMoney(Math.abs(r2(it.amount - selSum)))}）` : ""}
          </p>
          <div className="acts" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 4 }}>
            <button className="btn" onClick={close}>
              取消
            </button>
            <button className="btn primary" disabled={!I2.pickSel.length} onClick={saveLink}>
              對應
            </button>
          </div>
        </div>
      </div>
    );
  };

  const row = (r: MatchRow, acts?: ReactNode, extra?: ReactNode) => {
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
              帳本：{md(r.tx.date)} {r.txs ? `${r.txs.length} 筆（${r.txs.map(tname).join("、")}）` : tname(r.tx)}
              {r.via === "link" ? " · 手動對應" : r.via === "rc" ? " · 已對帳" : ""}
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
        {extra}
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
                    <>
                      <button className="btn sm" onClick={() => setI((x) => ({ ...x, pick: r.i, pickSel: [] }))}>
                        選帳本記錄
                      </button>
                      <button className="btn sm primary" onClick={() => addMissing(r)}>
                        補記
                      </button>
                    </>
                  ),
                  r.combo ? (
                    <div className="combo">
                      <b>
                        可能是同一天這 {r.combo.length} 筆加起來：
                      </b>
                      <span>{r.combo.map((t) => `${tname(t)} ${formatMoney(net(t))}`).join("、")}</span>
                      <span className="acts2">
                        <button className="btn sm" onClick={() => setI((x) => ({ ...x, noCombo: new Set(x.noCombo).add(r.i) }))}>
                          不是
                        </button>
                        <button className="btn sm primary" onClick={() => acceptCombo(r)}>
                          是，合成一組
                        </button>
                      </span>
                    </div>
                  ) : null,
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
        {(() => {
          const inCombo = new Set(m.res.flatMap((r) => (r.combo || []).map((t) => t.id)));
          const ex = m.extra.filter((t) => !inCombo.has(t.id));
          const lateFrom = addDays(m.hi, -7);
          const late = ex.filter((t) => t.date >= lateFrom);
          const other = ex.filter((t) => t.date < lateFrom);
          const txRow = (t: Tx, acts: ReactNode) => (
            <div className="irow" key={t.id}>
              <span className="d">{md(t.date)}</span>
              <span className="m">
                {tname(t)}
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
                {acts}
              </span>
            </div>
          );
          const nextBtn = (t: Tx) => (
            <button className="btn sm" onClick={() => setNext(t, true)}>
              下期入帳
            </button>
          );
          return (
            <>
              {other.length
                ? sect("var(--xfer)", "帳本有、帳單沒有", other.length, <>{other.map((t) => txRow(t, nextBtn(t)))}<p className="pkhint">可能是記錯卡、記成現金，或還沒入帳。確定是下期才入帳的，按「下期入帳」，這次就不再列出，下次匯入帳單會再拿來比對。</p></>)
                : null}
              {late.length
                ? sect("var(--muted-foreground)", "可能下期才入帳", late.length, <>{late.map((t) => txRow(t, nextBtn(t)))}<p className="pkhint">刷卡日在帳單最後 7 天內，常常會到下一期帳單才出現。</p></>)
                : null}
              {m.carried.length
                ? sect(
                    "var(--muted-foreground)",
                    "標成下期入帳、這份帳單還沒出現",
                    m.carried.length,
                    <>
                      {m.carried.map((t) =>
                        txRow(
                          t,
                          <button className="btn sm" onClick={() => setNext(t, false)}>
                            取消下期
                          </button>,
                        ),
                      )}
                      <p className="pkhint">如果這份帳單裡其實有，到上面那行按「選帳本記錄」手動對應。</p>
                    </>,
                  )
                : null}
            </>
          );
        })()}
        {rf.length ? sect("var(--muted-foreground)", "退款／負數", rf.length, rf.map((r) => row(r))) : null}
        {okr.length ? (
          <details style={{ marginTop: 14 }}>
            <summary className="sect" style={{ cursor: "pointer", margin: 0 }}>
              已對上<span className="cnt">{okr.length}</span>
            </summary>
            <div className="card" style={{ padding: "2px 14px", marginTop: 6 }}>
              {okr.map((r) =>
                row(
                  r,
                  r.via === "link" ? (
                    <button className="btn sm" onClick={() => unlink(r.i)}>
                      取消對應
                    </button>
                  ) : undefined,
                ),
              )}
            </div>
          </details>
        ) : null}
        <button className="btn primary finbtn" onClick={finish}>
          完成對帳（記下 {ok.length} 行已對上）
        </button>
        <p className="pkhint">按「完成對帳」會在對上的記錄記下是哪一份帳單，之後匯入其他期的帳單就不會再拿它們來比；重新匯入同一份帳單時照樣會對上。</p>
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
          {m ? (
            <button className="iconbtn okbtn" aria-label="完成對帳" onClick={finish}>
              <UiIcon name="check" />
            </button>
          ) : (
            <span style={{ width: 36 }} />
          )}
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
          {I2.pick != null && m ? linkPicker() : null}
        </div>
      </div>
    </div>
  );
}
