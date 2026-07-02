// 產生社群分享預覽圖 public/og-image.png（1200×630，OG/Twitter Card 標準尺寸）
// 跑一次 commit PNG 即可：node scripts/genOgImage.mjs
// 視覺：深色霓虹 + K 棒地形折線 + 騎士標題（與遊戲 boot splash 同語彙）
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(__dirname, "../public/og-image.png");

// 手繪一段「跌深反彈」K 棒地形折線（紅漲綠跌，遊戲核心意象）
const pts = [
  [0, 340], [90, 300], [180, 360], [270, 250], [360, 420], [450, 380],
  [540, 500], [630, 430], [720, 470], [810, 330], [900, 370], [990, 240], [1080, 290], [1200, 200],
];
const polyline = pts.map(([x, y]) => `${x},${y}`).join(" ");
// 每段依方向著色（上=紅 下=綠，y 越小越高）
const segs = pts.slice(0, -1).map(([x1, y1], i) => {
  const [x2, y2] = pts[i + 1];
  const col = y2 < y1 ? "#ff2244" : "#00ff88";
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="6" stroke-linecap="round"/>`;
}).join("\n");

const svg = `
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(45,226,230,0.16)"/>
      <stop offset="100%" stop-color="rgba(45,226,230,0)"/>
    </linearGradient>
    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="10" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="1200" height="630" fill="#05080f"/>
  <!-- 背景網格 -->
  <g stroke="rgba(45,226,230,0.07)" stroke-width="1">
    ${Array.from({ length: 30 }, (_, i) => `<line x1="${i * 40}" y1="0" x2="${i * 40}" y2="630"/>`).join("")}
    ${Array.from({ length: 16 }, (_, i) => `<line x1="0" y1="${i * 40}" x2="1200" y2="${i * 40}"/>`).join("")}
  </g>
  <!-- 地形填滿 + 折線 -->
  <polygon points="${polyline} 1200,630 0,630" fill="url(#fill)"/>
  <g filter="url(#glow)">${segs}</g>
  <!-- 標題 -->
  <g filter="url(#glow)">
    <text x="600" y="150" text-anchor="middle" font-family="Segoe UI, system-ui, sans-serif"
      font-size="104" font-weight="800" letter-spacing="14" fill="#2de2e6">TAIEX RIDER</text>
  </g>
  <text x="600" y="225" text-anchor="middle" font-family="Segoe UI, Microsoft JhengHei, sans-serif"
    font-size="40" letter-spacing="10" fill="#cdd9e5">把台股走勢騎成霓虹賽道</text>
  <text x="600" y="590" text-anchor="middle" font-family="Segoe UI, system-ui, sans-serif"
    font-size="26" letter-spacing="4" fill="#5c6b7a">taiexrider.pages.dev・每日跟著大盤換新賽道</text>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile(out);
console.log("✅ og-image.png 已產生:", out);
