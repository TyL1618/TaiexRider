import { useState, useEffect, useRef } from "react";
import { APP_VERSION, CHANGELOG } from "../version";
import { signInWithGoogle, signOut, updateProfileName, type User } from "../lib/auth";
import { getPlayerName, setPlayerName, clampNameWidth } from "../lib/playerId";
import { setVolume, getVolume } from "../game/audio";
import { detectEnv } from "../lib/ads";
import { getCoins, getActiveBikeSkin } from "../lib/garage";
import CoinIcon from "../components/CoinIcon";
import type { MarketMood } from "../lib/marketMood";
import StatsScreen from "./StatsScreen";
import Encyclopedia from "../components/Encyclopedia";
import "./Home.css";

export type Screen = "home" | "custom" | "random" | "daily" | "classic" | "garage";

const MOOD_LABEL: Record<MarketMood["mood"], string> = {
  up: "收盤上漲",
  down: "收盤下跌",
  flat: "收盤持平",
};

export default function Home({
  user,
  onNav,
  marketMood,
}: {
  user: User | null;
  onNav: (s: Screen) => void;
  marketMood?: MarketMood | null;
}) {
  const [showSettings, setShowSettings] = useState(false);
  const [showLog, setShowLog]           = useState(false);
  const [showHelp, setShowHelp]         = useState(false);
  const [nickname, setNickname]         = useState(() => getPlayerName());
  const [savedName, setSavedName]       = useState(() => getPlayerName());
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [volume, setVolumeState]        = useState(() => Math.round(getVolume() * 100));
  const [showStats, setShowStats]       = useState(false);
  const [showEncyclopedia, setShowEncyclopedia] = useState(false);
  // 隱藏統計頁入口：3 秒內連點版本號 5 下（權限門鎖在後端 admin RPC，這只是入口）。
  // 用 ref 同步計數（state 在快速連點時會讀到舊值）。
  const tapRef = useRef({ n: 0, t: 0 });
  const handleVersionTap = () => {
    const now = Date.now();
    tapRef.current = { n: now - tapRef.current.t < 3000 ? tapRef.current.n + 1 : 1, t: now };
    if (tapRef.current.n >= 5) {
      tapRef.current = { n: 0, t: 0 };
      setShowStats(true);
    }
  };

  useEffect(() => {
    const n = getPlayerName();
    setNickname(n);
    setSavedName(n);
  }, [user]);

  const isDirty = nickname.trim() !== savedName;

  // 首頁車庫展示：目前裝備車皮的高解析度大圖（遊戲內貼圖只有 64~90px 寬，細節看不出來）。
  // 高解析版存在 bikes/hires/ 下（同檔名，1:1 對應遊戲版 src），未生成 hires 版的車皮
  // （目前只有 default）直接退回原圖，因為 public/bike.png 本身解析度已經夠用。
  const activeSkin = getActiveBikeSkin();
  const showcaseSrc = activeSkin.src ? activeSkin.src.replace(/^bikes\//, "bikes/hires/") : "bike.png";

  const handleSaveName = () => {
    const trimmed = nickname.trim() || savedName;
    setPlayerName(trimmed);
    setSavedName(trimmed);
    setNickname(trimmed);
    if (user) updateProfileName(trimmed); // 同步到 Supabase user_profiles（fire-and-forget）
  };

  const handleSignOut = async () => {
    // 等 signOut() 真正跑完（含 resetWalletCache 清空幣/成就/streak 等本地快取）才關面板，
    // 避免使用者手速太快、緊接著切訪客遊玩時快取還沒清乾淨（2026-07-08 使用者回報成就殘留）。
    await signOut();
    setShowSettings(false);
    setLogoutConfirm(false);
  };

  const handleCloseSettings = () => {
    setShowSettings(false);
    setLogoutConfirm(false);
    if (isDirty) setNickname(savedName);
  };

  return (
    <div className="home-screen">
      <button className="corner-btn settings-corner-btn" onClick={() => setShowSettings(true)} aria-label="設定">
        ⚙
      </button>

      <h1 className="home-title">TAIEX&shy;RIDER</h1>
      <p className="home-sub">把台股走勢騎成霓虹賽道</p>

      <div className="home-entry-row">
        <button className="garage-entry-btn" onClick={() => onNav("garage")}>
          <CoinIcon size={22} />
          <span className="garage-entry-coins">{getCoins()}</span>
          <span className="garage-entry-label">收藏車庫</span>
        </button>
        <button className="ency-entry-btn" onClick={() => setShowEncyclopedia(true)}>
          📖 <span className="ency-entry-label">圖鑑</span>
        </button>
      </div>
      {showEncyclopedia && <Encyclopedia onClose={() => setShowEncyclopedia(false)} />}
      {marketMood && (
        <p className="market-mood-caption">
          今日盤勢為 {marketMood.dateStr} 之盤勢，{MOOD_LABEL[marketMood.mood]}
        </p>
      )}
      {marketMood?.isRage && (
        <p className="rage-day-banner">⚡ 狂暴盤：今日任務獎勵 ×2</p>
      )}

      <button className="bike-showcase" onClick={() => onNav("garage")}>
        <img
          src={`${import.meta.env.BASE_URL}${showcaseSrc}`}
          alt={activeSkin.name}
          className="bike-showcase-img"
          style={{ filter: !activeSkin.src && activeSkin.hueRotateDeg !== 0 ? `hue-rotate(${activeSkin.hueRotateDeg}deg)` : undefined }}
        />
        <div className="bike-showcase-name">{activeSkin.name}</div>
      </button>

      <div className="home-menu">
        <button className="home-btn daily" onClick={() => onNav("daily")}>
          <span className="home-btn-icon">🏆</span>
          <span className="home-btn-main">每日排名賽</span>
          <span className="home-btn-desc">每日精選賽道，排行競技</span>
        </button>
        <button className="home-btn random" onClick={() => onNav("random")}>
          <span className="home-btn-icon">🎲</span>
          <span className="home-btn-main">隨機賽道</span>
          <span className="home-btn-desc">前次盤勢圖池，隨機抽取賽道</span>
        </button>
        <button className="home-btn custom" onClick={() => onNav("custom")}>
          <span className="home-btn-icon">📈</span>
          <span className="home-btn-main">自選賽道</span>
          <span className="home-btn-desc">自選股市賽道&每日隨機串聯關卡</span>
        </button>
        <button className="home-btn classic" onClick={() => onNav("classic")}>
          <span className="home-btn-icon">🏛️</span>
          <span className="home-btn-main">經典模式</span>
          <span className="home-btn-desc">重現歷史著名股災與飆漲盤勢</span>
        </button>
      </div>

      <p className="home-foot">純娛樂・非投資建議</p>

      {showSettings && (
        <div className="modal-overlay" onClick={handleCloseSettings}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">設定</div>

            {/* 帳號區塊 */}
            {user ? (
              <div className="settings-account">
                <div className="settings-account-info">
                  <span className="settings-account-label">Google 帳號</span>
                  <span className="settings-account-email">{user.email}</span>
                </div>
                <div className="settings-nickname-row">
                  <label className="settings-nickname-label">排行榜暱稱</label>
                  <input
                    className="settings-nickname-input"
                    value={nickname}
                    maxLength={12}
                    onChange={(e) => setNickname(clampNameWidth(e.target.value))}
                  />
                </div>
                <button
                  className={`settings-confirm-btn${isDirty ? " enabled" : ""}`}
                  disabled={!isDirty}
                  onClick={handleSaveName}
                >
                  確認更改
                </button>
              </div>
            ) : (
              <div className="settings-account settings-account--guest">
                <p className="settings-account-hint">登入 Google 才能參加每日排名賽</p>
                <button className="google-signin-btn" onClick={() => { signInWithGoogle(); setShowSettings(false); }}>
                  <GoogleIcon />Google 登入
                </button>
              </div>
            )}

            <div className="settings-volume-row">
              <span className="settings-volume-label">音量</span>
              <input
                type="range"
                className="settings-volume-slider"
                min={0} max={100} step={5}
                value={volume}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setVolumeState(v);
                  setVolume(v / 100);
                }}
              />
              <span className="settings-volume-val">{volume}%</span>
            </div>

            <div className="settings-meta-row">
              <span className="settings-version-text" onClick={handleVersionTap}>版本 v{APP_VERSION}・{detectEnv() === "twa" ? "App" : "網頁"}</span>
              <button
                className="settings-changelog-btn"
                onClick={() => { setShowSettings(false); setShowHelp(true); }}
              >
                遊戲說明
              </button>
              <button
                className="settings-changelog-btn"
                onClick={() => { setShowSettings(false); setShowLog(true); }}
              >
                更新日誌
              </button>
            </div>

            {/* 登出區 - 置底，與關閉按鈕有間距 */}
            {user && (
              <div className="settings-signout-area">
                {logoutConfirm ? (
                  <div className="settings-logout-confirm">
                    <span className="settings-logout-text">確定要登出？</span>
                    <div className="settings-logout-btns">
                      <button className="settings-signout-btn" onClick={handleSignOut}>確定</button>
                      <button className="settings-cancel-btn" onClick={() => setLogoutConfirm(false)}>取消</button>
                    </div>
                  </div>
                ) : (
                  <button className="settings-signout-btn" onClick={() => setLogoutConfirm(true)}>
                    登出
                  </button>
                )}
              </div>
            )}

            <button className="modal-btn settings-close-btn" onClick={handleCloseSettings}>關閉</button>
          </div>
        </div>
      )}

      {showLog && (
        <div className="modal-overlay" onClick={() => setShowLog(false)}>
          <div className="modal-panel log" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">更新日誌</div>
            <div className="log-scroll">
              {CHANGELOG.map((entry) => (
                <div key={entry.date} className="log-entry">
                  <div className="log-date">{entry.date}</div>
                  <ul className="log-notes">
                    {entry.notes.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                </div>
              ))}
            </div>
            <button className="modal-btn" onClick={() => setShowLog(false)}>關閉</button>
          </div>
        </div>
      )}

      {showHelp && (
        <div className="modal-overlay" onClick={() => setShowHelp(false)}>
          <div className="modal-panel log" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">遊戲說明</div>
            <div className="log-scroll">
              <div className="log-entry">
                <div className="log-date">操作方式</div>
                <ul className="log-notes">
                  <li>點擊／按住螢幕任意處 → 車子前進</li>
                  <li>空中持續按住 → 後空翻</li>
                  <li>放開 → 車頭自然朝前</li>
                </ul>
              </div>
              <div className="log-entry">
                <div className="log-date">計分規則</div>
                <ul className="log-notes">
                  <li>後空翻每圈得分，翻越多圈得分越高</li>
                  <li>完美落地（接近水平落地）額外加分</li>
                  <li>跑得越遠、行進分越高</li>
                  <li>摔車後進結算，分數不倒退</li>
                </ul>
              </div>
              <div className="log-entry">
                <div className="log-date">每日圖池</div>
                <ul className="log-notes">
                  <li>每天午夜自動更新，載入前一交易日的盤中走勢</li>
                  <li>六日及假日維持最近一個交易日的走勢圖</li>
                  <li>全台玩家同一天跑相同賽道</li>
                </ul>
              </div>
              <div className="log-entry">
                <div className="log-date">遊戲模式</div>
                <ul className="log-notes">
                  <li>每日排名賽：全台同圖、登入 Google 參加排行榜</li>
                  <li>隨機賽道：拉霸隨機抽一支股票</li>
                  <li>自選賽道・前次盤勢：從全市場約 1000 支自選</li>
                  <li>自選賽道・每日長征：5 支股票串接的超長路線</li>
                </ul>
              </div>
            </div>
            <button className="modal-btn" onClick={() => setShowHelp(false)}>關閉</button>
          </div>
        </div>
      )}

      {showStats && <StatsScreen onClose={() => setShowStats(false)} />}

    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 18 18" style={{ display: "inline", verticalAlign: "middle", marginRight: 5 }}>
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
    </svg>
  );
}
