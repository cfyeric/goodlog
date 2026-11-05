import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" 讓打包後的檔案用相對路徑引用，發佈到 claude.ai 網頁時才找得到 JS 和 CSS
export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [react()],
  build: {
    rollupOptions: {
      // 一般網站（--mode web）把不常用的畫面拆成另外的檔案，點進去才下載；
      // claude.ai 網頁要整理成單一 HTML 檔，所以全部包在一起
      output: mode === "web" ? {} : { inlineDynamicImports: true },
    },
  },
}));
