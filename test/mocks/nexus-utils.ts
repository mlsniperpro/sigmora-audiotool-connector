/** Mock of `@audiotool/nexus/utils` — just the tick helpers nexus.ts imports. */

const TICKS_PER_BEAT = 3840;
const TICKS_PER_BAR = TICKS_PER_BEAT * 4; // 4/4

export const Ticks = {
  Beat: TICKS_PER_BEAT,
  Bars: (n: number) => n * TICKS_PER_BAR,
} as const;

export const secondsToTicks = (seconds: number, bpm: number): number =>
  Math.floor(seconds * (bpm / 60) * TICKS_PER_BEAT);

export const ticksToSeconds = (ticks: number, bpm: number): number =>
  ticks / TICKS_PER_BEAT / (bpm / 60);
