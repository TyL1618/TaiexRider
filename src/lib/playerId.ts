// 匿名玩家身分（Phase 4 排行榜 MVP）：裝置 UUID + 可編輯暱稱，存 localStorage。
// 不做 Google 登入（延後）。見 DEVDOC §11。

const ID_KEY = "taiex_player_id";
const NAME_KEY = "taiex_player_name";

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

export function setPlayerName(name: string): void {
  localStorage.setItem(NAME_KEY, name.trim().slice(0, 16) || getPlayerName());
}
