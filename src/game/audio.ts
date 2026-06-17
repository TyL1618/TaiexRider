// Web Audio API 程式生成音效 — 不需外部音檔，純振盪器 + 噪音合成

let _ctx: AudioContext | null = null;

function ctx(): AudioContext {
  if (!_ctx) _ctx = new AudioContext();
  if (_ctx.state === "suspended") void _ctx.resume();
  return _ctx;
}

// ---- 一次性音效 ----

export function playFlip() {
  const c = ctx();
  const now = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.connect(gain);
  gain.connect(c.destination);
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
    gain.connect(c.destination);
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
  gain.connect(c.destination);
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
    gain.connect(c.destination);
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
  engGain.connect(c.destination);
  engOsc.start();
}

export function updateEngine(speed: number, grounded: boolean) {
  if (!engOsc || !engGain) return;
  const c = ctx();
  const targetFreq = grounded ? Math.min(190, 50 + speed * 10) : 38;
  const targetVol  = grounded ? Math.min(0.11, 0.03 + speed * 0.005) : 0.015;
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
