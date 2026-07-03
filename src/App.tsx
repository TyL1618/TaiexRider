import { useState, useCallback, useEffect, useRef, lazy, Suspense } from "react";
import type { GameOverStats } from "./game/GameCanvas";

// GameCanvas（含 Matter.js 物理引擎，bundle 最大宗）拆成獨立 chunk 延遲載入：
// 首頁/選單不用等物理引擎就能互動，改善冷啟動首次可互動時間。
// App 掛載 2.5s 後背景預熱該 chunk（且 SW precache 會快取），實際進遊戲幾乎無感。
const GameCanvas = lazy(() => import("./game/GameCanvas"));
import TrackSelect from "./TrackSelect";
import Home, { type Screen } from "./screens/Home";
import RandomSlot from "./screens/RandomSlot";
import DailyChallenge from "./screens/DailyChallenge";
import ClassicSelect from "./screens/ClassicSelect";
import Garage from "./screens/Garage";
import type { TrackData } from "./data/tracks";
import { submitDailyScore, fetchDailyTop } from "./lib/leaderboard";
import { submitClassicRecord } from "./lib/classicRecords";
import { fetchHardestDailyMap, fetchDailyMapList, resolveSessionDate } from "./lib/dailyMap";
import { onAuthStateChange, getUser, type User } from "./lib/auth";
import { getPlayerName } from "./lib/playerId";
import { dailyKey } from "./data/pick";
import { setPlaying } from "./pwa";
import { logEvent, type AnalyticsMode } from "./lib/analytics";
import { addCoins, getCoins } from "./lib/garage";
import { recordRun } from "./lib/quests";
import { resolveMarketMood, type MarketMood } from "./lib/marketMood";

export default function App() {
  const [screen, setScreen]         = useState<Screen>("home");
  const [track, setTrack]           = useState<TrackData | null>(null);
  const [isDailyRun, setIsDailyRun] = useState(false);
  const [user, setUser]             = useState<User | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [marketMood, setMarketMood] = useState<MarketMood | null>(null);
  // 每次 app 啟動（新 session）顯示一次封測通知；同一 session 內返回首頁不再跳
  const [showBetaNotice, setShowBetaNotice] = useState(
    () => !sessionStorage.getItem("tr_beta_notice_shown")
  );
  const gameKeyRef = useRef(0); // 每次 handleStartTrack +1，確保新局 GameCanvas 重建（revivalUsed 重置）

  // refs 讓 popstate 閉包隨時拿到最新值，不靠 useEffect 依賴陣列
  const screenRef      = useRef<Screen>("home");
  const trackRef       = useRef<TrackData | null>(null);
  const confirmLeaveRef = useRef(false);
  confirmLeaveRef.current = confirmLeave; // 每次 render 同步，popstate 閉包讀得到最新值
  const leavingRef = useRef(false); // 觸發離開後設 true，阻止後續 popstate 補哨兵

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

  // 開發者測試帳號：登入即補滿金幣，方便真機測車庫購買/裝備流程不用真的刷任務。
  // 純前端 email 比對，不是安全機制（金幣沒有排行榜/競技意義，不影響公平性）。
  useEffect(() => {
    if (user?.email === "tyl161803@gmail.com" && getCoins() < 99999) {
      addCoins(99999 - getCoins());
    }
  }, [user]);

  // 全站盤勢主題氛圍：解析當期大盤漲跌 → 背景色調 CSS 變數 + 首頁說明文字
  useEffect(() => {
    let alive = true;
    resolveMarketMood().then((m) => {
      if (!alive || !m) return;
      setMarketMood(m);
      document.documentElement.dataset.marketMood = m.mood;
    });
    return () => { alive = false; };
  }, []);

  // 背景預熱 GameCanvas chunk（Matter.js），讓首次進遊戲不用現場下載
  useEffect(() => {
    const t = setTimeout(() => { void import("./game/GameCanvas"); }, 2500);
    return () => clearTimeout(t);
  }, []);

  // App 啟動時預熱每日資料，進 DailyChallenge 時直接從快取拿，不需等待
  useEffect(() => {
    const date = dailyKey();
    fetchHardestDailyMap(date);
    fetchDailyMapList(date);
    // 排行榜預熱用「目前這一期」session key（與 DailyChallenge 讀取端同源），
    // 連假期間日曆日 ≠ map_date，用 dailyKey 預熱會打到空榜的快取。
    resolveSessionDate(date).then((key) => fetchDailyTop(key));
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
      // 已觸發離開：讓 history 自然耗盡，不推哨兵不開視窗，TWA 可順利 finish()
      if (leavingRef.current) return;

      if (suppressNext) {
        suppressNext = false;
        window.history.pushState({ taiex: true }, "");
        return;
      }
      // 遊戲進行中：GameCanvas 有自己的 listener，這裡不介入
      if (trackRef.current !== null) return;

      // 確認離開視窗開著時「再按一次返回鍵」= 離開：耗盡 history 讓 TWA 自然 finish()。
      // （改用返回鍵當離開動作，比 window.close() 可靠——TWA 封鎖 window.close()。）
      if (confirmLeaveRef.current) {
        leavingRef.current = true;       // 阻止後續 popstate 補哨兵
        confirmLeaveRef.current = false;
        setConfirmLeave(false);
        window.close();                   // 桌機 PWA 有效；TWA 被封鎖則由下一行接手
        window.history.go(-window.history.length);
        return;
      }

      if (screenRef.current !== "home") {
        // 子頁面 → 返回首頁：popstate 已消耗子頁那層，現在正停在首頁哨兵，不需補推
        screenRef.current = "home";
        setScreen("home");
      } else {
        // 首頁 → 跳離開確認：補推哨兵留在 App 內，back 不會穿透關閉
        confirmLeaveRef.current = true; // 同步更新，避免連按時第二次 popstate 讀到舊值
        setConfirmLeave(true);
        window.history.pushState({ taiex: true }, "");
      }
    };

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      // 自動更新觸發的重載：放行，不跳原生確認框（旗標由 src/pwa.ts 設定）
      if ((window as { __taiexAutoReload?: boolean }).__taiexAutoReload) return;
      e.preventDefault(); // 桌機 PWA 關視窗時跳瀏覽器原生「離開網站？」確認框
    };

    window.addEventListener("popstate", onPop);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []); // 只在 App 掛載時執行一次，永遠不移除

  // App 捷徑 / 深連結：?goto=daily|random|custom|classic 直接跳到子頁。
  // 來源：Android App Shortcuts（長按圖示）、PWA manifest shortcuts、分享連結。
  // 清掉參數（replaceState）避免重整重複觸發；補一層 pushState 讓返回鍵行為
  // 與 handleNav 正常導航一致（返回 = 回首頁）。放在 history effect 之後執行，
  // 疊在哨兵 entry 之上。
  useEffect(() => {
    const goto = new URLSearchParams(window.location.search).get("goto");
    if (goto === "daily" || goto === "random" || goto === "custom" || goto === "classic") {
      window.history.replaceState(null, "", window.location.pathname);
      window.history.pushState({ taiex: true }, "");
      screenRef.current = goto;
      setScreen(goto);
    }
  }, []);

  const handleGameOver = useCallback((stats: GameOverStats) => {
    if (isDailyRun && user) {
      submitDailyScore(getPlayerName(), {
        score:   stats.score,
        timeMs:  stats.timeMs,
        flips:   stats.flips,
        perfect: stats.perfect,
      });
    }
    // 經典模式：提交紀錄保持者（需登入）。level id 隨 TrackData 帶入。
    const classicId = trackRef.current?.classicId;
    if (classicId && user) {
      submitClassicRecord(classicId, getPlayerName(), { score: stats.score, timeMs: stats.timeMs });
    }
    // 車庫金幣：完賽/摔車都給小額基本獎勵，任何模式皆算（純個人習慣迴圈，見 RETENTION_PLAN.md）
    addCoins(stats.finished ? 10 : 3);
    // 每日任務：用裝置本地日曆日累計，跨模式共用同一組任務池
    const newlyDone = recordRun(dailyKey(), {
      score: stats.score, flips: stats.flips, perfect: stats.perfect, timeMs: stats.timeMs,
    });
    for (const q of newlyDone) addCoins(q.reward);
  }, [isDailyRun, user]);

  // 分析用模式標籤：依「從哪個畫面開局」判斷（screenRef 在 pick 當下仍是子頁）
  const analyticsModeRef = useRef<AnalyticsMode>("custom");
  const deriveAnalyticsMode = (t: TrackData): AnalyticsMode => {
    if (screenRef.current === "daily") return "daily";
    if (screenRef.current === "random") return "slot";
    if (t.classicId) return "classic";
    if (t.mode === "long") return "long";
    return "custom";
  };

  const handleStartTrack = (t: TrackData) => {
    gameKeyRef.current++;
    trackRef.current = t;
    analyticsModeRef.current = deriveAnalyticsMode(t);
    logEvent("run_start", analyticsModeRef.current, { label: t.label });
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
      <Suspense fallback={<div className="lazy-game-loading">賽道載入中…</div>}>
        <GameCanvas
          key={gameKeyRef.current}
          prices={track.prices}
          label={track.label}
          name={track.name}
          subtitle={track.subtitle}
          onExit={handleExitTrack}
          onGameOver={handleGameOver}
          hideMinimap={track.mode === "long"}
          revivalEnabled={isDailyRun}
          analyticsMode={analyticsModeRef.current}
          pbKey={track.classicId ? `classic_${track.classicId}` : `${analyticsModeRef.current}_${track.label}`}
        />
      </Suspense>
    );
  }

  const handleNav = (s: Screen) => {
    // 為子頁新增一層真實 history entry，讓返回鍵有足夠深度緩衝：
    // 從子頁連按兩次返回 = 退回首頁 + 跳離開確認，不會穿透直接關閉 App。
    window.history.pushState({ taiex: true }, "");
    screenRef.current = s;
    setScreen(s);
  };

  if (screen === "custom")  return <TrackSelect   onPick={handleStartTrack} onBack={goHome} />;
  if (screen === "random")  return <RandomSlot    onPick={handleStartTrack} onBack={goHome} />;
  if (screen === "classic") return <ClassicSelect user={user} onPick={handleStartTrack} onBack={goHome} />;
  if (screen === "garage")  return <Garage onBack={goHome} />;
  if (screen === "daily")  return (
    <DailyChallenge
      user={user}
      onPlay={(t) => { setIsDailyRun(true); handleStartTrack(t); }}
      onBack={goHome}
    />
  );
  const dismissBetaNotice = () => {
    sessionStorage.setItem("tr_beta_notice_shown", "1");
    setShowBetaNotice(false);
  };

  return (
    <>
      <Home user={user} onNav={handleNav} marketMood={marketMood} />
      {confirmLeave && (
        <div className="modal-overlay" onClick={() => setConfirmLeave(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title leave-title">再按一次返回鍵即可離開</div>
            <div className="modal-leave-hint">或點下方按鈕留下繼續玩</div>
            <button className="modal-btn" onClick={() => setConfirmLeave(false)}>留下繼續玩</button>
          </div>
        </div>
      )}
      {showBetaNotice && (
        <div className="modal-overlay">
          <div className="modal-panel">
            <div className="modal-title">14天封測進行中</div>
            <div className="modal-item">封測期間請勿解除安裝！<br />感謝各位配合測試 🙏</div>
            <div className="modal-item dim">若封測結束，此視窗將不再跳出</div>
            <button className="modal-btn" onClick={dismissBetaNotice}>我知道了</button>
          </div>
        </div>
      )}
    </>
  );
}
