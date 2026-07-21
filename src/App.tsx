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
import LotterySlot from "./screens/LotterySlot";
import type { TrackData } from "./data/tracks";
import { submitDailyScore, fetchDailyTop, type GhostRecord } from "./lib/leaderboard";
import { submitClassicRecord } from "./lib/classicRecords";
import { fetchHardestDailyMap, fetchDailyMapList, resolveSessionDate } from "./lib/dailyMap";
import { onAuthStateChange, getUser, type User } from "./lib/auth";
import { getPlayerName } from "./lib/playerId";
import { dailyKey } from "./data/pick";
import { setPlaying } from "./pwa";
import { logEvent, type AnalyticsMode } from "./lib/analytics";
import { addCoins, earnCoins, syncWalletFromServer, grantDevWallet, recordMarketFinish, recordRunStats, maybeEarnTicket, writeCoinsCache, getActiveSkinId } from "./lib/garage";
import { recordRun } from "./lib/quests";
import { recordWeeklyRun, claimWeeklyQuest, weekKey } from "./lib/weeklyQuests";
import { collectStock } from "./lib/collection";
import { resolveMarketMood, type MarketMood } from "./lib/marketMood";
import { recordFinish } from "./lib/achievements";
import { grantPlayReward, computePlayReward } from "./lib/playRewards";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { ensureDailyReminder, maybeAskDailyReminder, onDailyReminderTapped } from "./lib/notifications";
import { checkShellUpdate, type ShellUpdateInfo } from "./lib/shellUpdate";
import { playMenuMusic, playGameMusic, pauseBgm, resumeBgm } from "./game/audio";

export default function App() {
  const [screen, setScreen]         = useState<Screen>("home");
  const [track, setTrack]           = useState<TrackData | null>(null);
  const [isDailyRun, setIsDailyRun] = useState(false);
  const [user, setUser]             = useState<User | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [marketMood, setMarketMood] = useState<MarketMood | null>(null);
  const [dailyRank, setDailyRank] = useState<number | null>(null); // 每日排名賽即時名次（提交成功後非同步算出）
  const [completedQuests, setCompletedQuests] = useState<{ title: string; reward: number }[]>([]); // 本局新完成任務（結算畫面慶祝用）
  const [ghost, setGhost] = useState<GhostRecord | null>(null); // 第一名鬼影路徑+車皮（DailyChallenge 開關+抓取後傳入）
  const [shellUpdate, setShellUpdate] = useState<ShellUpdateInfo | null>(null); // 原生殼版本落後提示（首頁顯示）
  const [walletVersion, setWalletVersion] = useState(0); // 純重繪訊號：伺服器錢包同步完成後 +1，讓首頁跟著重讀 localStorage 快取
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
  // 2026-07-09 修正：依賴陣列原本是 [user]（物件參照）——跟下面 grantDevWallet 那支
  // effect 同一種 bug，7/8 只修了 grantDevWallet 這支漏改。onAuthStateChange 連背景
  // token 自動刷新（無真正登入/登出）都會給全新 user 物件，導致這支 effect 反覆觸發
  // syncWalletFromServer()；如果玩家剛用 earnCoins()/consume_attempt() 寫入新金幣/
  // streak，這支背景重觸發的 wallet_get() 若比較晚回來，會把剛寫入的新值蓋回舊值——
  // 這是「回車庫/回首頁金幣歸零」與「連續參賽要玩 2、3 場才顯示」的根因。改依 user?.id
  // （穩定字串）比較，只有真的登入/登出/換帳號才重新觸發。
  //
  // 2026-07-16 補：同步完成後 bump walletVersion 讓首頁跟著重繪。車庫頁自己有掛載時
  // 同步+重讀 state 的 effect（見 Garage.tsx）所以沒這問題，但首頁在登入後全程不會
  // 卸載重掛載——getCoins()/getActiveBikeSkin() 這類直接讀 localStorage 的呼叫寫在
  // render 裡，sync 完成後 localStorage 值變了，可是沒有任何 React state 變動去
  // 觸發首頁重繪，玩家得手動切去別的分頁再切回來才會看到新值。walletVersion 純粹
  // 當「重繪訊號」用，Home 不需要真的讀它的值。
  useEffect(() => {
    if (!user) return;
    syncWalletFromServer().then(() => setWalletVersion((v) => v + 1));
  }, [user?.id]);

  // 開發者測試帳號：登入即補滿金幣+鑽石+Q 系列成就進度+streak（wallet_dev_grant RPC，
  // JWT email 綁定於伺服器端，非開發者帳號呼叫會被靜默拒絕），方便真機測車庫購買/裝備/
  // 解鎖 UI 不用真的刷任務、真的等大漲大跌日、真的連續玩 30 天。
  // 2026-07-06 起改成單一 RPC 直接寫伺服器 player_achievements/player_streak，
  // 取代舊版前端 devSetProgress()/devForceStreak() 純本地寫死（那正是同裝置切換
  // 帳號會互相污染的源頭之一，見 achievements.ts/streak.ts 開頭說明）。
  // 2026-07-08 修正：依賴陣列原本是 [user]（物件參照），Supabase onAuthStateChange
  // 連 token 背景自動更新這種沒有真的登入/登出的事件都會給一個全新的 user 物件，
  // 導致這支 effect 被重複觸發、金幣被重新設回 99999——玩家買車皮等操作讓餘額降到
  // 99999 以下後，只要背景再觸發一次，餘額就會無預警跳回滿格，被誤以為是遊戲給的
  // 獎勵（2026-07-08 使用者用開發者帳號測試時回報）。改成依 email（穩定字串）比較，
  // 只有「真的登入/登出/換帳號」才會重新觸發。
  useEffect(() => {
    if (user?.email !== "tyl161803@gmail.com") return;
    grantDevWallet();
  }, [user?.email]);

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

  // 每日提醒（原生殼限定）：啟動時只在「已授權」的前提下重排程，不跳權限框
  //（權限請求在第一局玩完才問，見 handleGameOver 的 maybeAskDailyReminder()）。
  useEffect(() => { ensureDailyReminder(); }, []);

  // 殼版本更新提示（原生殼限定，網頁版靠 pwa.ts 的 Service Worker 自動更新不需要
  // 這層）：啟動時查一次，本機版號落後就在首頁顯示可關閉的提示條。
  useEffect(() => { checkShellUpdate().then(setShellUpdate); }, []);

  // 背景音樂：track 有值＝實際在跑賽道（GameCanvas 掛載中）放 hiding-your-reality，
  // 否則（首頁/車庫/選單/每日排名賽列表等所有非遊玩畫面）放 galactic-rap。
  // 冷啟動首頁那次很可能被行動瀏覽器 autoplay 政策擋下，audio.ts 內部會掛一次性
  // pointerdown 監聽自動重試，這裡不用特別處理。
  useEffect(() => {
    if (track) playGameMusic();
    else playMenuMusic();
  }, [track]);

  // App 切到背景（原生殼切去其他 App、或分頁被切走/縮小)自動暫停 BGM，回前景恢復。
  // Capacitor appStateChange 涵蓋原生殼「切去其他 App」；visibilitychange 額外涵蓋
  // 桌機/PWA 分頁切走（原生殼 WebView 通常也會同步觸發，兩者疊加無害，pause 是冪等的）。
  useEffect(() => {
    let appHandle: { remove: () => void } | undefined;
    if (Capacitor.isNativePlatform()) {
      CapApp.addListener("appStateChange", ({ isActive }) => {
        if (isActive) resumeBgm(); else pauseBgm();
      }).then((h) => { appHandle = h; });
    }
    const onVisibility = () => {
      if (document.hidden) pauseBgm(); else resumeBgm();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      appHandle?.remove();
    };
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
        if (Capacitor.isNativePlatform()) {
          CapApp.exitApp();               // Capacitor 原生殼：真正結束 App（window.close 無效）
        } else {
          window.close();                 // 桌機 PWA 有效；TWA 被封鎖則由下一行接手
          window.history.go(-window.history.length);
        }
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

    // Capacitor 原生殼：實體返回鍵 → 轉成 window.history.back()，交給上面同一套 popstate
    // 邏輯處理（子頁→首頁、首頁→確認離開、確認離開→exitApp），跟 TWA 時代實體返回鍵
    // 行為完全一致。Capacitor 把實體返回鍵委派給 @capacitor/app 的 backButton 事件——
    // 不裝/不接的話返回鍵完全沒反應，這正是換殼後「叫出導覽列按返回沒作用」的根因。
    let backHandle: { remove: () => void } | undefined;
    if (Capacitor.isNativePlatform()) {
      CapApp.addListener("backButton", () => { window.history.back(); })
        .then((h) => { backHandle = h; });
    }

    window.addEventListener("popstate", onPop);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("beforeunload", onBeforeUnload);
      backHandle?.remove();
    };
  }, []); // 只在 App 掛載時執行一次，永遠不移除

  // App 捷徑 / 深連結：?goto=daily|random|custom|classic 直接跳到子頁。
  // 來源：Android App Shortcuts（長按圖示）、PWA manifest shortcuts、分享連結。
  // 清掉參數（replaceState）避免重整重複觸發；補一層 pushState 讓返回鍵行為
  // 與 handleNav 正常導航一致（返回 = 回首頁）。放在 history effect 之後執行，
  // 疊在哨兵 entry 之上。
  useEffect(() => {
    const goto = new URLSearchParams(window.location.search).get("goto");
    if (goto === "daily" || goto === "random" || goto === "custom" || goto === "classic" || goto === "lottery") {
      window.history.replaceState(null, "", window.location.pathname);
      window.history.pushState({ taiex: true }, "");
      screenRef.current = goto;
      setScreen(goto);
    }
  }, []);

  // 每日提醒通知點擊 deep link（原生殼限定）：落在每日排名賽畫面，不自動開局
  //（玩家自己按開始，行為跟 App 捷徑一致）。若當下正在賽道中，只更新 screen 狀態，
  // 等玩家離開賽道後自然落在這個畫面，不打斷正在進行的一局。
  useEffect(() => {
    return onDailyReminderTapped(() => {
      window.history.pushState({ taiex: true }, "");
      screenRef.current = "daily";
      setScreen("daily");
    });
  }, []);

  const handleGameOver = useCallback((stats: GameOverStats) => {
    // 每日提醒權限：第一局玩完（已投入）這個時點才問，只問一次；已授權/已拒絕都 no-op。
    maybeAskDailyReminder();
    if (isDailyRun && user) {
      submitDailyScore(getPlayerName(), {
        score:   stats.score,
        timeMs:  stats.timeMs,
        flips:   stats.flips,
        perfect: stats.perfect,
        skinId:  getActiveSkinId(user?.id ?? null),
        replay:  stats.replay,
      }).then(async () => {
        // 排名賽結算即時名次回饋：提交成功後重抓（快取已被 submitDailyScore 內部清掉）
        // 排行榜，用「精確比對剛提交的分數+時間」找自己那一列——ScoreRow 沒有 player_id
        // （anon key 讀不到），分數+時間精確相同機率極低，可視為唯一辨識。伺服器端若
        // 靜默拒絕了這筆（冷卻/物理驗證未過），這裡就找不到自己，不顯示名次，不臆測。
        const key = await resolveSessionDate(dailyKey());
        const rows = await fetchDailyTop(key);
        const myScore = Math.round(stats.score);
        const myTimeMs = Math.round(stats.timeMs);
        const idx = rows.findIndex((r) => r.score === myScore && r.time_ms === myTimeMs);
        if (idx >= 0) setDailyRank(idx + 1);
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
      // 一般/長征模式結算機率型票券獎勵（使用者拍板：票券不該只有看廣告一種
      // 來源，這樣才會吸引玩家玩排行榜以外的模式），排行榜/經典模式不給
      // （避免跟那兩個模式的鑽石獎勵疊加太多管道）。8% 機率、每日上限 3 張，
      // 見 wallet_maybe_earn_ticket()。
      if (user) maybeEarnTicket();
    }
    // 稱號成就（連勝狂魔/排行榜常客/空中飛人/地心引力挑戰者/完美落地大師）不分
    // 模式累計終身翻轉圈數/完美落地次數，跟 Q 系列車款同一套「不分模式累計」
    // 哲學（見 record_market_finish 同段落）。
    if (user) recordRunStats(stats.flips, stats.perfect);
    // 狂暴盤日（|漲跌|≥2.5%）任務獎勵 ×2：已登入時伺服器 wallet_earn/claim_weekly_quest
    // 各自重算當期漲跌決定是否加倍（不信任前端），這裡的倍率只影響未登入玩家的本地樂觀值。
    const rageMultiplier = marketMood?.isRage ? 2 : 1;
    // 每日任務：用裝置本地日曆日累計，跨模式共用同一組任務池
    const newlyDone = recordRun(dailyKey(), {
      score: stats.score, flips: stats.flips, perfect: stats.perfect, timeMs: stats.timeMs,
      finished: stats.finished, mode, marketMood: marketMood?.mood ?? null,
    }, user?.id ?? null);
    for (const q of newlyDone) { addCoins(q.reward * rageMultiplier); earnCoins("quest"); }
    // 結算畫面任務完成慶祝：每日任務同步算好，直接加進清單（週任務見下方 async 區塊）
    if (newlyDone.length > 0) {
      setCompletedQuests((prev) => [...prev, ...newlyDone.map((q) => ({ title: q.title, reward: q.reward * rageMultiplier }))]);
    }
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
      if (newlyDoneWeekly.length > 0) {
        setCompletedQuests((prev) => [...prev, ...newlyDoneWeekly.map((q) => ({ title: q.title, reward: q.reward * rageMultiplier }))]);
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
    setDailyRank(null);       // 新的一局：清掉上一局的名次回饋
    setCompletedQuests([]);   // 新的一局：清掉上一局的任務慶祝清單
    setPlaying(true); // 遊玩中：暫緩 SW 自動更新 reload
  };
  const handleExitTrack = useCallback(() => {
    trackRef.current = null;
    setTrack(null);
    setIsDailyRun(false);
    setGhost(null); // 離開賽道：清掉這局的鬼影資料，避免殘留到下一個非排名賽模式
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
          dailyRank={dailyRank}
          completedQuests={completedQuests}
          ghostPath={isDailyRun ? ghost?.path ?? null : null}
          ghostSkinId={isDailyRun ? ghost?.skinId ?? null : null}
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
  if (screen === "lottery") return <LotterySlot user={user} onBack={goHome} />;
  if (screen === "daily")  return (
    <DailyChallenge
      user={user}
      onPlay={(t, g) => { setIsDailyRun(true); setGhost(g); handleStartTrack(t); }}
      onBack={goHome}
    />
  );

  return (
    <>
      <Home user={user} onNav={handleNav} marketMood={marketMood} shellUpdate={shellUpdate} walletVersion={walletVersion} />
      {confirmLeave && (
        <div className="modal-overlay" onClick={() => setConfirmLeave(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title leave-title">再按一次返回鍵即可離開</div>
            <div className="modal-leave-hint">或點下方按鈕留下繼續玩</div>
            <button className="modal-btn" onClick={() => setConfirmLeave(false)}>留下繼續玩</button>
          </div>
        </div>
      )}
    </>
  );
}
