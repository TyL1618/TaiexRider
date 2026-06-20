// 經典模式：歷史上著名的股市盤勢做成趣味關卡。靜態資料，永久內建、不更新。
// prices 由 scripts/fetchClassics.ts 從 Yahoo 歷史日線抓取 + 降採樣，metadata 一起策展。
import data from "./classics.json";
import type { TrackData } from "./tracks";

export interface ClassicLevel {
  id: string;      // 唯一 id
  index: string;   // 標的（加權指數 / 標普 500 …）
  title: string;   // 事件名（黑色星期一 …）
  period: string;  // 期間標籤（1987/10 …）
  blurb: string;   // 一兩句說明發生什麼
  prices: number[];
}

export const CLASSICS: ClassicLevel[] = data as ClassicLevel[];

// 轉成遊戲用 TrackData。HUD subtitle = 期間・標的；mode 用 monthly（日線語意，保留走勢圖切換）。
export function classicToTrack(c: ClassicLevel): TrackData {
  return {
    label: c.title,
    name: c.index,
    kind: "classic",
    mode: "monthly",
    desc: c.blurb,
    prices: c.prices,
    subtitle: `${c.period}・${c.index}`,
    classicId: c.id,
  };
}
