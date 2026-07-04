// 匿名玩家身分（Phase 4 排行榜 MVP）：裝置 UUID + 可編輯暱稱，存 localStorage。
// 不做 Google 登入（延後）。見 DEVDOC §11。

const ID_KEY = "taiex_player_id";
export const NAME_KEY = "taiex_player_name";

export function getPlayerId(): string {
  let id = localStorage.getItem(ID_KEY);
  if (!id) {
    id = crypto.randomUUID
      ? crypto.randomUUID()
      : `p_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(ID_KEY, id);
  }
  return id;
}

export function getPlayerName(): string {
  let n = localStorage.getItem(NAME_KEY);
  if (!n) {
    n = `Rider${Math.floor(1000 + Math.random() * 9000)}`;
    localStorage.setItem(NAME_KEY, n);
  }
  return n;
}

// 暱稱長度以「顯示寬度」計：全形（中日韓/全形符號）=2、英數=1，上限 12 寬
// → 約 6 個中文 或 12 個英文，避免排行榜名字過長撐成兩排。
const WIDE_CHAR =
  /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;

export const NAME_MAX_WIDTH = 12;

export function nameWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += WIDE_CHAR.test(ch) ? 2 : 1;
  return w;
}

// 依顯示寬度截斷（不切壞 surrogate pair；for..of 走 code point）
export function clampNameWidth(s: string, max = NAME_MAX_WIDTH): string {
  let w = 0, out = "";
  for (const ch of s) {
    const cw = WIDE_CHAR.test(ch) ? 2 : 1;
    if (w + cw > max) break;
    w += cw;
    out += ch;
  }
  return out;
}

export function setPlayerName(name: string): void {
  localStorage.setItem(NAME_KEY, clampNameWidth(name.trim()) || getPlayerName());
}

// 登出時呼叫：清掉本地暱稱快取（不分帳號的裝置級 key），下次 getPlayerName()
// 會重新產生訪客用的隨機 Rider####，避免上一個帳號的暱稱殘留給下一個登入者看到。
export function resetPlayerName(): void {
  try { localStorage.removeItem(NAME_KEY); } catch { /* 靜默 */ }
}
