import {expect, test} from 'bun:test';
import frontend from '../src/utils/toffee_studio/lighting-map.json';
import firmware from '../../firmware/keyboards/toffee_studio/module/lighting/screenless-map.json';

test('frontend and firmware share the complete, disjoint screenless LED map', async () => {
  expect(frontend.version).toBe(firmware.version);
  expect(frontend.front).toEqual(firmware.front.map(({index, label}) => ({index, label})));
  expect(firmware.front.length).toBe(66);
  expect(firmware.badge.length).toBe(16);
  expect(firmware.rear.length).toBe(22);
  const indices = [...firmware.front, ...firmware.badge, ...firmware.rear].map(led => led.index);
  expect(indices.sort((a, b) => a - b)).toEqual(Array.from({length: 104}, (_, i) => i));
  const header = await Bun.file('../firmware/keyboards/toffee_studio/module/lighting/screenless-map.h').text();
  const sections = header.split('= {').slice(1).map(s => s.split('};')[0]);
  const triples = (s: string) => Array.from(s.matchAll(/\{(\d+), (\d+), (\d+)\}/g), m => m.slice(1).map(Number));
  expect(triples(sections[0])).toEqual(firmware.front.map(({index, x, y}) => [index, x, y]));
  expect(sections[1].match(/\d+/g)!.map(Number)).toEqual(firmware.badge.map(led => led.index));
  const matrix = firmware.front.flatMap(key => key.matrix.map(([row, col]) => [row, col, key.index]));
  expect(triples(sections[2])).toEqual(matrix);
  expect(new Set(matrix.map(([r, c]) => `${r},${c}`)).size).toBe(68);
  for (const [row, col] of matrix) {
    expect(row).toBeGreaterThanOrEqual(0); expect(row).toBeLessThan(9);
    expect(col).toBeGreaterThanOrEqual(0); expect(col).toBeLessThan(8);
  }
});
