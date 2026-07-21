// Web Audio API 程式生成音效 — 不需外部音檔，純振盪器 + 噪音合成

const VOLUME_KEY = "taiexVolume";

let _ctx: AudioContext | null = null;
let _masterGain: GainNode | null = null;

function ctx(): AudioContext {
  if (!_ctx) _ctx = new AudioContext();
  if (_ctx.state === "suspended") void _ctx.resume();
  return _ctx;
}

function masterGain(): GainNode {
  const c = ctx();
  if (!_masterGain) {
    _masterGain = c.createGain();
    _masterGain.gain.value = parseFloat(localStorage.getItem(VOLUME_KEY) ?? "0.8");
    _masterGain.connect(c.destination);
  }
  return _masterGain;
}

export function setVolume(v: number) {
  const clamped = Math.max(0, Math.min(1, v));
  localStorage.setItem(VOLUME_KEY, String(clamped));
  if (_masterGain) _masterGain.gain.value = clamped;
}

export function getVolume(): number {
  return parseFloat(localStorage.getItem(VOLUME_KEY) ?? "0.8");
}

// ---- 一次性音效 ----

export function playFlip() {
  const c = ctx();
  const now = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.connect(gain);
  gain.connect(masterGain());
  osc.type = "sine";
  osc.frequency.setValueAtTime(160, now);
  osc.frequency.exponentialRampToValueAtTime(520, now + 0.18);
  gain.gain.setValueAtTime(0.22, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
  osc.start(now);
  osc.stop(now + 0.3);
}

export function playPerfectLanding() {
  const c = ctx();
  const now = c.currentTime;
  // C5 → E5 → G5 快速上行琶音
  for (const [delay, freq] of [[0, 523], [0.09, 659], [0.18, 784]] as [number, number][]) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain);
    gain.connect(masterGain());
    osc.type = "triangle";
    osc.frequency.value = freq;
    const t = now + delay;
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.32, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    osc.start(t);
    osc.stop(t + 0.47);
  }
}

export function playCrash() {
  const c = ctx();
  const now = c.currentTime;
  const rate = c.sampleRate;
  const buf = c.createBuffer(1, Math.floor(rate * 0.5), rate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filt = c.createBiquadFilter();
  filt.type = "bandpass";
  filt.frequency.value = 350;
  filt.Q.value = 0.6;
  const gain = c.createGain();
  src.connect(filt);
  filt.connect(gain);
  gain.connect(masterGain());
  gain.gain.setValueAtTime(1.1, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
  src.start(now);
  src.stop(now + 0.6);
}

export function playFinish() {
  const c = ctx();
  const now = c.currentTime;
  // C4 → E4 → G4 → C5 凱旋琶音
  for (const [delay, freq] of [[0, 262], [0.12, 330], [0.24, 392], [0.36, 523]] as [number, number][]) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain);
    gain.connect(masterGain());
    osc.type = "triangle";
    osc.frequency.value = freq;
    const t = now + delay;
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.28, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    osc.start(t);
    osc.stop(t + 0.57);
  }
}

// ---- 拉霸機音效（RandomSlot）----

// 「喀」：木頭響板/木屐敲擊聲（v0.12.21 改木頭質感，原低頻方波太像悶電子聲）。
// 木頭聲的物理特徵＝短促共振體：能量集中在一兩個共振峰、衰減極快、幾乎沒有低頻底。
// 配方＝白噪音脈衝打進高 Q bandpass 共振器（模擬木頭腔體共振）＋一個快速降頻+
// 衰減的正弦當「木頭本體」敲擊感；頻率帶隨機讓連續 tick 不死板；音量低（連發不吵）。
export function playSlotTick() {
  const c = ctx();
  const now = c.currentTime;
  const f0 = 950 + Math.random() * 200;

  // 木頭本體：短促降頻正弦，<25ms 衰減乾淨
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.connect(gain);
  gain.connect(masterGain());
  osc.type = "sine";
  osc.frequency.setValueAtTime(f0, now);
  osc.frequency.exponentialRampToValueAtTime(f0 * 0.75, now + 0.02);
  gain.gain.setValueAtTime(0.12, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.022);
  osc.start(now);
  osc.stop(now + 0.025);

  // 共振腔體：白噪音打高 Q bandpass，模擬木頭撞擊的顆粒共振
  const rate = c.sampleRate;
  const buf = c.createBuffer(1, Math.floor(rate * 0.02), rate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const nf = c.createBiquadFilter();
  nf.type = "bandpass";
  nf.frequency.value = f0 * 1.1;
  nf.Q.value = 7;
  const ng = c.createGain();
  src.connect(nf);
  nf.connect(ng);
  ng.connect(masterGain());
  ng.gain.setValueAtTime(0.1, now);
  ng.gain.exponentialRampToValueAtTime(0.001, now + 0.018);
  src.start(now);
  src.stop(now + 0.02);
}

// 「哐」：winner 落定收尾——低頻 thunk + 一點噪音，強化「停止」手感
export function playSlotStop() {
  const c = ctx();
  const now = c.currentTime;
  // 低頻 thunk
  const osc = c.createOscillator();
  const og = c.createGain();
  osc.connect(og);
  og.connect(masterGain());
  osc.type = "square";
  osc.frequency.setValueAtTime(240, now);
  osc.frequency.exponentialRampToValueAtTime(110, now + 0.1);
  og.gain.setValueAtTime(0.3, now);
  og.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
  osc.start(now);
  osc.stop(now + 0.2);
  // 金屬感短噪音
  const rate = c.sampleRate;
  const buf = c.createBuffer(1, Math.floor(rate * 0.08), rate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filt = c.createBiquadFilter();
  filt.type = "highpass";
  filt.frequency.value = 2500;
  const ng = c.createGain();
  src.connect(filt);
  filt.connect(ng);
  ng.connect(masterGain());
  ng.gain.setValueAtTime(0.12, now);
  ng.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
  src.start(now);
  src.stop(now + 0.09);
}

// ---- 抽獎轉輪音效（LotterySlot，質感獨立於選賽道拉霸機，走「水晶鈴」音色）----

// 「叮」：水晶鈴滾輪音，用純正弦+泛音疊加取代木頭撞擊感，聽起來更輕盈/高級。
export function playLotteryTick() {
  const c = ctx();
  const now = c.currentTime;
  const f0 = 1400 + Math.random() * 300;
  for (const mul of [1, 2.4]) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain);
    gain.connect(masterGain());
    osc.type = "sine";
    osc.frequency.value = f0 * mul;
    gain.gain.setValueAtTime(mul === 1 ? 0.09 : 0.03, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.start(now);
    osc.stop(now + 0.055);
  }
}

// 「鐺——」：停格收尾，比拉霸機的「哐」更悠揚（長尾正弦+高頻泛音，鐘聲質感）。
export function playLotteryStop() {
  const c = ctx();
  const now = c.currentTime;
  for (const [mul, amp] of [[1, 0.24], [2, 0.1], [3, 0.05]] as [number, number][]) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain);
    gain.connect(masterGain());
    osc.type = "sine";
    osc.frequency.value = 660 * mul;
    gain.gain.setValueAtTime(amp, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
    osc.start(now);
    osc.stop(now + 0.95);
  }
}

// 稀有中獎收尾：普通獎項不用另外呼叫（停格音已經夠），P 系列/黑天鵝這種大獎額外
// 加一段上揚琶音強化爽感，rarity 影響音高range/顆數——黑天鵝用最高階、最多顆音符。
export function playLotteryWin(rarity: "rare" | "epic") {
  const c = ctx();
  const now = c.currentTime;
  const notes = rarity === "epic"
    ? [523, 659, 784, 1047, 1319] // C5-E5-G5-C6-E6，黑天鵝專屬更燦爛
    : [523, 659, 784, 1047];      // P 系列車款
  notes.forEach((freq, i) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain);
    gain.connect(masterGain());
    osc.type = "triangle";
    osc.frequency.value = freq;
    const t = now + i * 0.09;
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.26, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.start(t);
    osc.stop(t + 0.52);
  });
}

// ---- 引擎持續音 ----

let engOsc: OscillatorNode | null = null;
let engFilt: BiquadFilterNode | null = null;
let engGain: GainNode | null = null;

export function startEngine() {
  if (engOsc) return;
  const c = ctx();
  engOsc  = c.createOscillator();
  engFilt = c.createBiquadFilter();
  engGain = c.createGain();
  engOsc.type = "sawtooth";
  engOsc.frequency.value = 55;
  engFilt.type = "lowpass";
  engFilt.frequency.value = 220;
  engGain.gain.value = 0;
  engOsc.connect(engFilt);
  engFilt.connect(engGain);
  engGain.connect(masterGain());
  engOsc.start();
}

export function updateEngine(speed: number, grounded: boolean) {
  if (!engOsc || !engGain) return;
  const c = ctx();
  const targetFreq = grounded ? Math.min(190, 50 + speed * 10) : 38;
  const targetVol  = grounded ? Math.min(0.32, 0.08 + speed * 0.018) : 0.05;
  engOsc.frequency.setTargetAtTime(targetFreq, c.currentTime, 0.08);
  engGain.gain.setTargetAtTime(targetVol,   c.currentTime, 0.05);
}

export function stopEngine() {
  if (!engGain || !engOsc) return;
  const c = ctx();
  engGain.gain.setTargetAtTime(0, c.currentTime, 0.15);
  const osc = engOsc;
  engOsc = null; engFilt = null; engGain = null;
  osc.stop(c.currentTime + 1.0);
}

// ---- 背景音樂（BGM，2026-07-12 使用者提供素材，CC-BY／incompetech.com）----
// 兩軌切換：非遊玩畫面（首頁/車庫/選單/每日排名賽列表等）放 galactic-rap，
// 實際跑賽道（GameCanvas 掛載中）切 hiding-your-reality。走
// MediaElementAudioSourceNode 接進 masterGain()，跟音效共用同一顆音量滑桿；
// 不用 AudioBufferSourceNode 整首解碼進記憶體（檔案數 MB 起跳，串流播放對
// 行動裝置記憶體友善很多，且原生支援 .loop）。
//
// ⚠️ 行動瀏覽器/WebView 的 autoplay 政策：沒有使用者手勢前 .play() 會被拒絕
// （回傳的 Promise reject NotAllowedError）。冷啟動首頁那次很可能踩到——
// 失敗時靜默吞掉，掛一次性 pointerdown 監聽，使用者第一次點擊任何地方時重試。
let bgmMenu: HTMLAudioElement | null = null;
let bgmGame: HTMLAudioElement | null = null;
let currentBgm: HTMLAudioElement | null = null;
let bgmRetryQueued = false;

function ensureBgm(): void {
  if (bgmMenu && bgmGame) return;
  const c = ctx();
  const base = import.meta.env.BASE_URL;
  bgmMenu = new Audio(`${base}audio/galactic-rap.mp3`);
  bgmGame = new Audio(`${base}audio/hiding-your-reality.mp3`);
  bgmMenu.loop = true;
  bgmGame.loop = true;
  c.createMediaElementSource(bgmMenu).connect(masterGain());
  c.createMediaElementSource(bgmGame).connect(masterGain());
}

function tryPlay(el: HTMLAudioElement): void {
  el.play().catch(() => {
    if (bgmRetryQueued) return;
    bgmRetryQueued = true;
    const retry = () => {
      bgmRetryQueued = false;
      if (currentBgm === el) el.play().catch(() => { /* 仍失敗就放棄，不再重試轟炸 */ });
    };
    document.addEventListener("pointerdown", retry, { once: true });
  });
}

function switchBgm(target: HTMLAudioElement): void {
  ensureBgm();
  if (currentBgm === target) return;
  currentBgm?.pause();
  currentBgm = target;
  tryPlay(target);
}

// 進入非遊玩畫面（首頁/車庫/選單等）時呼叫。
export function playMenuMusic(): void {
  ensureBgm();
  switchBgm(bgmMenu!);
}

// 進入賽道（GameCanvas 掛載）時呼叫。
export function playGameMusic(): void {
  ensureBgm();
  switchBgm(bgmGame!);
}

// App 切到背景（分頁隱藏/切去其他 App）時呼叫：暫停目前播放的 BGM，
// 避免使用者切走後音樂仍在背景持續播放。
export function pauseBgm(): void {
  currentBgm?.pause();
}

// App 回到前景時呼叫：恢復剛才暫停的那軌（走既有 tryPlay 的 autoplay 重試邏輯）。
export function resumeBgm(): void {
  if (currentBgm) tryPlay(currentBgm);
}
