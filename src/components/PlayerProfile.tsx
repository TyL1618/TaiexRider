import { useEffect, useState } from "react";
import { fetchPlayerProfile, type PlayerProfileData } from "../lib/playerProfile";
import { BIKE_SKINS, COSMETIC_LABELS } from "../lib/garage";
import { computeAchievements } from "../lib/achievements";
import { CLASSICS } from "../data/classics";
import "./PlayerProfile.css";

// 經典關卡 id → 中文事件名（RPC 只回 level_id，前端在這裡對照，跟 ClassicSelect 同一份資料）。
const CLASSIC_TITLE = new Map(CLASSICS.map((c) => [c.id, c.title]));
// 只算「車款」類的擁有數（owned 陣列同時混著稱號/徽章等個人化道具 id）。
const TOTAL_SKINS = BIKE_SKINS.length;
const SKIN_IDS = new Set(BIKE_SKINS.map((s) => s.id));

const RANK_MEDAL: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };
const RANK_LABEL: Record<number, string> = { 1: "週第一", 2: "週第二", 3: "週第三" };

export default function PlayerProfile({ playerId, onClose }: { playerId: string; onClose: () => void }) {
  const [data, setData] = useState<PlayerProfileData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchPlayerProfile(playerId).then((d) => {
      if (!alive) return;
      setData(d);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [playerId]);

  const equipped = data?.equipped ?? {};
  const nickSwatch = equipped.nickcolor ? COSMETIC_LABELS[equipped.nickcolor]?.swatch : undefined;
  const badgeIcon = equipped.badge ? COSMETIC_LABELS[equipped.badge]?.label : undefined;
  const titleLabel = equipped.title ? COSMETIC_LABELS[equipped.title]?.label : undefined;
  const equippedSkin = BIKE_SKINS.find((s) => s.id === (equipped.skin ?? "default")) ?? BIKE_SKINS[0];
  const ownedSkinCount = data ? data.owned.filter((id) => SKIN_IDS.has(id)).length : 0;

  const achievements = data
    ? computeAchievements({
        bullFinishes: data.achv.bullFinishes,
        bearFinishes: data.achv.bearFinishes,
        totalFlips: data.achv.totalFlips,
        totalPerfect: data.achv.totalPerfect,
        streakDays: data.achv.streakCount,
      })
    : [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="pp-panel" onClick={(e) => e.stopPropagation()}>
        <button className="pp-close" onClick={onClose} aria-label="關閉">✕</button>

        {loading ? (
          <div className="pp-loading">載入中…</div>
        ) : !data ? (
          <div className="pp-loading">找不到這位玩家的資料</div>
        ) : (
          <>
            <div className="pp-head">
              <div className="pp-head-label">玩家資料</div>
              <div className="pp-name-line">
                {badgeIcon && <span className="pp-badge">{badgeIcon}</span>}
                <span className="pp-name" style={nickSwatch ? { color: nickSwatch } : undefined}>
                  {data.playerName}
                </span>
              </div>
              {titleLabel && <div className="pp-title-pill">{titleLabel}</div>}
            </div>

            <div className="pp-divider" />

            <div className="pp-block">
              <div className="pp-section-label">目前裝備</div>
              <div className="pp-equip">
                <img
                  className="pp-equip-img"
                  src={`${import.meta.env.BASE_URL}${equippedSkin.src ?? "bike.png"}`}
                  alt={equippedSkin.name}
                />
                <div>
                  <div className="pp-equip-name">{equippedSkin.name}</div>
                  <div className="pp-equip-sub">
                    {equippedSkin.currency === "diamond" ? "鑽石車款" : equippedSkin.desc}
                  </div>
                </div>
              </div>
            </div>

            <div className="pp-owned-row">
              <span className="pp-owned-label">🏍️ 持有車款</span>
              <span className="pp-owned-val">{ownedSkinCount} / {TOTAL_SKINS} 台</span>
            </div>

            <div className="pp-block">
              <div className="pp-section-label">🏆 每日排名賽</div>
              <div className="pp-medals">
                <div className="pp-medal"><div className="pp-medal-emoji">🥇</div><div className="pp-medal-val">{data.daily.first} 次</div></div>
                <div className="pp-medal"><div className="pp-medal-emoji">🥈</div><div className="pp-medal-val">{data.daily.second} 次</div></div>
                <div className="pp-medal"><div className="pp-medal-emoji">🥉</div><div className="pp-medal-val">{data.daily.third} 次</div></div>
              </div>
              <div className="pp-top10">前十名共 {data.daily.top10} 次</div>
            </div>

            {data.classic.length > 0 && (
              <div className="pp-block">
                <div className="pp-section-label">🏛️ 經典模式週榜</div>
                <div className="pp-classic-list">
                  {data.classic.map((c, i) => (
                    <div className="pp-classic-row" key={i}>
                      <span className="pp-classic-map">{CLASSIC_TITLE.get(c.levelId) ?? c.levelId}</span>
                      <span className={`pp-classic-rank ${c.rank === 1 ? "gold" : ""}`}>
                        {RANK_MEDAL[c.rank] ?? ""} {RANK_LABEL[c.rank] ?? `第${c.rank}`} · {c.count}次
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="pp-divider" />

            <div className="pp-block">
              <div className="pp-section-label">🎯 已解鎖成就</div>
              <div className="pp-achv-list">
                {achievements.map((a) => (
                  <span className={`pp-achv ${a.unlocked ? "" : "locked"}`} key={a.id}>
                    {a.unlocked ? a.emoji : "🔒"} {a.name}
                  </span>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
