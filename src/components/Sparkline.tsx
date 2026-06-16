import { useId } from "react";
import { COLOR } from "../game/constants";

// 迷你走勢圖（SVG）：依「末值 vs 首值」上色（漲紅/跌綠，台股慣例），含面積漸層。
// 用於隨機拉霸結果視窗與每日挑戰頁的今日地圖預覽。
export default function Sparkline({
  prices,
  width = 300,
  height = 130,
}: {
  prices: number[];
  width?: number;
  height?: number;
}) {
  const gid = useId();
  if (prices.length < 2) return null;

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const pad = 8;
  const x = (i: number) => pad + (i / (prices.length - 1)) * (width - 2 * pad);
  const y = (p: number) => pad + (1 - (p - min) / span) * (height - 2 * pad);

  const up = prices[prices.length - 1] >= prices[0];
  const line = up ? COLOR.trackUp : COLOR.trackDown;

  const pts = prices.map((p, i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(" ");
  const area = `${x(0).toFixed(1)},${height - pad} ${pts} ${x(prices.length - 1).toFixed(1)},${height - pad}`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={line} stopOpacity="0.35" />
          <stop offset="100%" stopColor={line} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gid})`} />
      <polyline
        points={pts}
        fill="none"
        stroke={line}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 4px ${line})` }}
      />
    </svg>
  );
}
