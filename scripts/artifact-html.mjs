/**
 * 把 vite build 的結果（dist/）整理成可以發佈到 claude.ai 網頁的單一 HTML 檔（dist-artifact/index.html）：
 * - claude.ai 發佈時會自動包上 <!doctype html><head><body>，所以拿掉這些外層標籤
 * - JS 和 CSS 直接內嵌，不依賴另外的檔案路徑
 * 用法：npm run build:artifact
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
let html = fs.readFileSync(path.join(dist, "index.html"), "utf8");

const read = (src) => fs.readFileSync(path.join(dist, src.replace(/^\.\//, "")), "utf8");
html = html.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_, href) => `<style>${read(href)}</style>`);
html = html.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g, (_, src) => `<script type="module">${read(src).replace(/<\/script/gi, "<\\/script")}</script>`);

const head = (html.match(/<head>([\s\S]*?)<\/head>/) || [, ""])[1]
  .replace(/<meta charset[^>]*>/i, "")
  .replace(/<meta name="viewport"[^>]*>/i, "");
const body = (html.match(/<body>([\s\S]*?)<\/body>/) || [, ""])[1];
// 模組腳本要放在 #root 之後，畫面才找得到掛載點
const scripts = [];
const headNoScript = head.replace(/<script type="module">[\s\S]*?<\/script>/g, (m) => (scripts.push(m), ""));
const out = headNoScript.trim() + "\n" + body.trim() + "\n" + scripts.join("\n") + "\n";

fs.mkdirSync(path.join(root, "dist-artifact"), { recursive: true });
fs.writeFileSync(path.join(root, "dist-artifact/index.html"), out);
console.log("dist-artifact/index.html", (out.length / 1024).toFixed(0) + " KB");
