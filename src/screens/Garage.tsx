import { useState } from "react";
import { BIKE_SKINS, getCoins, isOwned, getActiveSkinId, purchaseSkin, setActiveSkin } from "../lib/garage";
import CoinIcon from "../components/CoinIcon";
import "../TrackSelect.css";
import "./Garage.css";

export default function Garage({ onBack }: { onBack: () => void }) {
  const [coins, setCoins] = useState(() => getCoins());
  const [active, setActive] = useState(() => getActiveSkinId());
  const [, forceRender] = useState(0);

  const handleBuy = (id: string) => {
    if (purchaseSkin(id)) {
      setCoins(getCoins());
      forceRender((n) => n + 1);
    }
  };

  const handleEquip = (id: string) => {
    if (setActiveSkin(id)) setActive(id);
  };

  return (
    <div className="select-screen garage-screen">
      <button className="back-btn" onClick={onBack}>‹ 返回</button>
      <h1 className="select-title">車庫</h1>
      <p className="garage-coins"><CoinIcon size={22} /> 金幣 {coins}</p>
      <p className="garage-intro">完賽/摔車與每日任務都能賺金幣，解鎖車皮換上場</p>

      <div className="garage-list">
        {BIKE_SKINS.map((s) => {
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
        })}
      </div>

      <p className="garage-more-hint">更多車款（任務解鎖／付費款）陸續推出中</p>
    </div>
  );
}
