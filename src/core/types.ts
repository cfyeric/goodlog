/**
 * 好記的資料格式。
 *
 * 這些型別描述的是「目前雲端資料庫裡已經存在的格式」，跟舊版單檔網頁（legacy/）完全相同。
 * 新版只能沿用、不能改名或改結構，否則使用者現有的帳本會讀不到。
 * 要新增欄位可以，但一律設成選填（?），舊資料沒有這個欄位也要能正常運作。
 *
 * 資料庫路徑：
 *   data/users/<uid>/settings                 → Settings（一份文件）
 *   data/users/<uid>/settings/months/<YYYY-MM> → { items: Tx[] }（每個月一份文件）
 */

/** 日期字串 YYYY-MM-DD（本地時間，不含時區） */
export type DateStr = string;
/** 月份字串 YYYY-MM */
export type MonthKey = string;

export type TxType = "expense" | "income" | "transfer" | "topup";
export type PayMethod = "cash" | "card";

/** 一筆記錄 */
export interface Tx {
  id: string;
  type: TxType;
  date: DateStr;
  /** HH:MM */
  time?: string;
  amount: number;
  /** 手續費（支出加上去、收入扣掉） */
  fee?: number;
  /** 折扣（只對支出有效） */
  discount?: number;
  catId?: string | null;
  projectId?: string;
  /** 付款方式；沒有這個欄位的舊資料用 accountId 判斷 */
  pay?: PayMethod;
  cardId?: string;
  /** 很早期版本的帳戶欄位，只讀不寫 */
  accountId?: string;
  name?: string;
  merchant?: string;
  note?: string;
  tags?: string[];
  invoice?: string;
  /** 提醒入帳：還沒確認，不算進任何統計 */
  pending?: boolean;
  /** 由週期規則產生：規則 id 和第幾期 */
  rec?: { id: string; i: number };
  /** 由分期規則產生 */
  inst?: { id: string; i: number; n: number; total?: number };
  /** 資料來源，例如 "moze" 表示從 MOZE 匯入 */
  src?: string;
  /** 轉帳（type "transfer"）轉入的帳戶名稱，例如儲蓄帳戶；轉帳不算支出也不算收入 */
  toAcc?: string;
  /** 轉帳轉出的帳戶名稱 */
  fromAcc?: string;
}

export interface MonthDoc {
  items: Tx[];
}

/** 所有月份，key 是 YYYY-MM */
export type Months = Record<MonthKey, MonthDoc>;

export interface Budget {
  budget?: number;
  /** month：每月重新計算；total：全部期間累計 */
  bper?: "month" | "total";
}

export interface Card extends Budget {
  id: string;
  name: string;
  archived?: boolean;
  /** 有值表示這張是悠遊卡（儲值卡），值是負責加值的信用卡 id */
  svOf?: string;
  /** 使用者填的卡上餘額 */
  svInit?: number;
  /** svInit 是哪一天填的；餘額從這天之後開始推算 */
  svDate?: DateStr;
  /** 匯入帳單時記住的欄位對應（存的是欄位標題文字） */
  csvMap?: { date: string; desc: string; amount: string };
}

export interface Project extends Budget {
  id: string;
  name: string;
  archived?: boolean;
}

export interface Group {
  id: string;
  name: string;
  type: "expense" | "income";
  icon?: string;
  color?: string;
  hidden?: boolean;
  /** 完整圖示庫的圖示形狀（內建圖示沒有的才存） */
  iconNode?: unknown;
}

export interface Category {
  id: string;
  name: string;
  type: "expense" | "income";
  groupId: string;
  /** 舊格式的主類別名稱，保留做相容 */
  group?: string;
  icon?: string;
  /** 自訂圖示的 SVG 節點 */
  iconNode?: unknown;
  color?: string;
  hidden?: boolean;
}

/** 早期版本的帳戶，只用來相容舊資料 */
export interface LegacyAccount {
  id: string;
  name: string;
  init?: number;
}

/** 帳單比對學到的商家對照 */
export interface Alias {
  id: string;
  key: string;
  desc: string;
  catId: string;
  name?: string;
  merchant?: string;
}

export type RuleKind = "recur" | "inst" | "once";
export type RuleUnit = "day" | "week" | "month" | "year";
/** now：立即入帳；due：到期自動入帳；remind：到期先列為待入帳 */
export type PostMode = "now" | "due" | "remind";
export type WorkdayMode = "same" | "after" | "before";

export interface PlanRow {
  amount: number;
  fee: number;
  discount: number;
  interest: number;
}

/** 週期、分期、單次排程規則 */
export interface Rule {
  id: string;
  kind?: RuleKind;
  every?: number;
  unit?: RuleUnit;
  /** 很早期版本的 unit */
  freq?: RuleUnit;
  /** 每月或每年的第幾號 */
  dom?: number | null;
  /** 每年的幾月 */
  moy?: number | null;
  /** 每週的星期幾（0 = 週日） */
  dow?: number | string | null;
  /** 每日週期限定的星期（0 = 週日） */
  wdays?: number[] | null;
  /** 舊格式：true 表示只有平日 */
  weekdays?: boolean;
  workday?: WorkdayMode;
  post?: PostMode;
  postDate?: DateStr;
  start: DateStr;
  startIdx?: number;
  /** 0 或沒有表示無限期 */
  count?: number;
  /** 已經到期、記好的期數 */
  done?: number;
  /** 分期寬限月數 */
  grace?: number;
  /** 每一期記錄的範本 */
  tpl: Partial<Tx>;
  /** 分期總額 */
  total?: number;
  /** 分期每期金額 */
  plan?: PlanRow[];
  /** 很早期版本轉換來的規則，記錄 id 規則不同 */
  legacy?: boolean;
}

export interface Settings {
  categories: Category[];
  groups: Group[];
  projects: Project[];
  cards: Card[];
  aliases?: Alias[];
  recurs?: Rule[];
  accounts?: LegacyAccount[];
  cashBudget?: Budget;
  cardBudget?: Budget;
  /** 帳單裡的卡片區段 → 卡片 id */
  stmtSec?: Record<string, string>;
}

/** 整本帳本：核心邏輯的輸入 */
export interface Ledger {
  settings: Settings;
  months: Months;
}
