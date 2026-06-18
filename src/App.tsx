import { useState, useCallback, useEffect, useRef } from "react";
import GameCanvas from "./game/GameCanvas";
import type { GameOverStats } from "./game/GameCanvas";
import TrackSelect from "./TrackSelect";
import Home, { type Screen } from "./screens/Home";
import RandomSlot from "./screens/RandomSlot";
import DailyChallenge from "./screens/DailyChallenge";
import type { TrackData } from "./data/tracks";
import { submitDailyScore, fetchDailyTop } from "./lib/leaderboard";
import { fetchHardestDailyMap, fetchDailyMapList } from "./lib/dailyMap";
import { onAuthStateChange, getUser, type User } from "./lib/auth";
import { getPlayerName } from "./lib/playerId";
import { dailyKey } from "./data/pick";
import { setPlaying } from "./pwa";

export default function App() {
  const [screen, setScreen]         = useState<Screen>("home");
  const [track, setTrack]           = useState<TrackData | null>(null);
  const [isDailyRun, setIsDailyRun] = useState(false);
  const [user, setUser]             = useState<User | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  // refs 讓 popstate 閉包隨時拿到最新值，不靠 useEffect 依賴陣列
  const screenRef      = useRef<Screen>("home");
  const trackRef       = useRef<TrackData | null>(null);
  const confirmLeaveRef = useRef(false);
  confirmLeaveRef.current = confirmLeave; // 每次 render 同步，popstate 閉包讀得到最新值

  // 子頁的「‹返回」鈕：退掉子頁那層 history，由 popstate 統一切回首頁，
  // 讓 app 狀態與 history 深度保持同步（避免殘留 entry 造成返回鍵錯亂）。
  const goHome = useCallback(() => {
    window.history.back();
  }, []);

  // 初始化 auth 狀態，並監聽登入 / 登出變化
  useEffect(() => {
    getUser().then(setUser);
    return onAuthStateChange(setUser);
  }, []);

  // App 啟動時預熱每日資料，進 DailyChallenge 時直接從快取拿，不需等待
  useEffect(() => {
    const date = dailyKey();
    fetchHardestDailyMap(date);
    fetchDailyTop(date);
    fetchDailyMapList(date);
  }, []);

  // 集中 history 管理：一個永不卸載的 listener，消除子頁 ↔ 首頁切換的 listener 空窗期。
  // beforeunload 讓桌機 PWA 關視窗時也跳瀏覽器確認框。
  useEffect(() => {
    // OAuth redirect 返回時 Supabase 會留下 access_token hash，壓制一次避免誤跳「離開」
    const isOAuthReturn = window.location.hash.includes("access_token")
      || window.location.search.includes("code=");
    let suppressNext = isOAuthReturn;

    window.history.pushState({ taiex: true }, "");

    const onPop = () => {
      if (suppressNext) {
        suppressNext = false;
        window.history.pushState({ taiex: true }, "");
        return;
      }
      // 遊戲進行中：GameCanvas 有自己的 listener，這裡不介入
      if (trackRef.current !== null) return;

      // 確認離開視窗開著時：返回鍵 = 取消（關閉視窗），不離開、不關 App。
      // 補推哨兵避免落到 history 底部被原生返回穿透關閉。
      if (confirmLeaveRef.current) {
        setConfirmLeave(false);
        window.history.pushState({ taiex: true }, "");
        return;
      }

      if (screenRef.current !== "home") {
        // 子頁面 → 返回首頁：popstate 已消耗子頁那層，現在正停在首頁哨兵，不需補推
        screenRef.current = "home";
        setScreen("home");
      } else {
        // 首頁 → 跳離開確認：補推哨兵留在 App 內，back 不會穿透關閉
        setConfirmLeave(true);
        window.history.pushState({ taiex: true }, "");
      }
    };

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault(); // 桌機 PWA 關視窗時跳瀏覽器原生「離開網站？」確認框
    };

    window.addEventListener("popstate", onPop);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []); // 只在 App 掛載時執行一次，永遠不移除

  const doLeave = () => {
    setConfirmLeave(false);
    // 正式 TWA（APK）裡 window.close() 會結束 Activity 真正關閉 App。
    // 「加到主畫面」的安裝版 PWA 可能無效（瀏覽器限制），此情況關不掉屬正常，
    // 真正上架的 TWA 不受影響。
    window.close();
  };

  const handleGameOver = useCallback((stats: GameOverStats) => {
    if (isDailyRun && user) {
      submitDailyScore(getPlayerName(), {
        score:   stats.score,
        timeMs:  stats.timeMs,
        flips:   stats.flips,
        perfect: stats.perfect,
      });
    }
  }, [isDailyRun, user]);

  const handleStartTrack = (t: TrackData) => {
    trackRef.current = t;
    setTrack(t);
    setPlaying(true); // 遊玩中：暫緩 SW 自動更新 reload
  };
  const handleExitTrack = useCallback(() => {
    trackRef.current = null;
    setTrack(null);
    setIsDailyRun(false);
    setPlaying(false); // 離開賽道：若有待套用的新版立即 reload
  }, []);

  if (track) {
    return (
      <GameCanvas
        key={track.label + track.mode}
        prices={track.prices}
        label={track.label}
        name={track.name}
        onExit={handleExitTrack}
        onGameOver={handleGameOver}
        hideMinimap={track.mode === "long"}
      />
    );
  }

  const handleNav = (s: Screen) => {
    // 為子頁新增一層真實 history entry，讓返回鍵有足夠深度緩衝：
    // 從子頁連按兩次返回 = 退回首頁 + 跳離開確認，不會穿透直接關閉 App。
    window.history.pushState({ taiex: true }, "");
    screenRef.current = s;
    setScreen(s);
  };

  if (screen === "custom") return <TrackSelect onPick={handleStartTrack} onBack={goHome} />;
  if (screen === "random") return <RandomSlot  onPick={handleStartTrack} onBack={goHome} />;
  if (screen === "daily")  return (
    <DailyChallenge
      user={user}
      onPlay={(t) => { setIsDailyRun(true); handleStartTrack(t); }}
      onBack={goHome}
    />
  );
  return (
    <>
      <Home user={user} onNav={handleNav} />
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
    </>
  );
}
