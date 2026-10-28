/** 排程設定（單次延後、週期、分期） */
import { useState, type ReactNode } from "react";
import type { Settings } from "../../core/types";
import { pd } from "../../core/dates";
import { formatMoney } from "../../core/money";
import { wdSet } from "../../core/recurrence";
import { INTEREST_TEXT, ROUNDING_TEXT } from "../../core/recurrenceText";
import { evalExpr, planSummary, recRuleOf, validateSched, type Draft, type SchedDraft } from "../../core/editor";

const WDN = ["日", "一", "二", "三", "四", "五", "六"];
type NumKey = "dom" | "moy" | "every" | "startIdx" | "count" | "instN" | "rate";
const NUM_ID: Record<NumKey, string> = { dom: "sc-dom", moy: "sc-moy", every: "sc-every", startIdx: "sc-start", count: "sc-count", instN: "sc-inst", rate: "sc-rate" };

export function SchedDialog({ d, s, init, today, onCancel, onOk }: { d: Draft; s: Settings; init: SchedDraft; today: string; onCancel: () => void; onOk: (D: SchedDraft) => void }) {
  const [D, setD] = useState<SchedDraft>(init);
  const [err, setErr] = useState("");
  const set = (p: Partial<SchedDraft>) => setD((x) => ({ ...x, ...p }));
  const t = d.t;
  const isExp = t.type === "expense";
  const EDR = d.orig && recRuleOf(s, d.orig);
  const tabs: [SchedDraft["kind"], string][] = [
    ["once", EDR ? "不再重複" : "單次"],
    ["recur", "週期"],
  ];
  if (isExp && !EDR) tabs.push(["inst", "分期"]);

  const sel = (id: string, opts: [string | number, string][], v: unknown, on: (v: string) => void) => (
    <select id={id} value={String(v)} onChange={(e) => on(e.target.value)}>
      {opts.map(([k, l]) => (
        <option key={k} value={String(k)}>
          {l}
        </option>
      ))}
    </select>
  );
  const num = (k: NumKey, min: number, max: number, ph: string, unit: string, width?: number) => {
    const id = NUM_ID[k];
    const v = D[k] as number | undefined;
    const shown = D.raw[id] != null ? D.raw[id] : v === 0 && ph ? "" : String(v ?? "");
    const input = (
      <input
        id={id}
        className="numin"
        style={width ? { width } : undefined}
        type="number"
        inputMode={k === "rate" ? "decimal" : "numeric"}
        min={min}
        max={max}
        step={k === "rate" ? "0.01" : "1"}
        placeholder={ph || undefined}
        value={shown}
        onChange={(e) => {
          const raw = e.target.value.trim();
          const n = k === "rate" ? +raw : Math.floor(+raw);
          setD((x) => ({ ...x, raw: { ...x.raw, [id]: raw }, [k]: raw === "" ? 0 : n }));
          setErr("");
        }}
      />
    );
    if (width) return input;
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {input}
        {unit ? <span className="v">{unit}</span> : null}
      </span>
    );
  };
  const row = (label: ReactNode, ctrl: ReactNode, forId?: string) => (
    <div className="optrow">
      {forId ? <label htmlFor={forId}>{label}</label> : <span>{label}</span>}
      {ctrl}
    </div>
  );
  const interval = (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span className="v">每</span>
      {num("every", 1, 365, "", "", 64)}
      {sel("sc-unit", [["day", "日"], ["week", "週"], ["month", "月"], ["year", "年"]], D.unit, (v) => set({ unit: v as SchedDraft["unit"] }))}
    </span>
  );
  const postRow = row("入帳方式", sel("sc-post", [["now", "立即入帳"], ["due", "延後入帳"], ["remind", "提醒入帳"]], D.post, (v) => set({ post: v as SchedDraft["post"] })), "sc-post");
  const dateRow =
    D.post === "due" || D.post === "remind"
      ? row(
          D.kind === "once" ? "入帳日期" : "第一次入帳日期",
          <input
            id="sc-pdate"
            className="numin"
            style={{ width: "auto", minWidth: 150, textAlign: "right" }}
            type="date"
            value={D.postDate || t.date || today}
            onChange={(e) => {
              const v = e.target.value;
              if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
              setD((x) => {
                const raw = { ...x.raw };
                delete raw["sc-dom"];
                delete raw["sc-moy"];
                return { ...x, postDate: v, dom: +v.slice(8, 10), moy: +v.slice(5, 7), dow: pd(v).getDay(), raw };
              });
            }}
          />,
          "sc-pdate",
        )
      : null;
  const workRow = row("遇非工作日入帳", sel("sc-work", [["same", "依原日期"], ["after", "延後"], ["before", "提前"]], D.workday, (v) => set({ workday: v as SchedDraft["workday"] })), "sc-work");

  let body: ReactNode;
  if (D.kind === "once") body = (
    <>
      {postRow}
      {dateRow}
    </>
  );
  else if (D.kind === "recur") {
    const cur = wdSet(D) || [];
    body = (
      <>
        {row("區間", interval, "sc-every")}
        {D.unit === "month"
          ? row("指定日期", num("dom", 1, 31, "", "號"), "sc-dom")
          : D.unit === "week"
            ? row("指定日期", sel("sc-dow", [[1, "週一"], [2, "週二"], [3, "週三"], [4, "週四"], [5, "週五"], [6, "週六"], [0, "週日"]], D.dow, (v) => set({ dow: +v })), "sc-dow")
            : D.unit === "year"
              ? row(
                  "指定日期",
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {num("moy", 1, 12, "", "", 64)}
                    <span className="v">月</span>
                    {num("dom", 1, 31, "", "", 64)}
                    <span className="v">號</span>
                  </span>,
                  "sc-moy",
                )
              : null}
        {D.unit === "day" ? (
          <div className="optrow wdrow">
            <span>
              只在這幾天<small>不選就是每天</small>
            </span>
            <span className="wdchips" role="group" aria-label="選擇星期">
              {[1, 2, 3, 4, 5, 6, 0].map((w) => (
                <button
                  key={w}
                  type="button"
                  className={cur.includes(w) ? "on" : ""}
                  aria-pressed={cur.includes(w)}
                  onClick={() =>
                    setD((x) => {
                      const c = Array.isArray(x.wdays) ? x.wdays.slice() : x.weekdays ? [1, 2, 3, 4, 5] : [];
                      const i = c.indexOf(w);
                      if (i >= 0) c.splice(i, 1);
                      else c.push(w);
                      return { ...x, wdays: c, weekdays: false };
                    })
                  }
                >
                  {WDN[w]}
                </button>
              ))}
            </span>
          </div>
        ) : null}
        {row("起始期數", num("startIdx", 1, 600, "", "期"), "sc-start")}
        {row("次數", num("count", 1, 600, "無限期", "次"), "sc-count")}
        {postRow}
        {dateRow}
        {D.unit === "day" && wdSet(D) ? null : workRow}
      </>
    );
  } else {
    const amt = evalExpr(d.ex.amount);
    body = (
      <>
        {row("分期總金額", <span className="v num">{amt ? formatMoney(amt) : "尚未輸入"}</span>)}
        {row("區間", interval, "sc-every")}
        {row("起始期數", num("startIdx", 1, 360, "", "期"), "sc-start")}
        {row("分期期數", num("instN", 2, 360, "", "期"), "sc-inst")}
        {row("寬限期", sel("sc-grace", ([[0, "無"]] as [number, string][]).concat([1, 2, 3, 4, 5, 6, 9, 12].map((n) => [n, n + " 個月"])), D.grace, (v) => set({ grace: +v })), "sc-grace")}
        {row("利息類型", sel("sc-int", Object.entries(INTEREST_TEXT), D.interest, (v) => set({ interest: v as SchedDraft["interest"] })), "sc-int")}
        {D.interest !== "none" ? row("年利率", num("rate", 0, 100, "", "%"), "sc-rate") : null}
        {row("分期計算方式", sel("sc-round", Object.entries(ROUNDING_TEXT), D.rounding, (v) => set({ rounding: v as SchedDraft["rounding"] })), "sc-round")}
        {row("分期餘額納入", sel("sc-rem", [["first", "首期"], ["last", "末期"]], D.remTo, (v) => set({ remTo: v as "first" })), "sc-rem")}
        {row("回饋（折扣）納入", sel("sc-extra", [["first", "首期"], ["each", "每期"]], D.extrasTo, (v) => set({ extrasTo: v as "first" })), "sc-extra")}
        {postRow}
        {dateRow}
        {workRow}
        {row(
          "每期金額",
          <span className="v num" id="sc-sum" style={{ maxWidth: "62%" }}>
            {planSummary(D, d.ex).map((x, i) => (
              <span key={i} style={{ display: "block" }}>
                {x}
              </span>
            ))}
          </span>,
        )}
      </>
    );
  }

  return (
    <div className="dlg-ov" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dlg sched enter" role="dialog" aria-modal="true" aria-labelledby="sc-t">
        <h3 id="sc-t">進階設定</h3>
        <div className="seg" role="tablist" style={{ display: "grid", gridTemplateColumns: `repeat(${tabs.length},1fr)`, width: "100%", marginTop: 6 }}>
          {tabs.map(([k, l]) => (
            <button key={k} className={D.kind === k ? "on" : ""} role="tab" aria-selected={D.kind === k} onClick={() => D.kind !== k && setD((x) => ({ ...x, kind: k, post: "now", raw: {} }))}>
              {l}
            </button>
          ))}
        </div>
        <div className="optrows">{body}</div>
        <div className="err" id="sc-err" role="alert" style={{ margin: "4px 0 0" }}>
          {err}
        </div>
        <div className="acts" style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
          <button className="btn" onClick={onCancel}>
            取消
          </button>
          <button
            className="btn primary"
            onClick={() => {
              const m = validateSched(D, d.ex.amount);
              if (m) return setErr(m);
              onOk(D);
            }}
          >
            確定
          </button>
        </div>
      </div>
    </div>
  );
}
