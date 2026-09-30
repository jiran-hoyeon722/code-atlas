export interface Theme {
  id: string;
  label: string;
  horizon: string;
  zenith: string;
  glow: string;
  sun: { color: string; intensity: number; dir: [number, number, number] };
  disc: { color: string; size: number; boost: number } | null;
  stars: boolean;
  fog: [number, number];
  hemi: { sky: string; ground: string; intensity: number };
  exposure: number;
  bloom: number;
  /** 0 = night shading, 1 = sunlit walls and sky-reflecting glass. */
  day: number;
  /** Share of windows with the light on. */
  lit: number;
  lamps: boolean;
  rain: boolean;
  ground: string;
  lot: number;
}

export const THEMES: Theme[] = [
  {
    id: 'night', label: '맑은 밤',
    horizon: '#1a1d36', zenith: '#030409', glow: '#3b2f5c',
    sun: { color: '#b9c6ff', intensity: 0.9, dir: [0.45, 0.55, -0.7] }, disc: { color: '#fff4dc', size: 28, boost: 1.6 }, stars: true,
    fog: [80, 430], hemi: { sky: '#7f93d8', ground: '#1c1d26', intensity: 0.75 },
    exposure: 1.05, bloom: 0.55, day: 0, lit: 0.5, lamps: true, rain: false, ground: '#1a1c24', lot: 1,
  },
  {
    id: 'rain', label: '비 오는 밤',
    horizon: '#15182a', zenith: '#05060b', glow: '#22263a',
    sun: { color: '#9aa7d6', intensity: 0.35, dir: [0.45, 0.55, -0.7] }, disc: null, stars: false,
    fog: [45, 320], hemi: { sky: '#6f7fb8', ground: '#181a22', intensity: 0.7 },
    exposure: 1.05, bloom: 0.6, day: 0, lit: 0.58, lamps: true, rain: true, ground: '#15171d', lot: 0.9,
  },
  {
    id: 'day', label: '맑은 낮',
    horizon: '#cfe3f7', zenith: '#4f8fd8', glow: '#ffffff',
    sun: { color: '#fff1d6', intensity: 2.6, dir: [0.35, 0.85, 0.4] }, disc: { color: '#fffbe8', size: 34, boost: 3 }, stars: false,
    fog: [140, 700], hemi: { sky: '#d9e8ff', ground: '#6e6452', intensity: 1.5 },
    exposure: 0.95, bloom: 0.15, day: 1, lit: 0.07, lamps: false, rain: false, ground: '#3b3e46', lot: 2.4,
  },
  {
    id: 'sunset', label: '노을',
    horizon: '#ff9b66', zenith: '#2e2b63', glow: '#ff5e3a',
    sun: { color: '#ffb27a', intensity: 1.8, dir: [-0.8, 0.18, -0.55] }, disc: { color: '#ffd2a0', size: 40, boost: 2.5 }, stars: false,
    fog: [100, 520], hemi: { sky: '#ffc6a0', ground: '#3a2a36', intensity: 1.0 },
    exposure: 1.0, bloom: 0.4, day: 0.6, lit: 0.3, lamps: true, rain: false, ground: '#2a2630', lot: 1.6,
  },
  {
    id: 'fog', label: '안개 낀 새벽',
    horizon: '#9aa6ba', zenith: '#56627c', glow: '#c9cfdc',
    sun: { color: '#dfe6f5', intensity: 0.9, dir: [0.6, 0.25, 0.5] }, disc: { color: '#f4f1ea', size: 30, boost: 1.3 }, stars: false,
    fog: [16, 170], hemi: { sky: '#b9c4d8', ground: '#3c4150', intensity: 1.1 },
    exposure: 1.0, bloom: 0.3, day: 0.45, lit: 0.25, lamps: true, rain: false, ground: '#2c3038', lot: 1.7,
  },
];
