// [DEV ONLY] 手感調參面板。只在 npm run dev 出現；正式建置由 GameCanvas 的
// import.meta.env.DEV 動態載入條件整段消掉，不會進玩家的 bundle。
import { useEffect, useRef, useState } from "react";
import { PARAMS, exportSnippet, getDefault, getValue, isDirty, resetAll, setValue, type ParamDef } from "./devTuning";
import { runSinkScan, type ScanResult } from "./devSinkSim";
import "./DevTuner.css";

interface LiveStats {
  sink: number; maxSink: number; speed: number; stepMove: number;
  subSteps: number; grounded: boolean; wheelRadius: number;
}

const GROUP_LABEL: Record<string, string> = {
  PHYSICS: "物理 / 碰撞正確性",
  DRIVE: "手感（即時生效）",
  BIKE: "車體幾何（需重開一局）",
};

export default function DevTuner() {
  const [open, setOpen] = useState(false);
  const [, forceRender] = useState(0);
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [toast, setToast] = useState("");
  const runsRef = useRef(200);

  // 即時讀數：GameCanvas 每幀寫 window.__devStats
  useEffect(() => {
    const id = setInterval(() => {
      const s = (window as unknown as { __devStats?: LiveStats }).__devStats;
      if (s) setStats({ ...s });
    }, 100);
    return () => clearInterval(id);
  }, []);

  const restartRun = () => {
    const t = (window as unknown as { __test?: { reset: () => void } }).__test;
    t?.reset();
    setScan(null);
  };

  const onSlide = (p: ParamDef, v: number) => {
    setValue(p, v);
    forceRender((n) => n + 1);
  };

  const doScan = async () => {
    setScanning(true);
    setProgress(0);
    setScan(null);
    // 讓 setState 先 paint 出「計算中」再開跑
    await new Promise((r) => setTimeout(r, 0));
    const r = await runSinkScan(runsRef.current, setProgress);
    setScan(r);
    setScanning(false);
  };

  const copySnippet = async () => {
    const text = exportSnippet();
    try {
      await navigator.clipboard.writeText(text);
      setToast("已複製到剪貼簿");
    } catch {
      setToast("複製失敗，請看 console");
      console.info(text);
    }
    setTimeout(() => setToast(""), 1800);
  };

  if (!open) {
    return (
      <button className="devtuner-fab" onClick={() => setOpen(true)} title="開發用調參面板">
        ⚙
      </button>
    );
  }

  const submergeRatio = scan ? (scan.submergedRuns / scan.runs) * 100 : 0;
  const deepRatio = scan ? (scan.deepRuns / scan.runs) * 100 : 0;
  const groups = ["PHYSICS", "DRIVE", "BIKE"] as const;

  return (
    <div className="devtuner">
      <header className="devtuner-head">
        <strong>調參面板</strong>
        <span className="devtuner-badge">DEV</span>
        <button className="devtuner-x" onClick={() => setOpen(false)}>✕</button>
      </header>

      {/* 即時讀數：調滑桿時直接看車子有沒有陷進地形 */}
      <div className="devtuner-live">
        {stats ? (
          <>
            <div className={`dt-stat ${stats.sink > stats.wheelRadius ? "bad" : stats.sink > 1 ? "warn" : "ok"}`}>
              <span>目前 sink</span><b>{stats.sink.toFixed(1)}px</b>
            </div>
            <div className={`dt-stat ${stats.maxSink > 2 * stats.wheelRadius ? "bad" : stats.maxSink > stats.wheelRadius ? "warn" : "ok"}`}>
              <span>本局最大</span><b>{stats.maxSink.toFixed(1)}px</b>
            </div>
            <div className={`dt-stat ${stats.stepMove >= stats.wheelRadius ? "bad" : "ok"}`}>
              <span>單步位移</span><b>{stats.stepMove.toFixed(2)}px</b>
            </div>
            <div className="dt-stat"><span>速度</span><b>{stats.speed.toFixed(2)}</b></div>
          </>
        ) : (
          <div className="dt-hint">開始遊戲後顯示即時讀數</div>
        )}
      </div>
      {stats && (
        <p className="dt-legend">
          sink = 輪半徑 − 輪心到地表距離。0 ≈ 貼地，&gt;{stats.wheelRadius} 表示輪心已在地表下，
          &gt;{2 * stats.wheelRadius} 整顆輪子沒入（＝破圖）。單步位移需 &lt; 輪半徑 {stats.wheelRadius}px。
        </p>
      )}

      <div className="devtuner-body">
        {groups.map((g) => (
          <section key={g}>
            <h4>{GROUP_LABEL[g]}</h4>
            {PARAMS.filter((p) => p.group === g).map((p) => {
              const v = getValue(p);
              const dirty = isDirty(p);
              return (
                <div className="dt-row" key={`${p.group}.${p.key}`}>
                  <label>
                    <span className={dirty ? "dt-dirty" : ""}>{p.label}</span>
                    <em>{p.step >= 1 ? v : v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}</em>
                  </label>
                  <input
                    type="range" min={p.min} max={p.max} step={p.step} value={v}
                    onChange={(e) => onSlide(p, parseFloat(e.target.value))}
                  />
                  {dirty && <button className="dt-revert" onClick={() => onSlide(p, getDefault(p))}>↺ {getDefault(p)}</button>}
                  {p.hint && <small>{p.hint}</small>}
                </div>
              );
            })}
          </section>
        ))}

        {/* 自動驗證：用目前參數跑真實地形，直接看沉沒率 */}
        <section>
          <h4>自動驗證（跑真實股價地形）</h4>
          <div className="dt-scanrow">
            {[100, 200, 500].map((n) => (
              <button key={n} className={runsRef.current === n ? "on" : ""}
                onClick={() => { runsRef.current = n; forceRender((x) => x + 1); }}>{n} 局</button>
            ))}
            <button className="dt-run" disabled={scanning} onClick={doScan}>
              {scanning ? `計算中 ${progress}/${runsRef.current}` : "▶ 開始驗證"}
            </button>
          </div>
          {scan && (
            <div className="dt-scanres">
              <div className={deepRatio > 0 ? "bad" : "ok"}>
                整顆輪子沒入：<b>{scan.deepRuns}/{scan.runs}（{deepRatio.toFixed(1)}%）</b>
              </div>
              <div className={submergeRatio > 5 ? "warn" : "ok"}>
                輪心沒入地表：{scan.submergedRuns}/{scan.runs}（{submergeRatio.toFixed(1)}%）
              </div>
              <div>最深 sink：<b>{scan.maxSink.toFixed(1)}px</b>　單步位移：{scan.stepMove.toFixed(2)}px</div>
              <div>完賽 {scan.finished}　摔車 {scan.deathTopHit}　卡住 {scan.timeout}</div>
              <small>摔車數若隨參數大幅下降，代表原本有一部分「死亡」其實是穿透 bug 造成的。</small>
            </div>
          )}
        </section>
      </div>

      <footer className="devtuner-foot">
        <button onClick={restartRun}>重開這局</button>
        <button onClick={() => { resetAll(); forceRender((n) => n + 1); }}>還原預設</button>
        <button className="dt-primary" onClick={copySnippet}>複製設定</button>
        {toast && <span className="dt-toast">{toast}</span>}
      </footer>
    </div>
  );
}
