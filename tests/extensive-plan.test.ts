import {expect, test} from 'bun:test';
import map from '../src/utils/toffee_studio/lighting-map.json';
import {badgeIndices, rearIndices, rgbCases, parseTestStatus} from './extensive-plan';

test('L1 covers all 104 packages in R/G/B through 108 low-drive paired cases', () => {
  const cases = rgbCases([...map.front.map(key => key.index), ...badgeIndices].sort((a, b) => a - b), rearIndices);
  expect(cases.length).toBe(108);
  expect(cases.flatMap(c => c.expected).length).toBe(312);
  for (let index = 0; index < 104; index++) {
    const expected = cases.flatMap(c => c.expected).filter(e => e.index === index);
    expect(expected.map(e => e.color).sort()).toEqual(['blue', 'green', 'red']);
    expect(expected.every(e => e.known_fault === (index === 103))).toBe(true);
  }
  for (const c of cases) {
    const used = c.leds.filter(index => index !== 255);
    expect(new Set(used).size).toBe(used.length);
    expect(c.leds.length).toBe(5);
    expect(c.leds.slice(3)).toEqual([255, 255]);
    expect(c.expected.every(e => Math.max(...e.rgb) === 18)).toBe(true);
  }
});
test('invalid or incomplete map fails before any stimulus', () => {
  expect(() => rgbCases([], rearIndices)).toThrow();
  const front = [...map.front.map(key => key.index), ...badgeIndices];
  front[0] = 65;
  expect(() => rgbCases(front, rearIndices)).toThrow();
});
test('test status requires explicit version, cap, length and build identity', () => {
  const data = new Uint8Array(25); const view = new DataView(data.buffer);
  data.set([1, 18, 1, 0]); view.setUint32(4, 12345, true);
  view.setUint32(8, 0x26100201, true); view.setUint32(20, 4999, true);
  expect(parseTestStatus(data, 0x26100201)).toMatchObject({build: 0x26100201, cap: 18,
    uptime: 12345, active: true, expired: false, keepalive_age_ms: 4999});
  expect(() => parseTestStatus(data, 0x26100202)).toThrow();
  data[1] = 19; expect(() => parseTestStatus(data, 0x26100201)).toThrow();
  expect(() => parseTestStatus(data.slice(0, 24), 0x26100201)).toThrow();
});
