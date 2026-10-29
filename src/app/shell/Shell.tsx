import { useEffect } from "react";
import { addDays, pd } from "../../core/dates";
import { findCategory } from "../../core/ledger";
import { formatMoney, net } from "../../core/money";
import { remindList, reminderSignature, REMIND_DAYS } from "../../core/reminders";
import { useApp } from "../state";
import { useNav, type View } from "../nav";
import { useOverlay } from "../editor/context";
import { Ic, UiIcon } from "../ui/Icon";

/** 頁面最上方：唯讀或範例資料的說明 */
export function Banner() {
  const { mode } = useApp();
  if (mode === "readonly")
    return (
      <div className="banner">
        <b>目前為唯讀</b>：你沒有寫入這個帳本的權限。
      </div>
    );
  if (mode === "demo")
    return (
      <div className="banner">
        <b>範例資料</b>：目前顯示的是範例資料，不是你的帳本，變更也不會保存。
      </div>
    );
  return null;
}

/** 入帳提醒：已到期的待入帳，和 7 天內到期的提醒入帳 */
export function RemindBar() {
  const { ledger, today } = useApp();
  const { nav, go } = useNav();
  const { editor, openEditor } = useOverlay();
  if (!ledger || editor) return null;
  const L = remindList(ledger, today);
  if (!L.length) return null;
  const sig = reminderSignature(L);
  if (nav.remDismiss === sig) return null;
  const td = pd(today).getTime();
  const dd = (d: string) => Math.round((pd(d).getTime() - td) / 864e5);
  const md = (d: string) => +d.slice(5, 7) + "/" + +d.slice(8, 10);
  const nDue = L.filter((x) => x.due).length;
  return (
    <div className="rmbar" role="status">
      <div className="rmhd">
        <Ic name="bell" />
        <b>入帳提醒</b>
        <small>
          {nDue ? nDue + " 筆待入帳" : ""}
          {nDue && L.length > nDue ? "、" : ""}
          {L.length > nDue ? L.length - nDue + " 筆 " + REMIND_DAYS + " 天內到期" : ""}
        </small>
        <button className="rmx" aria-label="先關掉提醒" onClick={() => go({ remDismiss: sig })}>
          <UiIcon name="x" />
        </button>
      </div>
      {L.slice(0, 3).map((x) =>
        x.due ? (
          <div className="rmrow due" key={"t" + x.t.id}>
            <span className="rmn">
              {x.t.name || findCategory(ledger.settings, x.t.catId)?.name || "未分類"}
              <small>
                {dd(x.date) === 0 ? "今天到期" : "已到期 " + md(x.date)} · {formatMoney(net(x.t))}
              </small>
            </span>
            <button className="btn sm primary" onClick={() => openEditor({ tx: x.t, confirmPending: true })}>
              入帳
            </button>
          </div>
        ) : (
          <div className="rmrow" key={"r" + x.rule.id + x.date}>
            <span className="rmn">
              {x.name}
              <small>
                {md(x.date)} 到期（{dd(x.date)} 天後）{x.amt != null ? " · 約 " + formatMoney(x.amt) : ""}
              </small>
            </span>
          </div>
        ),
      )}
      {L.length > 3 ? <div className="rmmore">還有 {L.length - 3} 筆，到日曆的「待入帳」查看</div> : null}
    </div>
  );
}

/** 底部選單；中間按鈕在日曆頁是「記一筆」，其他頁是「回到日曆」 */
export function TabBar() {
  const { nav, view } = useNav();
  const { ledger } = useApp();
  const { openEditor } = useOverlay();
  const cur: View = nav.view === "cats" || nav.view === "subcats" ? "settings" : nav.view;
  const home = cur === "home";
  const tab = (v: View, label: string, icon: React.ReactNode) => (
    <button className={"tab" + (cur === v ? " on" : "")} aria-current={cur === v ? "page" : "false"} onClick={() => view(v)}>
      {icon}
      <span>{label}</span>
    </button>
  );
  return (
    <nav className="tabbar" aria-label="主選單">
      <div className="in">
        {tab("acc", "帳戶", <Ic name="wallet" />)}
        {tab("proj", "專案", <Ic name="briefcase" />)}
        <button
          className={"fab" + (home ? "" : " cal")}
          aria-label={home ? "記一筆" : "回到日曆"}
          onClick={() => (home ? ledger && openEditor({ tx: null, date: nav.sel }) : view("home"))}
        >
          {home ? <UiIcon name="plus" /> : <Ic name="calendar" />}
        </button>
        {tab("report", "報表", <UiIcon name="chart" />)}
        {tab("settings", "設定", <UiIcon name="gear" />)}
      </div>
    </nav>
  );
}

export function Toast() {
  const { toastMsg } = useApp();
  return (
    <div className="toast" hidden={!toastMsg} role="status">
      {toastMsg}
    </div>
  );
}

/** 今天換日時，原本停在舊的今天就一起移到新的今天 */
export function useFollowToday() {
  const { today } = useApp();
  const { go } = useNav();
  useEffect(() => {
    go((n) => {
      const old = addDays(today, -1);
      return n.sel === old ? { sel: today, ym: today.slice(0, 7) } : {};
    });
  }, [today, go]);
}

/** 點到其他地方時，取消「再按一次確認刪除」的狀態 */
export function useDisarmOnClick() {
  const { nav, go } = useNav();
  useEffect(() => {
    if (!nav.armed) return;
    const h = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-armable]")) go({ armed: null });
    };
    document.addEventListener("click", h, true);
    return () => document.removeEventListener("click", h, true);
  }, [nav.armed, go]);
}
