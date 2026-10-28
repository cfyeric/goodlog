/** 排程規則的文字說明（顯示在編輯畫面和週期排程清單） */
import type { DateStr, PostMode, Rule, RuleUnit, WorkdayMode } from "./types";
import { recurStart, wdSet, type Interest, type ScheduleMode } from "./recurrence";

export const UNIT_TEXT: Record<RuleUnit, string> = { day: "日", week: "週", month: "月", year: "年" };
export const POST_TEXT: Record<PostMode, string> = { now: "立即入帳", due: "延後入帳", remind: "提醒入帳" };
export const POST_HINT: Record<PostMode, string> = {
  now: "存檔時一次記好所有期數",
  due: "到了日期才自動入帳",
  remind: "到了日期先列在「待入帳」，確認後才算",
};
export const WORKDAY_TEXT: Record<WorkdayMode, string> = { same: "依原日期", after: "延後", before: "提前" };
export const INTEREST_TEXT: Record<Interest, string> = {
  none: "無利息",
  annuity: "本息均攤",
  principal: "本金均攤",
  fixed: "固定利息",
  interestFirst: "先息後本",
};
export const ROUNDING_TEXT = { default: "預設", round: "四捨五入", ceil: "無條件進位", floor: "無條件捨去" } as const;

const WDN = ["日", "一", "二", "三", "四", "五", "六"];
const WEEKDAY_FULL = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];

/** 星期組合的說明，例如「平日（週一到週五）」「週一、三」 */
export function wdText(a: number[]): string {
  return a.join() === "1,2,3,4,5" ? "平日（週一到週五）" : a.join() === "6,0" ? "週末" : "週" + a.map((d) => WDN[d]).join("、");
}

type Mode = Partial<Rule> & Partial<ScheduleMode>;

/** 週期說明，例如「每月 25 號」「每 2 週（週三）」「每個平日（週一到週五）」 */
export function everyText(m: Mode): string {
  const n = +(m.every ?? 1) || 1;
  const u: RuleUnit = m.unit || m.freq || "month";
  const ws = u === "day" && wdSet(m);
  if (ws) return n === 1 ? "每個" + wdText(ws) : "每 " + n + " 個" + wdText(ws) + "的日子";
  const base = n === 1 ? "每" + UNIT_TEXT[u] : "每 " + n + " " + (u === "month" ? "個月" : UNIT_TEXT[u]);
  if (u === "month" && m.dom) return base + " " + m.dom + " 號";
  if (u === "week" && m.dow != null && m.dow !== "") return base + "（" + WEEKDAY_FULL[+m.dow] + "）";
  if (u === "year" && m.dom && m.moy) return base + " " + m.moy + "/" + m.dom;
  return base;
}

const md = (d: DateStr) => +d.slice(5, 7) + "/" + +d.slice(8, 10);

/** 排程摘要，例如「每月 25 號 · 無限期 · 延後入帳」 */
export function schedText(m: Mode | null | undefined): string {
  const pdT =
    m && m.postDate && m.post && m.post !== "now" ? " · " + md(m.postDate) + (m.kind === "once" ? "" : " 起") : "";
  if (!m || m.kind === "once") return "單次" + (m && m.post && m.post !== "now" ? " · " + POST_TEXT[m.post] : "") + pdT;
  if (m.kind === "inst")
    return (
      "分期 " +
      (m.instN || m.count) +
      " 期 · " +
      everyText(m) +
      (m.interest && m.interest !== "none" ? " · " + INTEREST_TEXT[m.interest] + " " + (+(m.rate ?? 0) || 0) + "%" : "") +
      (m.grace ? " · 寬限 " + m.grace + " 個月" : "") +
      " · " +
      POST_TEXT[m.post || "now"]
    );
  return (
    everyText(m) +
    pdT +
    " · " +
    (m.count ? m.count + " 次" : "無限期") +
    ((m.startIdx || 1) > 1 ? " · 從第 " + m.startIdx + " 期" : "") +
    " · " +
    POST_TEXT[m.post || "due"] +
    (m.workday && m.workday !== "same" ? " · 遇週末" + WORKDAY_TEXT[m.workday] : "")
  );
}

/** 編輯畫面上的一句話說明 */
export function recurHint(m: Mode, d: DateStr): string {
  const st = recurStart(m, d);
  const p = m.post || "now";
  return (
    everyText(m) +
    "記一筆，從 " +
    md(st) +
    " 開始；" +
    (p === "now"
      ? m.count
        ? "存檔時一次記好全部 " + (m.count - (m.startIdx || 1) + 1) + " 筆"
        : "到期自動入帳，下一筆會先排進日曆"
      : p === "due"
        ? "到了日期才自動入帳"
        : "到了日期先列在「待入帳」") +
    "。"
  );
}
