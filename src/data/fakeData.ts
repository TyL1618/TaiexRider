// Phase 1 假資料：用來驗證地形生成與機車手感，尚未接真實台股
// 刻意設計出各種地形：緩坡、陡升(漲停牆)、急跌(跳台)、連續抖動

// 一條「戲劇性」的手工序列，涵蓋多種地形特徵
export const SAMPLE_PRICES: number[] = [
  100, 101, 103, 102, 104, 107, 111, 115, 113, 112, // 緩升
  118, 124, 121, 119, 116, 108, 99, 92, 96, 101, // 一段急跌(跳台) → 回彈
  104, 110, 119, 128, 132, 130, 127, 129, 133, 138, // 強勢上攻(較陡)
  136, 131, 125, 130, 134, 132, 128, 124, 126, 129, // 高檔震盪
  127, 130, 128, 131, 129, 132, 130, 128, 131, 130, // 收斂盤整收尾
];

// 隨機漫步產生器：之後可用來大量測試不同波動度的賽道
export function randomWalk(
  points = 60,
  start = 100,
  volatility = 3,
  seed = Date.now(),
): number[] {
  // 簡單可重現的偽隨機 (mulberry32)
  let s = seed >>> 0;
  const rng = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out: number[] = [start];
  for (let i = 1; i < points; i++) {
    const step = (rng() - 0.5) * 2 * volatility;
    out.push(Math.max(1, out[i - 1] + step));
  }
  return out;
}
