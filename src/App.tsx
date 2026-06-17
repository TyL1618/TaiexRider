import { useState, useCallback, useEffect } from "react";
import GameCanvas from "./game/GameCanvas";
import type { GameOverStats } from "./game/GameCanvas";
import TrackSelect from "./TrackSelect";
import Home, { type Screen } from "./screens/Home";
import RandomSlot from "./screens/RandomSlot";
import DailyChallenge from "./screens/DailyChallenge";
import type { TrackData } from "./data/tracks";
import { submitDailyScore, fetchDailyTop } from "./lib/leaderboard";
import { fetchHardestDailyMap } from "./lib/dailyMap";
import { onAuthStateChange, getUser, type User } from "./lib/auth";
import { getPlayerName } from "./lib/playerId";
import { dailyKey } from "./data/pick";

export default function App() {
  const [screen, setScreen]       = useState<Screen>("home");
  const [track, setTrack]         = useState<TrackData | null>(null);
  const [isDailyRun, setIsDailyRun] = useState(false);
  const [user, setUser]           = useState<User | null>(null);
  const goHome = useCallback(() => setScreen("home"), []);

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
  }, [isDailyRun, user]);

  if (track) {
    return (
      <GameCanvas
        key={track.label + track.mode}
        prices={track.prices}
        label={track.label}
        name={track.name}
        onExit={() => { setTrack(null); setIsDailyRun(false); }}
        onGameOver={handleGameOver}
      />
    );
  }

  if (screen === "custom")  return <TrackSelect onPick={setTrack} onBack={goHome} />;
  if (screen === "random")  return <RandomSlot  onPick={setTrack} onBack={goHome} />;
  if (screen === "daily")   return (
    <DailyChallenge
      user={user}
      onPlay={(t) => { setIsDailyRun(true); setTrack(t); }}
      onBack={goHome}
    />
  );
  return <Home user={user} onNav={setScreen} />;
}
