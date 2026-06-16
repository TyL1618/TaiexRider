import { useState, useEffect, useRef } from "react";
import { APP_VERSION, CHANGELOG } from "../version";
import "./Home.css";

export type Screen = "home" | "custom" | "random" | "daily";

export default function Home({ onNav }: { onNav: (s: Screen) => void }) {
  const [showSettings, setShowSettings] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const leavingRef = useRef(false);

  // 裝置返回鍵（Android/TWA）：首頁按返回 → 確認是否離開 App
  useEffect(() => {
    window.history.pushState({ taiexHome: true }, "");
    const onPop = () => {
      if (leavingRef.current) return;
      setConfirmLeave(true);
      window.history.pushState({ taiexHome: true }, "");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const doLeave = () => {
    leavingRef.current = true;
    setConfirmLeave(false);
    window.history.go(-2);
  };

  return (
    <div className="home-screen">
      <button className="corner-btn settings-corner-btn" onClick={() => setShowSettings(true)} aria-label="設定">
        ⚙
      </button>

      <h1 className="home-title">TAIEX&shy;RIDER</h1>
      <p className="home-sub">把台股走勢騎成霓虹賽道</p>

      <div className="home-menu">
        <button className="home-btn daily" onClick={() => onNav("daily")}>
          <span className="home-btn-icon">🏆</span>
          <span className="home-btn-main">每日排名賽</span>
          <span className="home-btn-desc">全台同圖競技・比分數比時間</span>
        </button>
        <button className="home-btn random" onClick={() => onNav("random")}>
          <span className="home-btn-icon">🎲</span>
          <span className="home-btn-main">隨機賽道</span>
          <span className="home-btn-desc">拉霸抽一張・隨興開騎</span>
        </button>
        <button className="home-btn custom" onClick={() => onNav("custom")}>
          <span className="home-btn-icon">📈</span>
          <span className="home-btn-main">自選賽道</span>
          <span className="home-btn-desc">挑指定股票・日盤或月盤</span>
        </button>
      </div>

      <p className="home-foot">純娛樂・非投資建議</p>

      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">設定</div>
            <div className="modal-item">音量（待實作）</div>
            <div className="modal-item dim">版本 v{APP_VERSION}</div>
            <button className="modal-link" onClick={() => { setShowSettings(false); setShowLog(true); }}>
              更新日誌 ›
            </button>
            <button className="modal-btn" onClick={() => setShowSettings(false)}>關閉</button>
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

      {confirmLeave && (
        <div className="modal-overlay" onClick={() => setConfirmLeave(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">離開遊戲？</div>
            <div className="modal-item dim">確定要離開 TAIEX RIDER 嗎？</div>
            <button className="modal-btn" onClick={doLeave}>確定離開</button>
            <button className="modal-link" onClick={() => setConfirmLeave(false)}>留下繼續玩</button>
          </div>
        </div>
      )}
    </div>
  );
}
