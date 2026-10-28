/** 畫面導覽狀態：目前在哪一頁、選了哪一天、哪個月等（不存到資料庫） */
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { ymd } from "../core/dates";

export type View = "home" | "acc" | "proj" | "report" | "settings" | "cats" | "subcats";
export type ReportTab = "overview" | "cat" | "rank" | "acc" | "proj";

export interface Nav {
  view: View;
  /** 日曆選取的日期 */
  sel: string;
  /** 日曆顯示的月份 */
  ym: string;
  /** 帳戶頁、專案頁顯示的月份 */
  payYm: string;
  accSel: string | null;
  accSet: string | null;
  projSel: string | null;
  projSet: string | null;
  rMode: "week" | "month" | "year";
  rAnchor: string;
  rTab: ReportTab;
  rType: "expense" | "income";
  rDrill: string | null;
  rSub: string | null;
  rKey: string | null;
  /** 明細金額由小到大排序 */
  rAsc: boolean;
  /** 排行顯示全部（預設只顯示前 50 筆） */
  rRankAll: boolean;
  /** 使用者關掉的繳費提醒內容 */
  remDismiss: string | null;
  /** 正在確認刪除的項目（第二次按才真的刪） */
  armed: string | null;
  /** 類別管理：支出或收入、正在看哪個主類別 */
  catType: "expense" | "income";
  catGroup: string | null;
}

const today = ymd(new Date());
export const initialNav: Nav = {
  view: "home",
  sel: today,
  ym: today.slice(0, 7),
  payYm: today.slice(0, 7),
  accSel: null,
  accSet: null,
  projSel: null,
  projSet: null,
  rMode: "month",
  rAnchor: today,
  rTab: "overview",
  rType: "expense",
  rDrill: null,
  rSub: null,
  rKey: null,
  rAsc: false,
  rRankAll: false,
  remDismiss: null,
  armed: null,
  catType: "expense",
  catGroup: null,
};

interface NavCtx {
  nav: Nav;
  /** 更新部分導覽狀態 */
  go: (patch: Partial<Nav> | ((n: Nav) => Partial<Nav>)) => void;
  /** 切換到某一頁（離開時清掉帳戶、專案的選取狀態，並捲回頂端） */
  view: (v: View) => void;
  /** 第一次按回傳 false（進入確認狀態），第二次按同一個 key 回傳 true */
  arm: (key: string) => boolean;
}

const Ctx = createContext<NavCtx | null>(null);

export function useNav(): NavCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useNav 要在 NavProvider 裡使用");
  return v;
}

export function NavProvider({ children, initial }: { children: ReactNode; initial?: Partial<Nav> }) {
  const [nav, setNav] = useState<Nav>({ ...initialNav, ...initial });
  const go = useCallback<NavCtx["go"]>((patch) => setNav((n) => ({ ...n, ...(typeof patch === "function" ? patch(n) : patch) })), []);
  const view = useCallback((v: View) => {
    setNav((n) => (n.view === v ? n : { ...n, view: v, accSel: null, accSet: null, projSel: null, projSet: null, armed: null }));
    window.scrollTo(0, 0);
  }, []);
  const arm = useCallback(
    (key: string) => {
      if (nav.armed === key) {
        setNav((n) => ({ ...n, armed: null }));
        return true;
      }
      setNav((n) => ({ ...n, armed: key }));
      return false;
    },
    [nav.armed],
  );
  return <Ctx.Provider value={{ nav, go, view, arm }}>{children}</Ctx.Provider>;
}
