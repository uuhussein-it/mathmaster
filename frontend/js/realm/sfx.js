/**
 * Tiny retro sound effects for the games, made with the Web Audio API (no
 * sound files). Muting is remembered on this device.
 *   sfx('coin') · sfx('jump') · …   setMuted(true) · isMuted()
 */
import { prefs } from '../ui.js';

let ctx = null;
let muted = prefs.get('sfxMuted', false);

export const isMuted = () => muted;
export function setMuted(on) {
  muted = on;
  prefs.set('sfxMuted', on);
}

function audio() {
  if (muted) return null;
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch { return null; }
}

/** One note: square/triangle wave sliding from f0 to f1 over `dur` seconds. */
function tone(a, { f0, f1 = f0, dur = 0.1, type = 'square', vol = 0.06, at = 0 }) {
  const t = a.currentTime + at;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(a, { dur = 0.2, vol = 0.08, at = 0 }) {
  const n = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, n, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i += 1) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = a.createBufferSource();
  const g = a.createGain();
  g.gain.value = vol;
  s.buffer = buf;
  s.connect(g).connect(a.destination);
  s.start(a.currentTime + at);
}

const SOUNDS = {
  jump: (a) => tone(a, { f0: 320, f1: 640, dur: 0.12, vol: 0.04 }),
  coin: (a) => { tone(a, { f0: 988, dur: 0.06, vol: 0.04 }); tone(a, { f0: 1319, dur: 0.12, vol: 0.04, at: 0.06 }); },
  hurt: (a) => { tone(a, { f0: 220, f1: 90, dur: 0.25, type: 'sawtooth', vol: 0.05 }); noise(a, { dur: 0.12, vol: 0.04 }); },
  stomp: (a) => { tone(a, { f0: 180, f1: 60, dur: 0.12, vol: 0.06 }); tone(a, { f0: 660, f1: 990, dur: 0.1, vol: 0.03, at: 0.08 }); },
  right: (a) => [523, 659, 784, 1047].forEach((f, i) => tone(a, { f0: f, dur: 0.12, vol: 0.045, type: 'triangle', at: i * 0.07 })),
  wrong: (a) => { tone(a, { f0: 300, f1: 200, dur: 0.18, vol: 0.05 }); tone(a, { f0: 200, f1: 120, dur: 0.25, vol: 0.05, at: 0.16 }); },
  open: (a) => [392, 523, 659].forEach((f, i) => tone(a, { f0: f, dur: 0.1, vol: 0.04, type: 'triangle', at: i * 0.05 })),
  bridge: (a) => [0, 1, 2, 3, 4].forEach((i) => tone(a, { f0: 200 + i * 60, dur: 0.05, vol: 0.04, at: i * 0.07 })),
  checkpoint: (a) => { tone(a, { f0: 660, dur: 0.08, vol: 0.04, type: 'triangle' }); tone(a, { f0: 880, dur: 0.16, vol: 0.04, type: 'triangle', at: 0.08 }); },
  blast: (a) => { tone(a, { f0: 900, f1: 120, dur: 0.35, type: 'sawtooth', vol: 0.05 }); noise(a, { dur: 0.3, vol: 0.06, at: 0.25 }); },
  boom: (a) => { noise(a, { dur: 0.6, vol: 0.12 }); tone(a, { f0: 90, f1: 40, dur: 0.6, vol: 0.08 }); },
  win: (a) => [523, 659, 784, 659, 784, 1047].forEach((f, i) => tone(a, { f0: f, dur: 0.16, vol: 0.045, type: 'triangle', at: i * 0.12 })),
  lose: (a) => [392, 330, 262, 196].forEach((f, i) => tone(a, { f0: f, dur: 0.2, vol: 0.05, type: 'triangle', at: i * 0.16 })),
  tap: (a) => tone(a, { f0: 700, f1: 900, dur: 0.04, vol: 0.025 }),
  carpet: (a) => tone(a, { f0: 300, f1: 900, dur: 0.4, type: 'triangle', vol: 0.04 }),
  orb: (a) => tone(a, { f0: 500, f1: 250, dur: 0.15, type: 'triangle', vol: 0.025 }),
  step: (a) => noise(a, { dur: 0.03, vol: 0.015 }),
};

export function sfx(name) {
  const a = audio();
  if (a && SOUNDS[name]) { try { SOUNDS[name](a); } catch { /* ignore */ } }
}
