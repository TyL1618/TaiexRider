import { useEffect, useState } from "react";
import { BIKE_SKINS, getCoins, isOwned, getActiveSkinId, purchaseSkin, setActiveSkin, addCoins, unlockAchievementSkin, type BikeSkin } from "../lib/garage";
import { requestRewardedCoins } from "../lib/ads";
import { AD_COIN_REWARD, MAX_AD_COIN_CLAIMS_PER_DAY, getAdCoinClaims, incrementAdCoinClaims } from "../lib/adRewards";
import { getAchievementBikes, type AchvBikeView } from "../lib/achievements";
import { getStreak } from "../lib/streak";
import { resolveSessionDate } from "../lib/dailyMap";
import { dailyKey } from "../data/pick";
import CoinIcon from "../components/CoinIcon";
import "../TrackSelect.css";
import "./Garage.css";

// 付費車款（P 系列）：真錢 IAP（Google Play Billing），非金幣購買，設計見 GARAGE_DESIGN.md。
// 美術＋定價都還沒定案，先做 UI 殼＋「敬請期待」佔位，Billing 串接前按鈕一律 disabled。
const PAID_BIKES = [
  { id: "p1-crimson", name: "赤紅暴走", desc: "旗艦全整流罩仿賽，霓虹紅賽車魂" },
  { id: "p2-galaxy", name: "銀河鍍鉻", desc: "鏡面鍍鉻概念車，內嵌流轉星河" },
  { id: "p3-gold", name: "黃金大亨", desc: "黑金巡航旗艦，排行榜霸主座駕" },
  { id: "p4-samurai", name: "電馭武士", desc: "電馭武士甲，冰藍電路紋" },
  { id: "p5-phantom", name: "幽靈匿蹤", desc: "暗夜匿蹤，血色微光" },
] as const;

export default function Garage({ onBack }: { onBack: () => void }) {
  const [coins, setCoins] = useState(() => getCoins());
  const [active, setActive] = useState(() => getActiveSkinId());
  const [watchingAd, setWatchingAd] = useState(false);
  const [adClaims, setAdClaims] = useState(() => getAdCoinClaims(dailyKey()));
  const [achvBikes, setAchvBikes] = useState<AchvBikeView[]>(() => getAchievementBikes(0));
  const [, forceRender] = useState(0);

  // Q 系列 streak 進度依「目前這一期」session key 讀（連假整段算同一期，跟 DailyChallenge 同源）
  useEffect(() => {
    let alive = true;
    resolveSessionDate(dailyKey()).then((key) => {
      if (alive) setAchvBikes(getAchievementBikes(getStreak(key)));
    });
    return () => { alive = false; };
  }, []);

  // 成就達成＋美術已到位（BIKE_SKINS 有登記對應 id）就自動解鎖擁有，不用另外按按鈕
  // （unlockAchievementSkin 本身冪等，重複呼叫不影響已擁有狀態）。
  // ⚠️ unlockAchievementSkin 只寫 localStorage、不帶 React state，寫完必須手動
  // forceRender 一次，不然畫面會停在舊的「購買」按鈕，直到別的地方剛好觸發重繪。
  useEffect(() => {
    let changed = false;
    for (const a of achvBikes) {
      if (a.unlocked && BIKE_SKINS.some((s) => s.id === a.id) && !isOwned(a.id)) {
        unlockAchievementSkin(a.id);
        changed = true;
      }
    }
    if (changed) forceRender((n) => n + 1);
  }, [achvBikes]);

  const handleBuy = (id: string) => {
    if (purchaseSkin(id)) {
      setCoins(getCoins());
      forceRender((n) => n + 1);
    }
  };

  const handleWatchAd = () => {
    if (watchingAd || adClaims >= MAX_AD_COIN_CLAIMS_PER_DAY) return;
    setWatchingAd(true);
    requestRewardedCoins().then((ok) => {
      setWatchingAd(false);
      if (ok) {
        incrementAdCoinClaims(dailyKey());
        setAdClaims(getAdCoinClaims(dailyKey()));
        setCoins(addCoins(AD_COIN_REWARD));
      }
    });
  };

  const handleEquip = (id: string) => {
    if (setActiveSkin(id)) setActive(id);
  };

  const renderSkinCard = (s: BikeSkin) => {
    const owned = isOwned(s.id);
    const equipped = active === s.id;
    return (
      <div key={s.id} className={`garage-card${equipped ? " equipped" : ""}`}>
        <div className="garage-preview">
          <img
            src={`${import.meta.env.BASE_URL}${s.src ?? "bike.png"}`}
            alt={s.name}
            style={{ filter: !s.src && s.hueRotateDeg !== 0 ? `hue-rotate(${s.hueRotateDeg}deg)` : undefined }}
          />
        </div>
        <div className="garage-card-body">
          <div className="garage-card-name">{s.name}{equipped && <span className="garage-equipped-tag">使用中</span>}</div>
          <div className="garage-card-desc">{s.desc}</div>
          {owned ? (
            <button
              className={`garage-btn${equipped ? " disabled" : ""}`}
              disabled={equipped}
              onClick={() => handleEquip(s.id)}
            >
              {equipped ? "使用中" : "裝備"}
            </button>
          ) : (
            <button
              className={`garage-btn buy${coins < s.price ? " disabled" : ""}`}
              disabled={coins < s.price}
              onClick={() => handleBuy(s.id)}
            >
              購買・{s.price} 金幣
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="select-screen garage-screen">
      <button className="back-btn" onClick={onBack}>‹ 返回</button>
      <h1 className="select-title">車庫</h1>
      <p className="garage-coins"><CoinIcon size={22} /> 金幣 {coins}</p>
      <p className="garage-intro">完賽/摔車與每日任務都能賺金幣，解鎖車皮換上場</p>
      <button
        className="garage-ad-btn"
        disabled={watchingAd || adClaims >= MAX_AD_COIN_CLAIMS_PER_DAY}
        onClick={handleWatchAd}
      >
        {watchingAd
          ? "廣告播放中…"
          : adClaims >= MAX_AD_COIN_CLAIMS_PER_DAY
            ? "今日已達上限"
            : `📺 看廣告 +${AD_COIN_REWARD} 金幣 (${adClaims}/${MAX_AD_COIN_CLAIMS_PER_DAY})`}
      </button>

      <div className="garage-list">
        {BIKE_SKINS.filter((s) => !s.locked).map(renderSkinCard)}
      </div>

      <h2 className="garage-section-title">🎯 任務解鎖車款</h2>
      <div className="garage-list">
        {achvBikes.map((a) => {
          const skin = BIKE_SKINS.find((s) => s.id === a.id);
          if (a.unlocked && skin) return renderSkinCard(skin); // 美術已到位＋達成→直接當一般車皮卡片可裝備
          return (
            <div key={a.id} className={`garage-card locked${a.unlocked ? " achv-done" : ""}`}>
              <div className="garage-preview garage-preview-locked">
                <span className="garage-lock-icon">{a.unlocked ? "🏆" : "🔒"}</span>
              </div>
              <div className="garage-card-body">
                <div className="garage-card-name">{a.name}</div>
                <div className="garage-card-desc">{a.desc}</div>
                <div className="achv-progress-track">
                  <div className="achv-progress-fill" style={{ width: `${(a.progress / a.target) * 100}%` }} />
                </div>
                <div className="achv-progress-text">
                  {a.unlocked ? "已達成・車皮製作中，敬請期待" : `${a.progress} / ${a.target}`}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <h2 className="garage-section-title">💎 付費車款</h2>
      <div className="garage-list">
        {PAID_BIKES.map((p) => (
          <div key={p.id} className="garage-card locked">
            <div className="garage-preview garage-preview-locked">
              <span className="garage-lock-icon">💎</span>
            </div>
            <div className="garage-card-body">
              <div className="garage-card-name">{p.name}</div>
              <div className="garage-card-desc">{p.desc}</div>
              <button className="garage-btn disabled" disabled>敬請期待</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
