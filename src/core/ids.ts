/** 8 碼隨機 id，跟舊版相同格式 */
export function uid8(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, "0");
}
