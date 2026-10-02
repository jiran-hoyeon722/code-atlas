export type Cue = 'step' | 'land' | 'swing' | 'shot' | 'shotgun' | 'hurt' | 'boom' | 'enter' | 'ding';

export const SOUND_KEY = 'code-atlas.walk.sound';

export interface Sound {
  /** Browsers only let audio start from a user gesture; call this from one. */
  unlock(): void;
  /** `level` 0–1 scales the cue, e.g. by distance. */
  play(cue: Cue, level?: number): void;
  readonly muted: boolean;
  setMuted(on: boolean): void;
  dispose(): void;
}

type Ctx = typeof AudioContext;

// Every cue is synthesized on the fly, so there are no sound files to ship or fetch.
export function createSound(stored: string | null, Audio: Ctx | undefined = globalThis.AudioContext): Sound {
  let muted = stored === 'off';
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;

  const tone = (type: OscillatorType, from: number, to: number, at: number, dur: number, peak: number) => {
    const o = ctx!.createOscillator();
    const g = ctx!.createGain();
    o.type = type;
    o.frequency.setValueAtTime(from, at);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, to), at + dur);
    g.gain.setValueAtTime(peak, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(master!);
    o.start(at);
    o.stop(at + dur + 0.02);
  };
  const hiss = (filter: BiquadFilterType, freq: number, at: number, dur: number, peak: number) => {
    const src = ctx!.createBufferSource();
    const f = ctx!.createBiquadFilter();
    const g = ctx!.createGain();
    src.buffer = noise;
    f.type = filter;
    f.frequency.value = freq;
    g.gain.setValueAtTime(peak, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(master!);
    src.start(at, Math.random() * 0.5);
    src.stop(at + dur + 0.02);
  };

  return {
    unlock() {
      if (!Audio) return;
      if (!ctx) {
        try {
          ctx = new Audio();
        } catch {
          return;
        }
        master = ctx.createGain();
        master.gain.value = 0.35;
        master.connect(ctx.destination);
        noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const data = noise.getChannelData(0);
        for (let k = 0; k < data.length; k++) data[k] = Math.random() * 2 - 1;
      }
      if (ctx.state === 'suspended') void ctx.resume();
    },
    play(cue, level = 1) {
      if (muted || !ctx || ctx.state !== 'running' || level <= 0.01) return;
      const t = ctx.currentTime;
      const l = Math.min(1, level);
      switch (cue) {
        case 'step': hiss('lowpass', 500 + Math.random() * 300, t, 0.07, 0.12 * l); break;
        case 'land': tone('sine', 110, 45, t, 0.18, 0.5 * l); hiss('lowpass', 400, t, 0.12, 0.2 * l); break;
        case 'swing': hiss('bandpass', 1400, t, 0.12, 0.18 * l); break;
        case 'shot': hiss('highpass', 900, t, 0.09, 0.4 * l); tone('square', 180, 60, t, 0.06, 0.12 * l); break;
        case 'shotgun': hiss('lowpass', 1800, t, 0.28, 0.7 * l); tone('sine', 120, 40, t, 0.2, 0.4 * l); break;
        case 'hurt': tone('sawtooth', 220, 90, t, 0.16, 0.15 * l); break;
        case 'boom': hiss('lowpass', 300, t, 0.9, 0.9 * l); tone('sine', 70, 28, t, 0.7, 0.7 * l); break;
        case 'enter': tone('sine', 660, 660, t, 0.18, 0.15 * l); tone('sine', 990, 990, t + 0.09, 0.22, 0.12 * l); break;
        case 'ding': tone('triangle', 880, 880, t, 0.25, 0.18 * l); tone('triangle', 1320, 1320, t + 0.1, 0.35, 0.15 * l); break;
      }
    },
    get muted() { return muted; },
    setMuted(on) { muted = on; },
    dispose() {
      void ctx?.close().catch(() => {});
      ctx = null;
    },
  };
}
