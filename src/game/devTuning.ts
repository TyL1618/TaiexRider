// ============================================================
// [DEV ONLY] 手感調參 —— 執行期直接改 constants.ts 匯出的物件
//
// 為什麼可以這樣做：`export const DRIVE = {...} as const` 的 `as const` 只是
// **TypeScript 編譯期**的唯讀標記，執行期並沒有 Object.freeze。所以只要在這裡
// 把值寫回同一個物件，遊戲裡所有讀取點（GameCanvas 每幀讀 DRIVE.cruiseSpeed 等）
// 下一幀就自動吃到新值，完全不用改動遊戲程式碼、不用重新 render。
//
// 整個檔案只在 `import.meta.env.DEV` 下被載入（見 GameCanvas 的動態 import），
// 正式建置會被 tree-shake 掉，不會出現在玩家的 bundle 裡。
//
// ⚠️ 這裡調出來的值不會自動寫回 constants.ts。滿意之後用面板的「複製設定」
// 把片段貼回 src/game/constants.ts 才算真的落地。
// ============================================================

import { BIKE, DRIVE, PHYSICS } from "./constants";

export type GroupName = "DRIVE" | "PHYSICS" | "BIKE";

export interface ParamDef {
  group: GroupName;
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  /** 幾何類參數已烘進剛體，改了要重開一局才生效 */
  needsRestart?: boolean;
  hint?: string;
}

// 執行期可改的物件（型別上是 readonly，這裡故意當成可寫的字典操作）
const GROUPS: Record<GroupName, Record<string, number>> = {
  DRIVE: DRIVE as unknown as Record<string, number>,
  PHYSICS: PHYSICS as unknown as Record<string, number>,
  BIKE: BIKE as unknown as Record<string, number>,
};

export const PARAMS: ParamDef[] = [
  // ── 碰撞正確性（這次修 bug 的主角）──
  { group: "PHYSICS", key: "subSteps", label: "物理子步數", min: 1, max: 4, step: 1,
    hint: "單步位移 = 巡航速度 ÷ 子步數，必須 < 輪半徑才不會穿進地形" },
  { group: "PHYSICS", key: "positionIterations", label: "位置迭代", min: 2, max: 20, step: 1,
    hint: "Matter 預設 6；提高只能緩解深穿透，不治本" },
  { group: "PHYSICS", key: "velocityIterations", label: "速度迭代", min: 2, max: 20, step: 1, hint: "Matter 預設 4" },
  { group: "PHYSICS", key: "gravityY", label: "重力", min: 0.1, max: 1.5, step: 0.05,
    hint: "低重力 = 滯空久、翻轉窗口寬" },

  // ── 地面手感 ──
  { group: "DRIVE", key: "cruiseSpeed", label: "巡航速度", min: 2, max: 12, step: 0.05,
    hint: "沿坡面鎖定的速度 (px/幀)" },
  { group: "DRIVE", key: "groundLockEase", label: "鎖速收斂", min: 0.05, max: 1, step: 0.05,
    hint: "越大越快達到巡航速度（過折點的爆衝感）" },
  { group: "DRIVE", key: "groundAlignGain", label: "貼坡修正力", min: 0.05, max: 1, step: 0.05,
    hint: "車身角度朝坡面對齊的比例" },
  { group: "DRIVE", key: "groundedAvMax", label: "貼坡角速上限", min: 0.02, max: 0.6, step: 0.01 },

  // ── 空中手感 ──
  { group: "DRIVE", key: "airSpinAccel", label: "後空翻加速", min: 0.004, max: 0.08, step: 0.002 },
  { group: "DRIVE", key: "airSpinMax", label: "後空翻最大角速", min: 0.05, max: 0.5, step: 0.008 },
  { group: "DRIVE", key: "airSpinBrakeAccel", label: "放開制動力", min: 0.01, max: 0.2, step: 0.01 },
  { group: "DRIVE", key: "airNoseForwardMax", label: "車頭前壓上限", min: 0.001, max: 0.05, step: 0.001 },

  // ── 車體幾何（需重開一局）──
  { group: "BIKE", key: "wheelRadius", label: "車輪半徑", min: 4, max: 14, step: 0.5, needsRestart: true,
    hint: "加大也能避免穿透，但會改變過谷/翻越手感" },
  { group: "BIKE", key: "chassisRadius", label: "車身半徑", min: 6, max: 16, step: 0.5, needsRestart: true },
  { group: "BIKE", key: "wheelBaseHalf", label: "半軸距", min: 12, max: 32, step: 1, needsRestart: true },
];

// 模組載入當下先拍一份原始預設值（＝constants.ts 目前寫死的值）
const DEFAULTS: Record<string, number> = {};
for (const p of PARAMS) DEFAULTS[`${p.group}.${p.key}`] = GROUPS[p.group][p.key];

const STORAGE_KEY = "tr_dev_tuning";

export function getValue(p: ParamDef): number {
  return GROUPS[p.group][p.key];
}
export function getDefault(p: ParamDef): number {
  return DEFAULTS[`${p.group}.${p.key}`];
}
export function isDirty(p: ParamDef): boolean {
  return Math.abs(getValue(p) - getDefault(p)) > 1e-9;
}

export function setValue(p: ParamDef, v: number): void {
  GROUPS[p.group][p.key] = v;
  persist();
}

function persist(): void {
  try {
    const out: Record<string, number> = {};
    for (const p of PARAMS) if (isDirty(p)) out[`${p.group}.${p.key}`] = getValue(p);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
  } catch { /* localStorage 不可用時純記憶體調參即可 */ }
}

/** 開機時把上次調的值套回 constants 物件。必須在建立世界/車體之前呼叫。 */
export function loadSavedTuning(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as Record<string, number>;
    for (const p of PARAMS) {
      const v = saved[`${p.group}.${p.key}`];
      if (typeof v === "number" && Number.isFinite(v)) GROUPS[p.group][p.key] = v;
    }
  } catch { /* 壞掉的存檔直接忽略，用預設值 */ }
}

export function resetAll(): void {
  for (const p of PARAMS) GROUPS[p.group][p.key] = getDefault(p);
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

/** 產生可直接貼回 constants.ts 的片段（只列有改過的值） */
export function exportSnippet(): string {
  const byGroup: Record<string, string[]> = {};
  for (const p of PARAMS) {
    if (!isDirty(p)) continue;
    (byGroup[p.group] ??= []).push(`  ${p.key}: ${+getValue(p).toFixed(6)}, // 原本 ${getDefault(p)}`);
  }
  const keys = Object.keys(byGroup);
  if (!keys.length) return "// 沒有任何參數被改動（全部維持 constants.ts 預設值）";
  return keys.map((g) => `// ── ${g} ──\n${byGroup[g].join("\n")}`).join("\n\n");
}

// ── 遊戲每幀寫入的即時讀數（GameCanvas 的 DEV 區塊）──
export interface DevStats {
  sink: number;       // 輪半徑 − 輪心到地表最短距離；>0 = 已陷入
  maxSink: number;    // 本局最大值
  speed: number;      // px/幀
  stepMove: number;   // 單步位移 = speed / subSteps
  subSteps: number;
  grounded: boolean;
}
export const devStats: DevStats = { sink: 0, maxSink: 0, speed: 0, stepMove: 0, subSteps: 1, grounded: false };
export function resetDevStats(): void {
  devStats.sink = 0; devStats.maxSink = 0; devStats.speed = 0; devStats.stepMove = 0;
}
