import {test, expect} from 'bun:test';
import {readMeter, checkMeter, parseRgbSums} from './meter-reading';
test('exact units, no repair or ambiguity', () => {
  expect(readMeter([{text: '5.25v', confidence: 1}, {text: '0.10A 00334 Wh', confidence: 1}]))
    .toEqual({currentMa: 100, voltage: 5.25});
  expect(readMeter([{text: '5.2 6v', confidence: 1}, {text: '0.0 8A 00334 Wh', confidence: 1}]))
    .toEqual({currentMa: 80, voltage: 5.26});
  for (const text of ['010A', 'O.10A', '0.10', '0.10mA', '0.10A 0.11A'])
    expect(() => readMeter([{text, confidence: 1}, {text: '5.25V', confidence: 1}])).toThrow();
  expect(() => readMeter([{text: '0.10A', confidence: 0.5}, {text: '5.25V', confidence: 1}])).toThrow();
});
test('electrical guards stop invalid, excessive or missing readings', () => {
  checkMeter({currentMa: 90, voltage: 5.23});
  for (const currentMa of [450, 900, -1, NaN]) expect(() => checkMeter({currentMa, voltage: 5})).toThrow();
  for (const voltage of [4.74, 5.51, NaN]) expect(() => checkMeter({currentMa: 90, voltage})).toThrow();
});
test('RGB diagnostic parser checks schema, freshness, mapped count and hard cap', () => {
  const packet = new Uint8Array(25); packet[0] = packet[1] = 1;
  const view = new DataView(packet.buffer); view.setUint16(2, 42, true); view.setUint16(6, 66 * 18, true);
  expect(parseRgbSums(packet).groups).toEqual([[1188, 0, 0], [0, 0, 0], [0, 0, 0]]);
  expect(parseRgbSums(packet).frame).toBe(42);
  view.setUint16(4, 500, true); expect(() => parseRgbSums(packet)).toThrow();
  view.setUint16(4, 0, true); view.setUint16(6, 1189, true); expect(() => parseRgbSums(packet)).toThrow();
  expect(() => parseRgbSums(new Uint8Array(24))).toThrow();
  packet[1] = 0; expect(() => parseRgbSums(packet)).toThrow();
});
