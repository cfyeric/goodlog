/** 記帳畫面（新增、編輯、確認待入帳） */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Category, Group, Ledger, Tx } from "../../core/types";
import { findCategory, findGroup } from "../../core/ledger";
import { formatMoney, r2 } from "../../core/money";
import { uid8 } from "../../core/ids";
import { postBase, ruleMode } from "../../core/recurrence";
import { recurHint, schedText } from "../../core/recurrenceText";
import {
  applyKey, catPath, confirmDraft, dateLabel, deleteGroup, deleteTx, evalExpr, KEYMAP, newDraft, planSummary, quickAmounts,
  recRuleOf, saveDraft, stopRule, suggestCats, type Draft, type PadKey, type SchedDraft, applySched, schedOpen,
} from "../../core/editor";
import { useApp } from "../state";
import { useNav } from "../nav";
import { useOverlay, type EditorRequest } from "./context";
import { Ic, Seal, UiIcon } from "../ui/Icon";
import { CatGrid } from "./CatGrid";
import { SuggestBar } from "./SuggestBar";
import { DatePicker } from "./DatePicker";
import { SchedDialog } from "./SchedDialog";

type PadTarget = "amount" | "fee" | "discount";

interface UiState {
  tab: "sug" | "expense" | "income" | null;
  group: string | null;
  collapsed: boolean;
  padTarget: PadTarget | null;
  /** 鍵盤收起動畫中 */
  padClosing: PadTarget | null;
  feeDlg: Draft["ex"] | null;
  err: string;
  armed: string | null;
  dp: boolean;
  sched: SchedDraft | null;
  sugField: "name" | "merchant" | null;
  prevAmt: number | null;
}

export function EditorHost() {
  const { editor } = useOverlay();
  const { ledger } = useApp();
  if (!editor || !ledger) return null;
  return (
    <div id="sheetRoot">
      <EditorSheet key={(editor.tx?.id || "new") + (editor.confirmPending ? "c" : "")} req={editor} ledger={ledger} />
    </div>
  );
}

function EditorSheet({ req, ledger }: { req: EditorRequest; ledger: Ledger }) {
  const { today, commit, canWrite, toast, mode: storeMode } = useApp();
  const { nav, go } = useNav();
  const { closeEditor } = useOverlay();
  const s = ledger.settings;
  const [d, setD] = useState<Draft>(() => {
    const base = req.confirmPending && req.tx ? confirmDraft(ledger, req.tx, uid8(), new Date()) : newDraft(ledger, req.tx, { date: req.date || nav.sel, now: new Date(), id: uid8() });
    if (req.prefill) {
      base.t = { ...base.t, ...req.prefill.t };
      base.ex = { ...base.ex, ...req.prefill.ex };
      base.fromImp = req.prefill.fromImp || null;
    }
    return base;
  });
  const t = d.t;
  const [u, setU] = useState<UiState>(() => ({
    tab: null,
    group: req.tx ? findCategory(s, req.tx.catId)?.groupId || null : req.prefill?.t.catId ? findCategory(s, req.prefill.t.catId)?.groupId || null : null,
    collapsed: req.confirmPending ? true : !!(req.tx?.catId || req.prefill?.t.catId),
    padTarget: req.tx && !req.confirmPending ? null : "amount",
    padClosing: null,
    feeDlg: null,
    err: "",
    armed: null,
    dp: false,
    sched: null,
    sugField: null,
    prevAmt: req.confirmPending && req.tx ? r2((+req.tx.amount || 0) + (+(req.tx.fee ?? 0) || 0) - (req.tx.type === "expense" ? +(req.tx.discount ?? 0) || 0 : 0)) : null,
  }));
  const ui = (p: Partial<UiState>) => setU((x) => ({ ...x, ...p }));
  const setT = (p: Partial<Tx>) => setD((x) => ({ ...x, t: { ...x.t, ...p } }));

  // 背景不要捲動
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // 可選的類別
  const visible = (c: Category) => c.id === t.catId || (!c.hidden && !findGroup(s, c.groupId)?.hidden);
  const cs = (s.categories || []).filter((c) => c.type === t.type && visible(c));
  const csAll = (s.categories || []).filter(visible);
  const sug = useMemo(() => suggestCats(ledger, t, csAll), [ledger, t.date, (t.time || "").slice(0, 2), csAll.length]); // eslint-disable-line
  let tab = u.tab;
  if (!tab || (tab === "sug" && !sug.length)) tab = !d.orig && sug.length ? "sug" : t.type === "income" ? "income" : "expense";
  if (tab !== "sug" && tab !== t.type) tab = t.type === "income" ? "income" : "expense";
  const gList = (s.groups || []).filter((g) => g.type === t.type && cs.some((c) => c.groupId === g.id));
  const group = u.group && gList.some((g) => g.id === u.group) ? u.group : null;
  const catMode = tab === "sug" ? "sug" : group ? "sub" : "grp";
  const curC = findCategory(s, t.catId);
  const colC = u.collapsed && t.catId ? curC : null;

  const val = evalExpr(d.ex.amount);
  const showExpr = /[+\-×÷]/.test(d.ex.amount.slice(1));
  const fee = evalExpr(d.ex.fee);
  const dis = evalExpr(d.ex.discount);
  const total = t.type === "expense" ? val + fee - dis : t.type === "income" ? val - fee : val;
  const PT = u.padTarget;
  const RR = d.orig ? recRuleOf(s, d.orig) : null;

  /* ---------- 鍵盤 ---------- */
  const openPad = (k: PadTarget) => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    ui({ padTarget: k, padClosing: null });
  };
  const closePad = () => {
    if (!u.padTarget) return;
    const k = u.padTarget;
    const v = evalExpr(d.ex[k]);
    setD((x) => ({ ...x, ex: { ...x.ex, [k]: v ? String(v) : "" } }));
    ui({ padTarget: null, padClosing: k });
    setTimeout(() => setU((x) => (x.padTarget ? x : { ...x, padClosing: null })), 200);
  };
  const press = (k: PadKey) => {
    const tk = u.padTarget;
    if (!tk) return;
    if (k === "ok") return closePad();
    setD((x) => ({ ...x, ex: { ...x.ex, [tk]: applyKey(x.ex[tk], k) } }));
  };
  // 實體鍵盤
  const pressRef = useRef(press);
  pressRef.current = press;
  const stateRef = useRef({ u, d });
  stateRef.current = { u, d };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const { u } = stateRef.current;
      if (e.key === "Escape") {
        e.preventDefault();
        if (u.dp) return ui({ dp: false });
        if (u.sched) return ui({ sched: null });
        if (u.feeDlg) {
          const f = u.feeDlg;
          setD((x) => ({ ...x, ex: f }));
          return ui({ feeDlg: null, padTarget: null });
        }
        if (u.padTarget) return closePadRef.current();
        return closeEditor();
      }
      if (u.sched || u.dp || e.metaKey || e.ctrlKey || e.altKey) return;
      const ae = document.activeElement as HTMLElement | null;
      if (ae && ae.matches("input,textarea,select,[contenteditable]")) return;
      const k = KEYMAP[e.key];
      if (!k) return;
      if (!u.padTarget) {
        if (!/^[0-9.]$/.test(k)) return;
        ui({ padTarget: "amount", padClosing: null });
        setD((x) => ({ ...x, ex: { ...x.ex, amount: applyKey(x.ex.amount, k) } }));
        e.preventDefault();
        return;
      }
      e.preventDefault();
      const btn = document.querySelector(`.keys [data-k="${k}"]`);
      btn?.classList.add("pressed");
      setTimeout(() => btn?.classList.remove("pressed"), 120);
      pressRef.current(k);
    };
    document.addEventListener("keydown", h, true);
    return () => document.removeEventListener("keydown", h, true);
  }, [closeEditor]);
  const closePadRef = useRef(closePad);
  closePadRef.current = closePad;

  /* ---------- 動作 ---------- */
  const save = () => {
    const res = saveDraft(ledger, d, today, uid8, storeMode === "readonly");
    if (!res.ok) {
      ui({ err: res.err, ...(res.openPad ? { padTarget: "amount" as const, padClosing: null } : {}) });
      toast(res.err);
      return;
    }
    commit({ months: res.months, settings: res.settings });
    if (res.sel) go((n) => ({ sel: res.sel!, ym: res.sel!.slice(0, 7), view: n.view === "settings" ? "home" : n.view }));
    closeEditor();
    toast(res.msg);
  };
  const arm = (k: string) => {
    if (u.armed === k) return true;
    ui({ armed: k });
    return false;
  };
  const del = () => {
    if (!arm("tx") || !d.orig) return;
    commit({ months: deleteTx(ledger, d.orig) });
    closeEditor();
    toast("已刪除");
  };
  const delAll = () => {
    if (!arm("txall") || !d.orig) return;
    const gid = (d.orig.inst || d.orig.rec)!.id;
    const r = deleteGroup(ledger, gid);
    commit({ months: r.months, settings: r.settings });
    closeEditor();
    toast(`已刪除整組（${r.n} 筆）`);
  };
  const stop = () => {
    if (!arm("recstop") || !d.orig?.rec) return;
    if (!canWrite()) return;
    commit({ settings: stopRule(s, d.orig.rec.id) });
    closeEditor();
    toast("已停止這個週期，已記的記錄保留");
  };
  const chooseType = (v: "sug" | "expense" | "income") => {
    if (v === "sug") return ui({ tab: "sug" });
    if (t.type === v) return ui({ tab: v, group: curC?.groupId || null });
    setD((x) => {
      const nt: Tx = { ...x.t, type: v, catId: null };
      if (v === "expense" && !nt.pay) nt.pay = "cash";
      return { ...x, t: nt, mode: v !== "expense" && x.mode?.kind === "inst" ? null : x.mode };
    });
    ui({ tab: v, group: null });
  };
  const chooseCat = (c: Category) => {
    setD((x) => {
      const nt: Tx = { ...x.t, catId: c.id };
      let mode = x.mode;
      if (c.type !== x.t.type) {
        nt.type = c.type;
        if (c.type === "expense" && !nt.pay) nt.pay = "cash";
        if (c.type !== "expense" && mode?.kind === "inst") mode = null;
      }
      return { ...x, t: nt, mode };
    });
    ui({ collapsed: true, err: "" });
  };

  const opt = (list: { id: string; name: string }[], none: string) => [
    <option key="" value="">
      {none}
    </option>,
    ...list.map((o) => (
      <option key={o.id} value={o.id}>
        {o.name}
      </option>
    )),
  ];
  const dl = dateLabel(t.date, today);
  const qa = PT === "amount" || u.padClosing === "amount" ? quickAmounts(ledger, t) : [];
  const padShown = !!PT;
  const padKind = PT || u.padClosing;

  /* ---------- 週期欄位 ---------- */
  let schedField: ReactNode = null;
  if (d.orig && RR) {
    const cur = d.schedTouched ? (d.mode && d.mode.kind === "recur" ? d.mode : null) : ruleMode(RR, d.orig.rec!.i);
    const sc = d.scope;
    schedField = (
      <div className="field full">
        <label htmlFor="f-sched">週期</label>
        <button type="button" id="f-sched" className="fakein" style={{ height: "auto", minHeight: 36, whiteSpace: "normal" }} onClick={() => ui({ sched: schedOpen(s, d) })}>
          {cur ? schedText(cur) : "不再重複（這筆之後停止）"}
        </button>
        <div className="seg scope" role="radiogroup" aria-label="修改範圍">
          {(
            [
              ["one", "只改這一筆"],
              ["after", "這筆和之後"],
              ["all", "全部"],
            ] as const
          ).map(([k, l]) => {
            const disabled = (k === "one" && d.schedTouched) || (k === "all" && d.schedTouched && !cur);
            return (
              <button key={k} type="button" role="radio" aria-checked={sc === k} className={sc === k ? "on" : ""} disabled={disabled} onClick={() => setD((x) => ({ ...x, scope: k }))}>
                {l}
              </button>
            );
          })}
        </div>
        <span className="pkhint" style={{ margin: "2px 0 0" }}>
          第 {d.orig.rec!.i} 筆。
          {d.schedTouched
            ? sc === "all"
              ? "整個週期改用新設定，從第 1 筆重新排，之前已記的也會照新週期重記（個別改過的會被覆蓋）。"
              : cur
                ? "週期改了，會從這筆開始用新的週期，之後的記錄照新設定入帳。"
                : "這個週期到這筆為止，之後不再自動記帳。"
            : sc === "all"
              ? "金額、時間、類別、名稱、付款方式等改動，會套用到這個週期的每一筆，包括之前已記的。"
              : sc === "after"
                ? "金額、時間、類別、名稱、付款方式等改動，會套用到這筆和之後的每一筆；之前的不變。"
                : "只改這一筆，其他照原本設定。"}
        </span>
      </div>
    );
  } else if (!d.orig) {
    schedField = (
      <div className="field full">
        <label htmlFor="f-sched">週期</label>
        <button type="button" id="f-sched" className="fakein" style={{ height: "auto", minHeight: 36, whiteSpace: "normal" }} onClick={() => ui({ sched: schedOpen(s, d) })}>
          {schedText(d.mode)}
        </button>
        {d.mode && d.mode.kind === "inst" ? (
          <span className="pkhint" style={{ margin: "2px 0 0" }}>
            {planSummary(d.mode, d.ex).map((x, i) => (
              <span key={i} style={{ display: "block" }}>
                {x}
              </span>
            ))}
          </span>
        ) : null}
        {d.mode && d.mode.kind === "recur" ? (
          <span className="pkhint" style={{ margin: "2px 0 0" }}>
            {recurHint(d.mode, postBase(d.mode, t.date))}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="sheet enter"
      role="dialog"
      aria-modal="true"
      aria-label={d.orig ? "編輯記錄" : "新增記錄"}
      onClickCapture={(e) => {
        if (u.armed && !(e.target as HTMLElement).closest(".danger")) ui({ armed: null });
      }}
    >
      <div className="in">
        <div className="shead">
          <button className="iconbtn" aria-label="取消" onClick={closeEditor}>
            <UiIcon name="x" />
          </button>
          <h2>{d.confirmPending ? "確認入帳" : d.orig ? "編輯記錄" : "記一筆"}</h2>
          <button className="iconbtn okbtn" aria-label="儲存" onClick={save}>
            <UiIcon name="check" />
          </button>
        </div>
        {colC ? null : (
          <div className={"ttabs" + (sug.length ? " three" : "")} role="tablist">
            {((sug.length ? [["sug", "建議"]] : []) as [string, string][]).concat([["expense", "支出"], ["income", "收入"]]).map(([k, l]) => (
              <button key={k} className={tab === k ? "on" : ""} role="tab" aria-selected={tab === k} onClick={() => chooseType(k as "sug")}>
                {k === "sug" ? <Ic name="sparkles" /> : null}
                {l}
              </button>
            ))}
          </div>
        )}
        <div
          className={"sbody" + (PT || u.padClosing ? " padspace" : "")}
          id="sbody"
          onPointerDown={(e) => {
            if (!u.padTarget) return;
            if ((e.target as HTMLElement).closest(".pad,button,input,select,textarea,label,[role=button]")) return;
            closePad();
          }}
        >
          {colC ? (
            <div className="catpick">
              <button
                className="cat"
                aria-label={`更換類別（目前：${catPath(s, colC)}）`}
                title="點一下更換類別"
                onClick={() => {
                  ui({ collapsed: false, tab: t.type === "income" ? "income" : "expense", group: colC.groupId || null });
                }}
              >
                <Seal c={colC} s={s} />
                <span>{colC.name}</span>
              </button>
            </div>
          ) : (
            <CatGrid
              s={s}
              mode={catMode}
              groups={gList}
              cats={catMode === "sug" ? sug : catMode === "sub" ? cs.filter((c) => c.groupId === group) : []}
              group={group ? (findGroup(s, group) as Group) : null}
              selCat={t.catId || null}
              selGroup={curC?.groupId || null}
              onGroup={(id) => ui({ group: id })}
              onBack={() => ui({ group: null })}
              onCat={chooseCat}
            />
          )}
          <div className="amtrow">
            <button className={"amtbox" + (PT === "amount" ? " on" : "")} aria-label="輸入金額" onClick={() => PT !== "amount" && openPad("amount")}>
              <span className="cur">TWD</span>
              <span className="expr">
                {showExpr ? <small className="num">{d.ex.amount}</small> : null}
                <b style={{ color: t.type === "income" ? "var(--inc)" : "var(--exp)" }}>{fee || dis ? r2(total).toLocaleString("zh-TW") : val ? val.toLocaleString("zh-TW") : "0"}</b>
              </span>
            </button>
            <button
              type="button"
              className={"amtplus" + (fee || dis ? " has" : "")}
              aria-label="手續費與折扣"
              title="手續費與折扣"
              onClick={() => ui({ feeDlg: { ...d.ex }, padClosing: null, padTarget: val > 0 ? "fee" : "amount" })}
            >
              <UiIcon name="plus" />
            </button>
          </div>
          {fee || dis ? (
            <div className="breakdown num" role="button" style={{ cursor: "pointer" }} onClick={() => ui({ feeDlg: { ...d.ex }, padClosing: null, padTarget: val > 0 ? "fee" : "amount" })}>
              <span>金額 {formatMoney(val)}</span>
              {fee ? <span>手續費 +{formatMoney(fee)}</span> : null}
              {dis && t.type === "expense" ? <span>折扣 −{formatMoney(dis)}</span> : null}
            </div>
          ) : null}
          <div className="fgrid">
            {t.type === "expense" ? (
              <div className="field">
                <span className="sr-only" id="lbl-pay">
                  付款方式
                </span>
                <div className="seg paysel" role="radiogroup" aria-labelledby="lbl-pay">
                  {(["cash", "card"] as const).map((k) => (
                    <button key={k} type="button" className={t.pay === k ? "on" : ""} role="radio" aria-checked={t.pay === k} onClick={() => setT({ pay: k })}>
                      {k === "cash" ? "現金" : "信用卡"}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {t.type === "expense" && t.pay === "card" ? (
              <div className="field">
                <label htmlFor="f-card">卡片</label>
                <select id="f-card" value={t.cardId || ""} onChange={(e) => setT({ cardId: e.target.value })}>
                  {opt((s.cards || []).filter((c) => !c.archived || c.id === t.cardId), "卡片未指定")}
                </select>
              </div>
            ) : null}
            <div className={"field" + (t.type === "expense" && t.pay !== "card" ? "" : " full")}>
              <label htmlFor="f-proj">專案</label>
              <select id="f-proj" value={t.projectId || ""} onChange={(e) => setT({ projectId: e.target.value })}>
                {opt((s.projects || []).filter((p) => !p.archived || p.id === t.projectId), "無專案")}
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-date">日期</label>
              <button type="button" id="f-date" className="datebtn" onClick={() => ui({ dp: true })}>
                <span>{dl.main}</span>
                <small>{dl.wd}</small>
              </button>
            </div>
            <div className="field">
              <label htmlFor="f-time">時間</label>
              <input id="f-time" type="time" value={t.time || ""} onChange={(e) => setT({ time: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="f-name">名稱</label>
              <input
                id="f-name"
                placeholder="名稱"
                value={t.name || ""}
                autoComplete="off"
                onChange={(e) => setT({ name: e.target.value })}
                onFocus={() => {
                  if (u.padTarget) closePad();
                  ui({ sugField: "name" });
                }}
                onBlur={() => setTimeout(() => setU((x) => (x.sugField === "name" && document.activeElement?.id !== "f-name" && document.activeElement?.id !== "f-mer" ? { ...x, sugField: null } : x)), 150)}
              />
            </div>
            <div className="field">
              <label htmlFor="f-mer">商家</label>
              <input
                id="f-mer"
                placeholder="商家"
                value={t.merchant || ""}
                autoComplete="off"
                onChange={(e) => setT({ merchant: e.target.value })}
                onFocus={() => {
                  if (u.padTarget) closePad();
                  ui({ sugField: "merchant" });
                }}
                onBlur={() => setTimeout(() => setU((x) => (x.sugField === "merchant" && document.activeElement?.id !== "f-name" && document.activeElement?.id !== "f-mer" ? { ...x, sugField: null } : x)), 150)}
              />
            </div>
            <SuggestBar
              ledger={ledger}
              t={t}
              field={u.sugField}
              onPick={(field, v) => {
                setT({ [field]: v } as Partial<Tx>);
                if (field === "name" && !t.merchant) {
                  const m = document.getElementById("f-mer") as HTMLInputElement | null;
                  m?.focus();
                  ui({ sugField: "merchant" });
                  return;
                }
                ui({ sugField: null });
                (document.activeElement as HTMLElement | null)?.blur?.();
              }}
            />
            {schedField}
            <div className="field full">
              <label htmlFor="f-inv">發票號碼</label>
              <input id="f-inv" placeholder="發票號碼" value={t.invoice || ""} onChange={(e) => setT({ invoice: e.target.value })} />
            </div>
            {d.orig && d.orig.rec && !RR ? (
              <p className="pkhint" style={{ gridColumn: "1/-1", margin: 0 }}>
                這是週期記錄的第 {d.orig.rec.i} 筆，這個週期已經停止。
              </p>
            ) : null}
            {d.orig && d.orig.inst ? (
              <p className="pkhint full" style={{ gridColumn: "1/-1", margin: 0 }}>
                這是分期第 {d.orig.inst.i} / {d.orig.inst.n} 期（總額 {formatMoney(d.orig.inst.total || 0)}）。這裡的修改只會改這一期。
              </p>
            ) : null}
            <div className="field full">
              <label htmlFor="f-tags">標籤（以空白分隔）</label>
              <TagsInput tags={t.tags || []} onChange={(tags) => setT({ tags })} />
            </div>
            <div className="field full">
              <label htmlFor="f-note">備註</label>
              <textarea id="f-note" placeholder="備註" value={t.note || ""} onChange={(e) => setT({ note: e.target.value })} />
            </div>
          </div>
          <div className="err" id="err" role="alert">
            {u.err}
          </div>
          {d.orig ? (
            <button className={"danger" + (u.armed === "tx" ? " arm" : "")} onClick={del}>
              {u.armed === "tx" ? "再按一次確定刪除" : d.orig.inst ? "只刪除這一期" : "刪除這筆記錄"}
            </button>
          ) : null}
          {d.orig && d.orig.rec && (s.recurs || []).some((x) => x.id === d.orig!.rec!.id) ? (
            <button className={"danger" + (u.armed === "recstop" ? " arm" : "")} onClick={stop}>
              {u.armed === "recstop" ? "再按一次，停止之後的自動記帳" : "停止這個週期（已記的保留）"}
            </button>
          ) : null}
          {d.orig && (d.orig.inst || d.orig.rec) ? (
            <button className={"danger" + (u.armed === "txall" ? " arm" : "")} onClick={delAll}>
              {u.armed === "txall" ? "再按一次，刪除整組" : d.orig.inst ? "刪除整組分期（" + d.orig.inst.n + " 期）" : "刪除整組週期記錄"}
            </button>
          ) : null}
        </div>
        {u.feeDlg ? (
          <>
            <div
              className="fee-ov"
              onClick={() => {
                const f = u.feeDlg!;
                setD((x) => ({ ...x, ex: f }));
                const k = u.padTarget;
                ui({ feeDlg: null, padTarget: null, padClosing: k });
              }}
            />
            <div className="feecard enter" role="dialog" aria-modal="true" aria-labelledby="fee-t">
              <div className="feehead">
                <span style={{ width: 40 }} />
                <h3 id="fee-t">{t.type === "income" ? "收入" : "支出"}</h3>
                <button type="button" className="feereset" onClick={() => setD((x) => ({ ...x, ex: { ...x.ex, fee: "", discount: "" } }))}>
                  重置
                </button>
              </div>
              <button type="button" className={"feerow edit" + (PT === "amount" ? " on" : "")} onClick={() => PT !== "amount" && openPad("amount")}>
                <span style={{ color: "var(--foreground)" }}>
                  金額 <Ic name="square-pen" />
                </span>
                <b className="num">{formatMoney(val)}</b>
              </button>
              <button type="button" className={"feerow edit" + (PT === "fee" ? " on" : "")} onClick={() => PT !== "fee" && openPad("fee")}>
                <span>
                  手續費 <Ic name="square-pen" />
                </span>
                <b className="num" style={{ color: "var(--exp)" }}>
                  {t.type === "income" ? "−" : "+"}
                  {formatMoney(fee)}
                </b>
              </button>
              {t.type === "expense" ? (
                <button type="button" className={"feerow edit" + (PT === "discount" ? " on" : "")} onClick={() => PT !== "discount" && openPad("discount")}>
                  <span>
                    折扣 <Ic name="square-pen" />
                  </span>
                  <b className="num" style={{ color: "var(--inc)" }}>
                    −{formatMoney(dis)}
                  </b>
                </button>
              ) : null}
              <div className="feerow total">
                <span>總額</span>
                <b className="num">{formatMoney(total)}</b>
              </div>
              <div className="acts" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
                <button
                  className="btn"
                  onClick={() => {
                    const f = u.feeDlg!;
                    setD((x) => ({ ...x, ex: f }));
                    const k = u.padTarget;
                    ui({ feeDlg: null, padTarget: null, padClosing: k });
                  }}
                >
                  取消
                </button>
                <button
                  className="btn primary"
                  onClick={() => {
                    setD((x) => {
                      const ex = { ...x.ex };
                      (["amount", "fee", "discount"] as const).forEach((k) => {
                        const v = evalExpr(ex[k]);
                        ex[k] = v > 0 ? String(v) : "";
                      });
                      return { ...x, ex };
                    });
                    const k = u.padTarget;
                    ui({ feeDlg: null, padTarget: null, padClosing: k });
                  }}
                >
                  確定
                </button>
              </div>
            </div>
          </>
        ) : null}
        {padKind ? (
          <Keypad
            shown={padShown}
            kind={padKind}
            hint={d.confirmPending && padKind === "amount" && u.prevAmt ? `預設 ${formatMoney(u.prevAmt)}，直接按確定就用這個金額` : ""}
            quick={qa}
            onQuick={(a) => setD((x) => ({ ...x, ex: { ...x.ex, amount: a } }))}
            onKey={press}
          />
        ) : null}
      </div>
      {u.dp ? (
        <div id="dpRoot">
        <DatePicker
          value={t.date}
          today={today}
          onPick={(ds) => {
            setT({ date: ds });
            ui({ dp: false });
          }}
          onClose={() => ui({ dp: false })}
        />
        </div>
      ) : null}
      {u.sched ? (
        <SchedDialog
          d={d}
          s={s}
          init={u.sched}
          today={today}
          onCancel={() => ui({ sched: null })}
          onOk={(D) => {
            setD((x) => applySched(s, x, D));
            ui({ sched: null });
          }}
        />
      ) : null}
    </div>
  );
}

/** 標籤輸入：打字時保留原文，離開欄位才拆成陣列 */
function TagsInput({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [txt, setTxt] = useState(tags.join(" "));
  const parse = (v: string) => v.split(/[\s,，]+/).map((x) => x.replace(/^#/, "")).filter(Boolean);
  return (
    <input
      id="f-tags"
      placeholder="標籤（以空白分隔）"
      value={txt}
      onChange={(e) => {
        setTxt(e.target.value);
        onChange(parse(e.target.value));
      }}
    />
  );
}

const KEYS: [PadKey, string?, string?][] = [
  ["÷", "op"], ["×", "op"], ["-", "op", "−"], ["+", "op"],
  ["7"], ["8"], ["9"], ["back", "op", "⌫"],
  ["4"], ["5"], ["6"], ["C", "op"],
  ["1"], ["2"], ["3"], ["=", "op"],
  [".", "", "."], ["0"], ["00"], ["ok", "go", "✓"],
];

function Keypad({ shown, kind, hint, quick, onQuick, onKey }: { shown: boolean; kind: PadTarget; hint: string; quick: string[]; onQuick: (a: string) => void; onKey: (k: PadKey) => void }) {
  const [vis, setVis] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setVis(shown));
    return () => cancelAnimationFrame(id);
  }, [shown]);
  return (
    <div className={"pad" + (vis && shown ? " show" : "")} role="group" aria-label="數字鍵盤">
      <div className="padlabel">
        <span>
          輸入{{ amount: "金額", fee: "手續費", discount: "折扣" }[kind]}
          {hint ? (
            <small className="num" style={{ marginLeft: 6, color: "var(--muted-foreground)" }}>
              {hint}
            </small>
          ) : null}
        </span>
      </div>
      {kind === "amount" && quick.length ? (
        <div className="quick">
          {quick.map((a) => (
            <button key={a} className="num" onClick={() => onQuick(a)}>
              {a}
            </button>
          ))}
        </div>
      ) : null}
      <div className="keys">
        {KEYS.map(([k, c, l]) => (
          <button key={k} className={c || ""} data-k={k} aria-label={({ back: "刪除", ok: "完成", C: "清除" } as Record<string, string>)[k] || l || k} onClick={() => onKey(k)}>
            {l || k}
          </button>
        ))}
      </div>
    </div>
  );
}
