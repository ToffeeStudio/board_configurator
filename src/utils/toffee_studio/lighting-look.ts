// How a lighting zone looks on screen: its colour and a hint of its motion. Display only.
import chroma from 'chroma-js';
import type {LightingZone} from 'src/store/toffeeLightingSlice';
import type {LightingState} from './hid';
import {BADGE_EFFECTS, FRONT_EFFECTS, REAR_EFFECTS} from './lighting-effects';

// The board's hue and saturation (0–255 each) at full value.
export const zoneHex = (hue: number, saturation: number) =>
  chroma.hsv((hue / 255) * 360, saturation / 255, 1).hex();

// Effects are suggested, not simulated per LED.
export type EffectMotion = 'none' | 'breathe' | 'cycle' | 'flicker';
export function effectMotion(label: string): EffectMotion {
  if (/Rainbow|Cycle|Hue|Vortex|Pinwheels/.test(label)) return 'cycle';
  if (/Breath|Pulse/.test(label)) return 'breathe';
  if (/Comet|Chase|Splash|Heatmap|Rain|Reactive|Pixel|Beacon/.test(label)) return 'flicker';
  return 'none';
}

export type ZoneLook = {colour: string; level: number; motion: EffectMotion};
const EFFECTS = {rear: REAR_EFFECTS, front: FRONT_EFFECTS, badge: BADGE_EFFECTS};
// Before a board's lighting is known: a quiet Toffee violet from below, nothing else.
const UNKNOWN: Record<LightingZone, ZoneLook> = {
  rear: {colour: '#7b2dff', level: 0.6, motion: 'none'},
  front: {colour: '#b48cff', level: 0, motion: 'none'},
  badge: {colour: '#c8a8ff', level: 0, motion: 'none'},
};
export function zoneLook(zone: LightingZone, state: LightingState | undefined): ZoneLook {
  if (!state) return UNKNOWN[zone];
  // Front and badge effect 0 is Off; the underglow has no Off effect.
  const off = zone !== 'rear' && state.effect === 0;
  return {
    colour: zoneHex(state.hue, state.saturation),
    level: off ? 0 : state.brightness / 255,
    motion: effectMotion(EFFECTS[zone][state.effect].label),
  };
}
