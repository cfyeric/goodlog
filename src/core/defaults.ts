import type { Category, Group, Settings } from "./types";
import { uid8 } from "./ids";
import { normRule } from "./recurrence";

export const PALETTE = ["#ea580c", "#16a34a", "#2563eb", "#9333ea", "#d97706", "#e11d48", "#0891b2", "#65a30d", "#57534e"];

export const DEFAULT_GROUP_ICON: Record<string, string> = {
  飲食: "utensils",
  交通: "bus",
  購物: "shopping-bag",
  娛樂: "mic-vocal",
  居家: "house",
  醫療: "hospital",
  個人: "user",
  收入: "wallet",
  其他: "ellipsis",
};

export const DEFAULT_ICON: Record<string, string> = {
  早餐: "croissant", 午餐: "utensils", 晚餐: "utensils-crossed", 咖啡: "coffee", 飲料: "cup-soda", 點心: "cookie", 食材: "carrot",
  捷運公車: "tram-front", 交通卡: "credit-card", 計程車: "car-taxi-front", 加油: "fuel", 停車: "square-parking", 高鐵: "train-front",
  日用品: "spray-can", 服飾: "shirt", "3C": "smartphone", 書籍: "book-open",
  影音: "clapperboard", 運動: "dumbbell", 旅遊: "plane", 聚會: "party-popper",
  房租: "house", 水電: "zap", 瓦斯: "flame", 電信: "phone", 網路: "wifi",
  看診: "stethoscope", 藥品: "pill", 保健: "heart-pulse",
  孝親: "hand-coins", 保險: "shield-check", 訂閱: "repeat", 其他: "ellipsis",
  薪資: "wallet", 獎金: "award", 投資: "trending-up", 副業: "briefcase", 其他收入: "circle-plus",
};

/** 新帳本的預設設定：兩個專案、一組常用類別 */
export function defaultSettings(id: () => string = uid8): Settings {
  const groups: Group[] = [];
  const categories: Category[] = [];
  const g = (name: string, color: string, names: string[], type: "expense" | "income" = "expense") => {
    const gr: Group = { id: "g" + id(), name, type, icon: DEFAULT_GROUP_ICON[name] || "tag", color };
    groups.push(gr);
    names.forEach((n) => categories.push({ id: id(), name: n, groupId: gr.id, group: name, color, icon: DEFAULT_ICON[n] || "", type: gr.type }));
  };
  g("飲食", PALETTE[0], ["早餐", "午餐", "晚餐", "咖啡", "飲料", "點心", "食材"]);
  g("交通", PALETTE[2], ["捷運公車", "交通卡", "計程車", "加油", "停車", "高鐵"]);
  g("購物", PALETTE[3], ["日用品", "服飾", "3C", "書籍"]);
  g("娛樂", PALETTE[5], ["影音", "運動", "旅遊", "聚會"]);
  g("居家", PALETTE[4], ["房租", "水電", "瓦斯", "電信", "網路"]);
  g("醫療", PALETTE[6], ["看診", "藥品", "保健"]);
  g("個人", PALETTE[8], ["孝親", "保險", "訂閱", "其他"]);
  g("收入", PALETTE[1], ["薪資", "獎金", "投資", "副業", "其他收入"], "income");
  return { projects: [{ id: id(), name: "個人開銷" }, { id: id(), name: "家庭開銷" }], cards: [], groups, categories };
}

/**
 * 把舊格式的設定補成目前的格式（不修改傳入的物件）：
 * 補上主類別、從舊帳戶轉出卡片、補空陣列、正規化排程規則。
 * changed 為 true 表示需要寫回資料庫。
 */
export function migrateSettings(input: Settings, id: () => string = uid8): { settings: Settings; changed: boolean } {
  const s: Settings = JSON.parse(JSON.stringify(input));
  if (!Array.isArray(s.categories)) s.categories = [];
  let changed = false;
  if (!Array.isArray(s.groups)) {
    s.groups = [];
    changed = true;
    let n = 0;
    s.categories.forEach((c) => {
      const nm = c.group || "其他";
      let g = s.groups.find((x) => x.type === c.type && x.name === nm);
      if (!g) {
        g = { id: "g" + (c.type === "income" ? "i" : "e") + n++, name: nm, type: c.type || "expense", icon: DEFAULT_GROUP_ICON[nm] || "tag", color: c.color || PALETTE[8] };
        s.groups.push(g);
      }
      c.groupId = g.id;
    });
  }
  s.categories.forEach((c) => {
    if (!c.groupId || !s.groups.some((g) => g.id === c.groupId)) {
      const nm = c.group || "其他";
      let g = s.groups.find((x) => x.type === c.type && x.name === nm);
      if (!g) {
        g = { id: "g" + id(), name: nm, type: c.type || "expense", icon: DEFAULT_GROUP_ICON[nm] || "tag", color: c.color || PALETTE[8] };
        s.groups.push(g);
      }
      c.groupId = g.id;
      changed = true;
    }
  });
  if (!Array.isArray(s.cards)) {
    s.cards = (s.accounts || []).filter((a) => /卡/.test(a.name) && a.name !== "信用卡").map((a) => ({ id: a.id, name: a.name }));
    changed = true;
  }
  if (!Array.isArray(s.aliases)) s.aliases = [];
  if (!Array.isArray(s.recurs)) s.recurs = [];
  s.recurs = s.recurs.map(normRule);
  if (!Array.isArray(s.projects)) s.projects = [];
  return { settings: s, changed };
}
