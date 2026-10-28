import { defineConfig } from "vitest/config";

// 日期計算用本地時間；測試固定用台灣時區，結果才會跟舊版一致
process.env.TZ = "Asia/Taipei";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
