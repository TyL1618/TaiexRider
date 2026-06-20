// 每日長征：從當日全市場地圖隨機（seeded by date）挑 STOCK_COUNT 支，
// 各自正規化為「相對開盤」比值後串接，路段間用線性過渡連結。
// 同一天種子相同 → 全台玩家今天跑同一條長路。

import { fetchDailyMapList, fetchStockDailyMap, type DailyMapMeta } from "./dailyMap";

const STOCK_COUNT  = 5;
const CONNECTOR_PTS = 12; // 兩段之間的線性過渡點數

function seededRand(seed: number) {
  let s = seed | 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) | 0;
    return (s >>> 0) / 0x100000000;
  };
}

function dateToSeed(date: string): number {
  return date.split("-").reduce((acc, p) => acc * 10000 + parseInt(p, 10), 0);
}

function pickItems(pool: DailyMapMeta[], n: number, seed: number): DailyMapMeta[] {
  const rand  = seededRand(seed);
  const copy  = [...pool];
  const out: DailyMapMeta[] = [];
  while (out.length < n && copy.length > 0) {
    const i = Math.floor(rand() * copy.length);
    out.push(...copy.splice(i, 1));
  }
  return out;
}

// 各股正規化為「相對自身開盤價」比值（開盤 = 1.0），讓各段振幅可比、絕對股價無影響
function normalizeToRatio(prices: number[]): number[] {
  const base = prices[0] || 1;
  return prices.map((p) => p / base);
}

// 線性過渡銜接各段，跳過重複的端點
function joinSegments(segments: number[][]): number[] {
  if (segments.length === 0) return [];
  const out: number[] = [...segments[0]];
  for (let i = 1; i < segments.length; i++) {
    const tail = out[out.length - 1];
    const head = segments[i][0];
    for (let j = 1; j <= CONNECTOR_PTS; j++) {
      out.push(tail + (head - tail) * (j / CONNECTOR_PTS));
    }
    out.push(...segments[i].slice(1));
  }
  return out;
}

export interface LongTrackResult {
  prices: number[];
  labels: string[]; // 股票代號，用於 TrackData.name 顯示
}

const _cache = new Map<string, Promise<LongTrackResult | null>>();

export function fetchLongTrack(date: string): Promise<LongTrackResult | null> {
  if (!_cache.has(date)) _cache.set(date, _fetch(date));
  return _cache.get(date)!;
}

// 今日長征預覽：回傳那 5 隻的個股走勢（代號+名稱+prices），只供 UI 呈現走勢圖。
// 與 fetchLongTrack 同一組 seeded picks（所見即所騎）；fetchStockDailyMap 有快取，按下長征不會重抓。
export interface LongPick { code: string; name: string; prices: number[]; }

const _previewCache = new Map<string, Promise<LongPick[]>>();

export function fetchLongPreview(date: string): Promise<LongPick[]> {
  if (!_previewCache.has(date)) _previewCache.set(date, _preview(date));
  return _previewCache.get(date)!;
}

async function _preview(date: string): Promise<LongPick[]> {
  const pool = await fetchDailyMapList(date);
  if (pool.length === 0) return [];
  const picks = pickItems(pool, Math.min(STOCK_COUNT, pool.length), dateToSeed(date));
  const rows  = await Promise.all(picks.map((p) => fetchStockDailyMap(date, p.stock_code)));
  return picks
    .map((p, i) => ({ code: p.stock_code, name: p.stock_name, prices: rows[i]?.prices ?? [] }))
    .filter((x) => x.prices.length > 1);
}

async function _fetch(date: string): Promise<LongTrackResult | null> {
  const pool = await fetchDailyMapList(date);
  if (pool.length === 0) return null;

  const picks = pickItems(pool, Math.min(STOCK_COUNT, pool.length), dateToSeed(date));
  const rows  = await Promise.all(picks.map((p) => fetchStockDailyMap(date, p.stock_code)));

  const valid = picks
    .map((meta, i) => ({ meta, row: rows[i] }))
    .filter((x) => x.row !== null);

  if (valid.length === 0) return null;

  const segments = valid.map((x) => normalizeToRatio(x.row!.prices));
  return {
    prices: joinSegments(segments),
    labels: valid.map((x) => x.meta.stock_code),
  };
}
