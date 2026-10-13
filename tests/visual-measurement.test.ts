import {test, expect} from 'bun:test';
import {rawPattern, visualReading, calibrationStatus, finalSums, estimateCurrent, requestedSums, checkOutput} from './visual-measurement';
test('output verification rejects colour swaps, missing LEDs and incorrect groups', () => {
  const requested = requestedSums([91,103,1,65], [255,128,32]);
  expect(requested).toEqual([[510,256,64],[255,128,32],[255,128,32]]);
  checkOutput(requested, requested, false);
  expect(() => checkOutput([[255,0,0],[0,0,0],[0,0,0]], [[0,255,0],[0,0,0],[0,0,0]], false)).toThrow();
  expect(() => checkOutput(requested, [[0,0,0],[0,0,0],[0,0,0]], false)).toThrow();
  checkOutput(requested, requested.map(row=>row.map(v=>Math.floor(v/2))), true);
});
test('literal masks cover all 104 LEDs and enforce requested experiment endpoints', () => {
  for (let index = 0; index < 104; index++) {
    const p = rawPattern([index], [255,128,64]);
    expect(p[3 + (index >> 3)]).toBe(1 << (index & 7));
    expect([...p.slice(0, 3)]).toEqual([255,128,64]);
  }
  const all = Array.from({length:104}, (_,i) => i);
  expect([...rawPattern(all, [150,150,150]).slice(3)]).toEqual(Array(13).fill(255));
  rawPattern(all.slice(0,50), [255,255,255]);
  for (const indices of [[], [104], [-1], [1,1], [1.5], all.slice(0,51)])
    expect(() => rawPattern(indices, [255,255,255])).toThrow();
  for (const rgb of [[1], [256,0,0], [-1,0,0], [NaN,0,0]]) expect(() => rawPattern([0], rgb)).toThrow();
});
test('visual readings stop excessive, missing and invalid values', () => {
  visualReading(90, 5.24);
  visualReading(450, 5.24);
  visualReading(799, 5.24);
  visualReading(800, 5.24);
  visualReading(849, 5.24);
  visualReading(850, 5.24);
  visualReading(900, 5.24);
  visualReading(999, 5.24);
  for (const [currentMa, voltage] of [[1000,5], [1001,5], [NaN,5], [-1,5], [90,4.74], [90,5.51], [90,NaN]])
    expect(() => visualReading(currentMa, voltage)).toThrow();
});
test('require exact new build, channel cap, fresh final RGB and mapped sums', () => {
  const p = new Uint8Array(25), v = new DataView(p.buffer);
  p[0] = 1; p[1] = 255; v.setUint32(8, 0x26100403, true);
  expect(calibrationStatus(p, 0x26100403).build).toBe(0x26100403);
  expect(() => calibrationStatus(p, 0x26100402)).toThrow();
  p[1] = 18; expect(() => calibrationStatus(p, 0x26100403)).toThrow();
  p.fill(0); p[0] = p[1] = 1; v.setUint16(6,66*255,true);
  expect(finalSums(p).groups[0][0]).toBe(66*255);
  v.setUint16(6,66*255+1,true); expect(() => finalSums(p)).toThrow();
  v.setUint16(6,0,true); v.setUint16(4,500,true); expect(() => finalSums(p)).toThrow();
});
test('simple current model uses colour-dependent actual output and LED count', () => {
  const coefficients = [[10,12,15], [8,9,10], [7,8,9]];
  expect(estimateCurrent(90, coefficients, [[255,0,0],[0,0,0],[0,0,0]])).toBe(100);
  expect(estimateCurrent(90, coefficients, [[765,765,765],[0,0,0],[0,0,0]])).toBe(201);
  expect(estimateCurrent(90, coefficients, [[0,0,0],[0,510,0],[0,0,255]])).toBe(117);
});
