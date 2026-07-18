// 排行榜分組用的當日 key（本地時區 YYYY-MM-DD）。
// 一律用本地日期組字串，不可用 toISOString()（UTC，午夜前後會差一天）。
export function dailyKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
