// 可選賽道清單（Phase 2 預抓的真實樣本）。
// Phase 4 起會改成後端每日自動更新 + 快取，這裡先用打包進 build 的樣本。
import taiex from "./sample-TAIEX.json";
import s2330 from "./sample-2330.json";
import s0050 from "./sample-0050.json";
import s2454 from "./sample-2454.json";

export interface TrackData {
  label: string; // 顯示名（代號 / TAIEX）
  name: string; // 中文名
  kind: string; // 'stock' | 'taiex'
  mode: "intraday" | "monthly"; // 昨日盤線 | 近月日線
  desc: string; // 性格描述
  prices: number[];
}

export const TRACKS: TrackData[] = [
  { ...taiex, name: "加權指數", mode: "intraday", desc: "昨日盤中・平緩巡航" },
  { ...s2330, name: "台積電", mode: "monthly", desc: "近月日線・中等起伏" },
  { ...s0050, name: "元大台灣50", mode: "monthly", desc: "近月日線・中等起伏" },
  { ...s2454, name: "聯發科", mode: "monthly", desc: "近月日線・狂野跳台" },
];
