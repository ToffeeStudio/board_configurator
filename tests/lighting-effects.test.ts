import {expect, test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {FRONT_EFFECTS, BADGE_EFFECTS} from '../src/utils/toffee_studio/lighting-effects';
const firmware = '../firmware/keyboards/toffee_studio/module/';
test('front IDs preserve old preferences and expose every configured native QMK effect', () => {
  const source = readFileSync(firmware + 'lighting/groups.c', 'utf8');
  const modes = source.match(/front_effects\[MODULE_FRONT_EFFECT_COUNT\] = \{([\s\S]*?)\};/)![1]
    .match(/RGB_MATRIX_[A-Z_]+/g)!;
  expect(modes.length).toBe(FRONT_EFFECTS.length);
  expect(new Set(modes).size).toBe(44); // Off shares SOLID_COLOR with Solid.
  expect(FRONT_EFFECTS.slice(0, 9).map(v => v.label)).toEqual([
    'Off', 'Solid', 'Breathing', 'Cycle All', 'Cycle Left–Right', 'Cycle Up–Down',
    'Gradient Left–Right', 'Gradient Up–Down', 'Rainbow Beacon']);
  const enabled = [...readFileSync(firmware + 'config.h', 'utf8').matchAll(/#define ENABLE_RGB_MATRIX_([A-Z_]+)/g)]
    .map(m => 'RGB_MATRIX_' + m[1]);
  expect(enabled.every(name => modes.includes(name))).toBe(true);
  expect(modes[33]).toBe('RGB_MATRIX_SOLID_REACTIVE_SIMPLE');
  expect(modes[31]).toBe('RGB_MATRIX_TYPING_HEATMAP');
  expect(BADGE_EFFECTS.map(v => v.label)).toEqual(['Off', 'Solid', 'Breathing', 'Rainbow Cycle', 'Chase', 'Typing Pulse']);
});
