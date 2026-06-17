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
import { dailyKey } from "./data/pick";
import { getPlayerId, getPlayerName } from "./lib/playerId";

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [track, setTrack] = useState<TrackData | null>(null);
  const [isDailyRun, setIsDailyRun] = useState(false);
  const goHome = useCallback(() => setScreen("home"), []);

  // App 啟動時預熱每日資料，進 DailyChallenge 時直接從快取拿，不需等待
  useEffect(() => {
    const date = dailyKey();
    fetchHardestDailyMap(date);
    fetchDailyTop(date);
  }, []);

  const handleGameOver = useCallback((stats: GameOverStats) => {
    if (isDailyRun) {
      submitDailyScore(getPlayerId(), getPlayerName(), {
        score: stats.score,
        timeMs: stats.timeMs,
        flips: stats.flips,
        perfect: stats.perfect,
      });
    }
  }, [isDailyRun]);

  // 選到賽道 → 進遊戲（離開時 setTrack(null) 會回到原本的選單畫面）
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

  if (screen === "custom") return <TrackSelect onPick={setTrack} onBack={goHome} />;
  if (screen === "random") return <RandomSlot onPick={setTrack} onBack={goHome} />;
  if (screen === "daily") return (
    <DailyChallenge
      onPlay={(t) => { setIsDailyRun(true); setTrack(t); }}
      onBack={goHome}
    />
  );
  return <Home onNav={setScreen} />;
}
