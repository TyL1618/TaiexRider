import { useState, useCallback } from "react";
import GameCanvas from "./game/GameCanvas";
import TrackSelect from "./TrackSelect";
import Home, { type Screen } from "./screens/Home";
import RandomSlot from "./screens/RandomSlot";
import DailyChallenge from "./screens/DailyChallenge";
import type { TrackData } from "./data/tracks";

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [track, setTrack] = useState<TrackData | null>(null);
  const goHome = useCallback(() => setScreen("home"), []);

  // 選到賽道 → 進遊戲（離開時 setTrack(null) 會回到原本的選單畫面）
  if (track) {
    return (
      <GameCanvas
        key={track.label + track.mode}
        prices={track.prices}
        label={track.label}
        name={track.name}
        onExit={() => setTrack(null)}
      />
    );
  }

  if (screen === "custom") return <TrackSelect onPick={setTrack} onBack={goHome} />;
  if (screen === "random") return <RandomSlot onPick={setTrack} onBack={goHome} />;
  if (screen === "daily") return <DailyChallenge onPlay={setTrack} onBack={goHome} />;
  return <Home onNav={setScreen} />;
}
