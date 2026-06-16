import { useState } from "react";
import GameCanvas from "./game/GameCanvas";
import TrackSelect from "./TrackSelect";
import type { TrackData } from "./data/tracks";

export default function App() {
  const [track, setTrack] = useState<TrackData | null>(null);

  if (!track) return <TrackSelect onPick={setTrack} />;

  return (
    <GameCanvas
      key={track.label}
      prices={track.prices}
      label={track.label}
      name={track.name}
      onExit={() => setTrack(null)}
    />
  );
}
