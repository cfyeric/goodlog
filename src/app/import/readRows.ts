import { decodeText, parseCSV } from "../../core/statement";
import { loadScript } from "../ui/loadScript";

const XLSX_URL = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";

declare global {
  interface Window {
    XLSX?: {
      read(buf: ArrayBuffer, o: object): { SheetNames: string[]; Sheets: Record<string, unknown> };
      utils: { sheet_to_json(sh: unknown, o: object): unknown[][] };
    };
  }
}


/** 讀檔成表格列：Excel 用 SheetJS、網頁檔讀 <table>、其餘當 CSV */
export async function readRows(file: File): Promise<string[][]> {
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
