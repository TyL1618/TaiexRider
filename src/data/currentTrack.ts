// 目前載入的賽道資料來源。
// Phase 2：先用腳本預抓的真實台股樣本（2330 台積電近 3 個月）驗證手感。
// Phase 3 起會改成可切換模式（每日大盤 / 個股 / 經典）並接快取。
import sample2330 from "./sample-2330.json";

export const CURRENT_PRICES: number[] = sample2330.prices;
export const CURRENT_LABEL = `${sample2330.stockNo}`;
