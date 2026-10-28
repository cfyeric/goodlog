import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" 讓打包後的檔案用相對路徑引用，發佈到 claude.ai 網頁時才找得到 JS 和 CSS
export default defineConfig({
  base: "./",
  plugins: [react()],
});
