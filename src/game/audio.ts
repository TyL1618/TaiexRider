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

// 「咖」：短促高頻方波 click，模擬機械棘輪滾過一格。
// 頻率帶一點隨機讓連續 tick 不死板；音量低（連發時不吵）。
export function playSlotTick() {
  const c = ctx();
  const now = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.connect(gain);
  gain.connect(masterGain());
  osc.type = "square";
  osc.frequency.value = 1500 + Math.random() * 500;
  gain.gain.setValueAtTime(0.07, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
  osc.start(now);
  osc.stop(now + 0.035);
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
