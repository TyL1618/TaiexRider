// 賽道資料型別。實際盤勢一律從 Supabase daily_map 即時抓（src/lib/dailyMap.ts），
// 經典模式用 classics.json 靜態策展資料（src/data/classics.ts）。
//
// 2026-07-18 前這裡曾內建 24 支股票的靜態樣本（2026-06-15 快照）且選股時「本地優先」，
// 導致最熱門的 24 支永遠玩到舊盤勢、其他股票才是新的——已整批移除，
// 抓不到資料時 UI 顯示需連線，不再退回過期快照。

export interface TrackData {
  label: string;         // 股號 / TAIEX
  name: string;          // 中文名稱
  kind: string;          // 'stock' | 'taiex' | 'classic'
  mode: "intraday" | "monthly" | "long";
  desc: string;          // 簡短描述
  prices: number[];
  subtitle?: string;     // 遊戲內 HUD 副標（經典模式用：期間・標的）
  classicId?: string;    // 經典關卡 id（用於提交紀錄保持者）
  // 伺服器算好的難度分數（daily_map.difficulty，見 scripts/fetchDailyMap.ts calcDifficulty）。
  // 賽道列表的星星就是讀這個值——GameCanvas 務必沿用同一個數字算 HUD 星星，
  // 不可自己重新用簡化公式算一次，否則列表跟進場後顯示的星等會對不起來（曾發生過真實 bug）。
  // 經典/長征模式沒有這個值（undefined），GameCanvas 會 fallback 本地簡化公式。
  difficulty?: number;
}
