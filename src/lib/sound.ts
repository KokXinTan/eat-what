// Tiny synthesized sounds (no audio files). Only played when the user turns sound on.

let ctx: AudioContext | null = null;

function tone(freq: number, start: number, duration: number, gain = 0.08, type: OscillatorType = 'sine') {
  ctx ??= new AudioContext();
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  const t = ctx.currentTime + start;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(gain, t + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(amp).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

export const sounds = {
  /** Soft pop for a reveal. */
  reveal() {
    tone(520, 0, 0.12, 0.07, 'triangle');
    tone(780, 0.06, 0.16, 0.05, 'sine');
  },
  /** Quick swish-down for "not today". */
  skip() {
    tone(330, 0, 0.1, 0.05, 'triangle');
  },
  /** Little three-note chime for "I'm having this". */
  celebrate() {
    [523, 659, 784].forEach((f, i) => tone(f, i * 0.09, 0.3, 0.07, 'sine'));
  },
};

export function play(enabled: boolean, name: keyof typeof sounds) {
  if (!enabled) return;
  try {
    sounds[name]();
  } catch {
    // Audio is a nice-to-have; ignore browsers that block it.
  }
}
