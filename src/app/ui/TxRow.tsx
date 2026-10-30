import type { Settings, Tx } from "../../core/types";
import { cardOf, findCategory, findProject, payOf, svParent } from "../../core/ledger";
import { formatMoney, net } from "../../core/money";
import { everyText } from "../../core/recurrenceText";
import { Seal } from "./Icon";
import { useOverlay } from "../editor/context";

const md = (d: string) => +d.slice(5, 7) + "/" + +d.slice(8, 10);

/** 記錄列表的一列；點了打開編輯 */
export function TxRow({ t, s, showDate }: { t: Tx; s: Settings; showDate?: boolean }) {
  const { openEditor, openTopup } = useOverlay();
  if (t.type === "transfer") {
    const sub: string[] = [];
    if (showDate) sub.push(md(t.date));
    sub.push((t.fromAcc ? "從 " + t.fromAcc + " " : "") + "轉入，不算支出");
    if (t.time && !showDate) sub.push(t.time);
    if (t.note && t.note !== t.name) sub.push(t.note);
    return (
      <button className="tx" onClick={() => openEditor({ tx: t })}>
        <Seal c={{ name: "存", icon: "piggy-bank", color: "#8A8F8B" }} />
        <span className="txm">
          <span className="n" style={{ display: "block" }}>{t.name || "轉到 " + (t.toAcc || "儲蓄帳戶")}</span>
          <span className="s" style={{ display: "block" }}>{sub.join(" · ")}</span>
        </span>
        <span className="txr">
          <span className="amt t">{formatMoney(+t.amount || 0)}</span>
          <span className="chips">{t.toAcc ? <span className="chip">{t.toAcc}</span> : null}</span>
        </span>
      </button>
    );
  }
  if (t.type === "topup") {
    const sv = cardOf(s, t);
    const pc = svParent(s, sv);
    const sub: string[] = [];
    if (showDate) sub.push(md(t.date));
    sub.push((pc ? "從 " + pc.name + " " : "") + "加值，不算支出");
    if (t.note) sub.push(t.note);
    return (
      <button className="tx" onClick={() => openTopup({ id: t.id, m: t.date.slice(0, 7), cardId: t.cardId || "", amount: String(t.amount), date: t.date, note: t.note || "" })}>
        <Seal c={{ name: "加值", icon: "arrow-down-to-line", color: "#8A8F8B" }} />
        <span className="txm">
          <span className="n" style={{ display: "block" }}>{(sv ? sv.name : "儲值卡") + " 加值"}</span>
          <span className="s" style={{ display: "block" }}>{sub.join(" · ")}</span>
        </span>
        <span className="txr">
          <span className="amt t">+{formatMoney(+t.amount || 0)}</span>
          <span className="chips">{pc ? <span className="chip">{pc.name}</span> : null}</span>
        </span>
      </button>
    );
  }
  const c = findCategory(s, t.catId);
  const p = findProject(s, t.projectId);
  const title = t.name || (c ? c.name : "未分類");
  const sub: string[] = [];
  if (showDate) sub.push(md(t.date));
  if (t.name && c) sub.push(c.name);
  if (t.inst) sub.push("分期 " + t.inst.i + "/" + t.inst.n);
  if (t.rec) {
    const r = (s.recurs || []).find((x) => x.id === t.rec!.id);
    sub.push((r ? everyText(r) : "週期") + " #" + t.rec.i);
  }
  if (t.merchant) sub.push(t.merchant);
  if (t.time && !showDate) sub.push(t.time);
  if (t.tags && t.tags.length) sub.push(t.tags.map((x) => "#" + x).join(" "));
  const inc = t.type === "income";
  return (
    <button className="tx" onClick={() => openEditor({ tx: t })}>
      <Seal c={c} s={s} />
      <span className="txm">
        <span className="n" style={{ display: "block" }}>{title}</span>
        <span className="s" style={{ display: "block" }}>{sub.join(" · ")}</span>
      </span>
      <span className="txr">
        <span className={"amt " + (inc ? "i" : "e")}>{(inc ? "+" : "−") + formatMoney(net(t))}</span>
        <span className="chips">
          {p ? <span className="chip proj">{p.name}</span> : null}
          {t.type === "expense" ? <span className="chip">{payOf(s, t) === "card" ? cardOf(s, t)?.name || "信用卡" : "現金"}</span> : null}
        </span>
      </span>
    </button>
  );
}
