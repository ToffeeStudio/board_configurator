import assert from 'node:assert/strict';

export const rearIndices = [1, 3, 5, 8, 9, 11, 12, 14, 16, 32, 33, 48, 49, 81, 82, 84, 85, 86, 87, 88, 89, 90];
export const badgeIndices = Array.from({length: 16}, (_, i) => i + 65);
export type RGBCase = {id: 'L1'; name: string; face: 'front' | 'back'; leds: number[];
  expected: {index: number; color: string; rgb: number[]; known_fault: boolean}[]};

export function rgbCases(front: number[], rear: number[]): RGBCase[] {
  assert.equal(front.length, 82); assert.equal(rear.length, 22);
  assert.deepEqual([...front, ...rear].sort((a, b) => a - b), Array.from({length: 104}, (_, i) => i));
  const cases: RGBCase[] = [];
  const colors = [{slot: 0, name: 'red', rgb: [18, 0, 0]},
    {slot: 2, name: 'green', rgb: [0, 18, 0]}, {slot: 1, name: 'blue', rgb: [0, 0, 18]}];
  for (const [face, indices] of [['front', front], ['back', rear]] as const) {
    for (let offset = 0; offset < indices.length; offset += 3) {
      const batch = indices.slice(offset, offset + 3);
      for (let rotation = 0; rotation < 3; rotation++) {
        const leds = [255, 255, 255, 255, 255];
        const expected = batch.map((index, position) => {
          const color = colors[(position + rotation) % 3]; leds[color.slot] = index;
          return {index, color: color.name, rgb: color.rgb, known_fault: index === 103};
        });
        cases.push({id: 'L1', name: `${face}-${String(offset / 3).padStart(2, '0')}-${rotation}`,
          face, leds, expected});
      }
    }
  }
  return cases;
}

export function parseTestStatus(data: Uint8Array, expectedBuild: number) {
  assert.equal(data.length, 25);
  assert.equal(data[0], 1, 'Temporary test protocol required.');
  assert.equal(data[1], 18, 'Require firmware-enforced 18/255 channel cap.');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const build = view.getUint32(8, true);
  assert.equal(build, expectedBuild, 'Unexpected temporary firmware build ID.');
  return {build, cap: data[1], active: Boolean(data[2]), expired: Boolean(data[3]),
    uptime: view.getUint32(4, true), pattern: data[12], front_effect: data[13],
    front_brightness: data[14], rear_effect: data[15], rear_brightness: data[16],
    badge_enabled: Boolean(data[17]), badge_brightness: data[18], groups: data[19],
    keepalive_age_ms: view.getUint32(20, true)};
}
