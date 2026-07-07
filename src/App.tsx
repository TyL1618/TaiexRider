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
import { addCoins, earnCoins, syncWalletFromServer, grantDevWallet, recordMarketFinish, writeCoinsCache } from "./lib/garage";
import { recordRun } from "./lib/quests";
import { recordWeeklyRun, claimWeeklyQuest, weekKey } from "./lib/weeklyQuests";
import { collectStock } from "./lib/collection";
import { resolveMarketMood, type MarketMood } from "./lib/marketMood";
import { recordFinish } from "./lib/achievements";
import { grantPlayReward, computePlayReward } from "./lib/playRewards";

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

  // 任何已登入玩家：把伺服器錢包（金幣/鑽石/擁有清單/成就進度/streak，2026-07-05~06
  // 起改伺服器端權威）拉到本地快取——換裝置/換帳號登入或清過 localStorage 時，
  // 畫面才不會卡在舊值，也不會誤讀到裝置上殘留的「另一個帳號」的資料。
  useEffect(() => {
    if (user) syncWalletFromServer();
  }, [user]);

  // 開發者測試帳號：登入即補滿金幣+鑽石+Q 系列成就進度+streak（wallet_dev_grant RPC，
  // JWT email 綁定於伺服器端，非開發者帳號呼叫會被靜默拒絕），方便真機測車庫購買/裝備/
  // 解鎖 UI 不用真的刷任務、真的等大漲大跌日、真的連續玩 30 天。
  // 2026-07-06 起改成單一 RPC 直接寫伺服器 player_achievements/player_streak，
  // 取代舊版前端 devSetProgress()/devForceStreak() 純本地寫死（那正是同裝置切換
  // 帳號會互相污染的源頭之一，見 achievements.ts/streak.ts 開頭說明）。
  useEffect(() => {
    if (user?.email !== "tyl161803@gmail.com") return;
    grantDevWallet();
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
    // 車庫金幣：完賽/摔車給小額基本獎勵，但排行榜賽事跟經典模式不給金幣——這兩個模式
    // 2026-07-08 改成鑽石獎勵（排行榜：參與+名次分級／經典：每週前三名），避免金幣+鑽石
    // 雙重發放。長征模式（5 支股票串成一趟）金幣公式跟一般模式不同，見 computePlayReward()。
    // 單日總量上限 100（playRewards.ts，跟看廣告/任務的各自每日上限彼此獨立），看廣告
    // 雙倍本局金幣也算在這桶內（GameCanvas.tsx 內自己再呼叫一次同一組函式）。
    // addCoins 做本地樂觀更新（不管有沒有登入都立刻反映在畫面上）；earnCoins 已登入時
    // 背景呼叫伺服器 RPC 覆寫成真實餘額（伺服器端同一套上限，見 wallet_earn()），
    // 未登入時 earnCoins 直接略過。
    const mode = analyticsModeRef.current;
    const coinEligible = mode !== "daily" && mode !== "classic";
    if (coinEligible) {
      const isLong = mode === "long";
      const amount = computePlayReward(isLong, stats.finished, stats.progressPct);
      addCoins(grantPlayReward(dailyKey(), amount, user?.id ?? null));
      const kind = isLong
        ? (stats.finished ? "long_finish" : "long_crash")
        : (stats.finished ? "finish" : "crash");
      earnCoins(kind, kind === "long_crash" ? amount : undefined);
    }
    // 狂暴盤日（|漲跌|≥2.5%）任務獎勵 ×2：已登入時伺服器 wallet_earn/claim_weekly_quest
    // 各自重算當期漲跌決定是否加倍（不信任前端），這裡的倍率只影響未登入玩家的本地樂觀值。
    const rageMultiplier = marketMood?.isRage ? 2 : 1;
    // 每日任務：用裝置本地日曆日累計，跨模式共用同一組任務池
    const newlyDone = recordRun(dailyKey(), {
      score: stats.score, flips: stats.flips, perfect: stats.perfect, timeMs: stats.timeMs,
      finished: stats.finished, mode, marketMood: marketMood?.mood ?? null,
    }, user?.id ?? null);
    for (const q of newlyDone) { addCoins(q.reward * rageMultiplier); earnCoins("quest"); }
    // 週任務：仿每日任務，但用 ISO 週別累計，需登入才有伺服器權威進度（詳見 weeklyQuests.ts）
    const week = weekKey();
    recordWeeklyRun(week, {
      score: stats.score, flips: stats.flips, perfect: stats.perfect, timeMs: stats.timeMs,
      finished: stats.finished, mode, marketMood: marketMood?.mood ?? null,
    }).then(async (newlyDoneWeekly) => {
      for (const q of newlyDoneWeekly) {
        const result = await claimWeeklyQuest(week, q.id);
        if (result.coins !== null) writeCoinsCache(result.coins);
        else addCoins(q.reward * rageMultiplier);
      }
    });
    // 股票圖鑑：自選/長征模式騎過的個股才算（kind==='stock'，daily/classic 排除在外）；
    // 長征一次串 5 支，代號放在 subtitle（換行分隔）。跟哪一天的盤勢無關，同一支重複騎不重複計。
    const t = trackRef.current;
    if (t?.kind === "stock") {
      const codes = t.mode === "long" ? (t.subtitle?.split("\n") ?? []) : [t.label];
      for (const code of codes) { if (code) collectStock(code); }
    }
    // Q 系列成就：完賽才算，依當期大盤漲跌累計。已登入時改由伺服器 record_market_finish
    // RPC 自己重算當期 TAIEX 漲跌（不信任前端傳的 mood），未登入才用本地 recordFinish()。
    if (stats.finished) {
      if (user) recordMarketFinish();
      else recordFinish(marketMood?.mood ?? null);
    }
  }, [isDailyRun, user, marketMood]);

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
          uid={user?.id ?? null}
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
  if (screen === "garage")  return <Garage user={user} onBack={goHome} />;
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
