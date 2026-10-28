import type { CSSProperties } from "react";
import type { Category, Group, Settings } from "../../core/types";
import { DEFAULT_ICON } from "../../core/defaults";
import { findGroup } from "../../core/ledger";
import { I, ICON_NODES, type IconNode } from "./iconData";

declare global {
  interface Window {
    lucide?: { icons?: Record<string, IconNode> };
  }
}

const pascal = (n: string) =>
  n
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");

/** 找圖示節點：內建的、已載入的 Lucide 完整圖示庫、或自訂節點 */
export function nodeFor(name: string | null | undefined, fallback?: unknown): IconNode | null {
  if (!name) return null;
  return ICON_NODES[name] || window.lucide?.icons?.[pascal(name)] || (Array.isArray(fallback) ? (fallback as IconNode) : null);
}

/** 用 Lucide 節點畫的 SVG 圖示 */
export function Svg({ node }: { node: IconNode | null | undefined }) {
  if (!Array.isArray(node)) return null;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {node.map(([tag, attrs], i) => {
        const T = String(tag).replace(/[^a-z]/g, "") as "path";
        const a: Record<string, string> = {};
        for (const [k, v] of Object.entries(attrs || {})) a[k.replace(/[^a-zA-Z-]/g, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v);
        return <T key={i} {...a} />;
      })}
    </svg>
  );
}

/** 內建圖示（名稱見 iconData 的 ICON_NODES） */
export function Ic({ name }: { name: string }) {
  return <Svg node={ICON_NODES[name]} />;
}

/** 介面固定圖示（首頁、左右箭頭等），內容是程式內建的 SVG 字串 */
export function UiIcon({ name }: { name: keyof typeof I }) {
  return <span style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: I[name] }} />;
}

export function iconName(c: { icon?: string; name?: string } | null | undefined): string | null {
  if (!c || c.icon === "none") return null;
  return c.icon || (c.name ? DEFAULT_ICON[c.name] : null) || null;
}

/** 類別顏色：用主類別的顏色，沒有就用自己的 */
export function colorOf(s: Settings | null, c: Partial<Category & Group> | null | undefined): string {
  if (!c) return "#8A8F8B";
  if (c.groupId && s) {
    const g = findGroup(s, c.groupId);
    if (g && g.color) return g.color;
  }
  return c.color || "#8A8F8B";
}

export interface SealLike {
  name?: string;
  icon?: string;
  color?: string;
  groupId?: string;
  iconNode?: unknown;
}

/** 類別、帳戶、專案前面的圓角方塊圖示 */
export function Seal({ c, s, sm, lg }: { c: SealLike | null | undefined; s?: Settings | null; sm?: boolean; lg?: boolean }) {
  const color = colorOf(s || null, c as Partial<Category>);
  const nm = iconName(c);
  const node = nm ? nodeFor(nm, c?.iconNode) : null;
  return (
    <span className={"seal" + (sm ? " sm" : "") + (lg ? " xl" : "")} style={{ "--c": color } as CSSProperties} aria-hidden="true">
      {node ? <Svg node={node} /> : c ? (c.name || "？").slice(0, 1) : "？"}
    </span>
  );
}
