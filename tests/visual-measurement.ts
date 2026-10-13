// Numerical/protocol helpers only. Meter values must be read by viewing the image.
import map from '../src/utils/toffee_studio/lighting-map.json';
const front = new Set(map.front.map(key => key.index));
export function requestedSums(indices: number[], rgb: number[]) {
  const sums = [[0,0,0],[0,0,0],[0,0,0]];
  for (const index of indices) {
    const group = front.has(index) ? 0 : index >= 65 && index <= 80 ? 2 : 1;
    for (let color = 0; color < 3; color++) sums[group][color] += rgb[color];
  }
  return sums;
}

export function checkOutput(requested: number[][], actual: number[][], limited: boolean) {
  for (let group = 0; group < 3; group++) for (let color = 0; color < 3; color++) {
    if (actual[group][color] > requested[group][color] ||
        (!limited && actual[group][color] !== requested[group][color]))
      throw new Error('Actual output differs from requested RGB/group mapping.');
  }
}

export function rawPattern(indices: number[], rgb: number[]) {
  if (rgb.length !== 3 || rgb.some(v => !Number.isInteger(v) || v < 0 || v > 255) ||
      !indices.length || new Set(indices).size !== indices.length ||
      indices.some(i => !Number.isInteger(i) || i < 0 || i >= 104) ||
      (indices.length > 50 && rgb.some(v => v > 150)))
    throw new Error('Require unique mapped indices and RGB: <=50 LEDs at 255, otherwise <=150.');
  const payload = new Uint8Array(16); payload.set(rgb);
  for (const index of indices) payload[3 + (index >> 3)] |= 1 << (index & 7);
  return payload;
}

export function visualReading(currentMa: number, voltage: number) {
  if (!Number.isFinite(currentMa) || currentMa < 0 || currentMa >= 1000 ||
      !Number.isFinite(voltage) || voltage < 4.75 || voltage > 5.5)
    throw new Error('Stop: manually viewed meter reading outside 0–999 mA / 4.75–5.50 V.');
}

export function calibrationStatus(data: Uint8Array, expectedBuild: number) {
  if (data.length !== 25 || data[0] !== 1 || data[1] !== 255)
    throw new Error('Require temporary 255-channel calibration firmware.');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const build = view.getUint32(8, true);
  if (build !== expectedBuild) throw new Error('Unexpected calibration firmware build.');
  return {build, active: Boolean(data[2]), expired: Boolean(data[3]),
    uptime: view.getUint32(4, true), pattern: data[12], groups: data[19]};
}

export function finalSums(data: Uint8Array) {
  if (data.length !== 25 || data[0] !== 1 || data[1] !== 1 || data[24] !== 0)
    throw new Error('Missing final-output telemetry.');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint16(4, true) >= 500) throw new Error('Stale final-output telemetry.');
  const groups = [66, 22, 16].map((count, group) => Array.from({length: 3}, (_, color) => {
    const sum = view.getUint16(6 + (group * 3 + color) * 2, true);
    if (sum > count * 255) throw new Error('Final-output sum exceeds mapped group.');
    return sum;
  }));
  return {frame: view.getUint16(2, true), groups};
}

// Same linear relationship as firmware; coefficients are mA per full RGB channel.
// No brightness-slider percentage or camera intensity enters this calculation.
export function estimateCurrent(baseMa: number, coefficients: number[][], sums: number[][]) {
  let current = baseMa;
  for (let group = 0; group < 3; group++)
    for (let color = 0; color < 3; color++) current += sums[group][color] / 255 * coefficients[group][color];
  return current;
}
