import {DEBUG_ENABLED} from '../../config/debug';
import {CommandID, PowerStatus, ToffeeHIDDevice, ToffeeLightingAPI} from './hid';
import map from './lighting-map.json';

export const MANUAL_BUILD = 0x26101002;
export const MIXED_BUILDS = [0x26101001, MANUAL_BUILD];
const SINGLE_COLOUR_BUILD = 0x26100601;
export const READINGS_KEY = 'toffee.manual-current-readings.v1';
export const GROUPS = ['front', 'rear', 'badge', 'all'] as const;
export type Group = typeof GROUPS[number];
export const COLOURS = {
  White: [255, 255, 255], Red: [255, 0, 0], Green: [0, 255, 0], Blue: [0, 0, 255],
  Yellow: [255, 255, 0], Orange: [255, 128, 0], Cyan: [0, 255, 255], Magenta: [255, 0, 255],
};
export type Colour = keyof typeof COLOURS;
const front = map.front.map(key => key.index).sort((a, b) => a - b);
const badge = Array.from({length: 16}, (_, i) => 65 + i);
const rear = Array.from({length: 104}, (_, i) => i).filter(i => !front.includes(i) && !badge.includes(i));
export const INDICES: Record<Group, number[]> = {front, rear, badge, all: Array.from({length: 104}, (_, i) => i)};
export type SinglePreset = {group: Group; colour: Colour; count: number; level: number; indices: number[]; rgb: number[]; key: string};
export type MixedPreset = {key: string; groups: [SinglePreset, SinglePreset, SinglePreset]};
export type Preset = SinglePreset | MixedPreset;
export type Output = {frame: number; ageMs: number; groups: number[][]};
export type Sample = {build: number; uptime: number; power: PowerStatus; output: Output};
export type Reading = {id: string; pcb: string; at: string; appliedAt: string; amps: number;
  voltage: number | null; notes: string; preset: Preset; sample: Sample};

export function preset(group: Group, colour: Colour, count: number, level: number): SinglePreset {
  if (!GROUPS.includes(group) || !Object.hasOwn(COLOURS, colour) ||
      !Number.isInteger(count) || count < 1 || count > INDICES[group].length ||
      !Number.isInteger(level) || level < 0 || level > 255)
    throw new Error('Choose a group, colour, valid LED count and brightness from 0 to 255.');
  return {group, colour, count, level, indices: INDICES[group].slice(0, count),
    rgb: COLOURS[colour].map(channel => Math.round(channel * level / 255)),
    key: `v1:${group}:${colour}:${count}:${level}`};
}
// Fixed checklist v1. The earlier rough 80mA baseline + 12/15/13mA per
// full RGB channel informed these endpoints (~0.95A max, or 255 when lower).
// These are explicit test requests, NOT current admission checks or a limiter.
// Actual current can differ: watch the physical meter and skip higher rows.
const FULL = [26, 51, 89, 128, 179, 255];
const FIXED_LEVELS: Record<Group, Record<'Red' | 'Green' | 'Blue' | 'White' | 'Orange', number[]>> = {
  front: {Red: FULL, Green: FULL, Blue: FULL, White: [9,18,32,45,63,90], Orange: [18,36,63,90,126,180]},
  rear: {Red: FULL, Green: FULL, Blue: FULL, White: [22,44,77,110,154,220], Orange: FULL},
  badge: {Red: FULL, Green: FULL, Blue: FULL, White: FULL, Orange: FULL},
  all: {Red: [16,32,56,80,112,160], Green: [16,32,56,80,112,160], Blue: [16,32,56,80,112,160],
    White: [6,11,19,28,39,55], Orange: [11,22,39,55,77,110]},
};
export const CHECKLIST = GROUPS.flatMap(group =>
  (['Red','Green','Blue','White','Orange'] as const).flatMap(colour =>
    FIXED_LEVELS[group][colour].map(level => preset(group, colour, INDICES[group].length, level))));
export const BASELINE = preset('all', 'White', 104, 0);
// Fixed once, not randomised on reload. Front/rear/badge respectively; roughly
// increasing combined demand chosen with the historical model, NOT a limiter.
const MIXED_LEVELS: [Colour, number][][] = [
  [['White', 6], ['Magenta', 13], ['Red', 14]],
  [['Blue', 12], ['Yellow', 25], ['Magenta', 17]],
  [['Yellow', 13], ['Green', 14], ['Magenta', 36]],
  [['Green', 40], ['Orange', 19], ['Blue', 35]],
  [['Green', 16], ['Cyan', 44], ['Orange', 46]],
  [['Orange', 44], ['Blue', 11], ['Yellow', 20]],
  [['Magenta', 29], ['Orange', 39], ['Blue', 31]],
  [['Green', 28], ['Magenta', 52], ['Yellow', 54]],
  [['Orange', 45], ['White', 31], ['Blue', 12]],
  [['Orange', 44], ['Red', 36], ['Magenta', 73]],
  [['Red', 72], ['Orange', 58], ['Yellow', 40]],
  [['Orange', 64], ['Blue', 52], ['Cyan', 38]],
  [['Green', 31], ['White', 64], ['Magenta', 71]],
  [['Green', 28], ['Magenta', 80], ['White', 81]],
  [['Red', 95], ['Magenta', 62], ['Green', 78]],
  [['Green', 81], ['White', 56], ['Red', 100]],
  [['Blue', 86], ['White', 75], ['Yellow', 14]],
  [['Orange', 50], ['Magenta', 83], ['Cyan', 98]],
  [['Magenta', 84], ['Green', 46], ['Yellow', 38]],
  [['Red', 75], ['Yellow', 138], ['Orange', 64]],
  [['Orange', 79], ['Green', 88], ['White', 89]],
  [['Cyan', 38], ['Blue', 144], ['Magenta', 187]],
  [['Yellow', 89], ['Red', 53], ['Magenta', 85]],
  [['Blue', 138], ['Orange', 146], ['Magenta', 48]],
  [['White', 67], ['Green', 60], ['Magenta', 72]],
  // Rows146–150: profile6 +110mA baseline predicts903/925/941/960/979mA.
  // Static requests only. Actual meter current can exceed the estimate.
  [['Cyan', 73], ['Orange', 103], ['Magenta', 127]],
  [['White', 66], ['Blue', 93], ['Orange', 115]],
  [['Green', 95], ['Magenta', 135], ['Yellow', 166]],
  [['Orange', 74], ['Cyan', 105], ['White', 130]],
  [['Blue', 99], ['Yellow', 141], ['Magenta', 174]],
];
export const MIXED_CHECKLIST: MixedPreset[] = MIXED_LEVELS.map((row, i) => ({
  key: `mixed-v1:${i + 1}`,
  groups: row.map(([colour, level], group) =>
    preset(GROUPS[group], colour, INDICES[GROUPS[group]].length, level)) as MixedPreset['groups'],
}));
export const ALL_CHECKLIST: Preset[] = [...CHECKLIST, ...MIXED_CHECKLIST];
export function sumsFor(value: Preset): number[][] {
  if ('groups' in value) return value.groups.map(group => group.rgb.map(channel => channel * group.count));
  const sums = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const index of value.indices) {
    const group = front.includes(index) ? 0 : badge.includes(index) ? 2 : 1;
    value.rgb.forEach((channel, colour) => {sums[group][colour] += channel;});
  }
  return sums;
}
export function rawPayload(value: SinglePreset): Uint8Array {
  const bytes = new Uint8Array(16);
  bytes.set(value.rgb);
  for (const index of value.indices) bytes[3 + (index >> 3)] |= 1 << (index & 7);
  return bytes;
}
export function mixedPayload(value: MixedPreset): Uint8Array {
  return new Uint8Array(value.groups.flatMap(group => group.rgb));
}
export async function debugCommand(hid: ToffeeHIDDevice, code: number, payload = new Uint8Array()): Promise<Uint8Array> {
  if (!DEBUG_ENABLED) throw new Error('Debug mode is disabled.');
  const [status, data] = await hid.executeCommand(code as CommandID, payload);
  if (status !== 0) throw new Error(`Debug command 0x${code.toString(16)} rejected (0x${status.toString(16)}).`);
  return data;
}
export async function manualStatus(hid: ToffeeHIDDevice, api: ToffeeLightingAPI) {
  if (!DEBUG_ENABLED) throw new Error('Debug mode is disabled.');
  const power = await api.getPowerStatus();
  if (!power.manualMeasurement || power.modelRevision !== 0x8006)
    throw new Error('Unlimited manual test firmware is required. This page will not send presets to normal/limited firmware.');
  if (!power.usbConfigured || !power.frameValid || power.ageMs > 500 || power.startupActive)
    throw new Error('Board output is not ready. Wait for startup to finish, then check firmware again.');
  const data = await debugCommand(hid, 0x86);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length !== 25 || data[0] !== 1 || data[1] !== 255 ||
      ![SINGLE_COLOUR_BUILD, ...MIXED_BUILDS].includes(view.getUint32(8, true)) || data[3])
    throw new Error('Unexpected manual test firmware/status; no measurement accepted.');
  return {build: view.getUint32(8, true), uptime: view.getUint32(4, true), power};
}
export async function readOutput(hid: ToffeeHIDDevice): Promise<Output> {
  const data = await debugCommand(hid, 0x89);
  if (data.length !== 25 || data[0] !== 1 || data[1] !== 1 || data[24] !== 0)
    throw new Error('Final RGB telemetry is unavailable.');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const ageMs = view.getUint16(4, true);
  if (ageMs > 500) throw new Error('Final RGB telemetry is stale.');
  const groups = [66, 22, 16].map((count, group) => Array.from({length: 3}, (_, colour) => {
    const sum = view.getUint16(6 + (group * 3 + colour) * 2, true);
    if (sum > count * 255) throw new Error('Invalid final RGB totals.');
    return sum;
  }));
  return {frame: view.getUint16(2, true), ageMs, groups};
}
export async function verifyPreset(hid: ToffeeHIDDevice, api: ToffeeLightingAPI, value: Preset): Promise<Sample> {
  const status = await manualStatus(hid, api);
  if ('groups' in value && !MIXED_BUILDS.includes(status.build))
    throw new Error('Mixed-colour states require unlimited build 0x26101001 or 0x26101002.');
  const output = await readOutput(hid);
  if (JSON.stringify(output.groups) !== JSON.stringify(sumsFor(value)))
    throw new Error('Actual RGB output differs from this preset. It may have changed in another tab; reapply before recording.');
  return {...status, output};
}
export const allOff = (hid: ToffeeHIDDevice) => debugCommand(hid, 0x7c, new Uint8Array([255, 255, 255, 255, 255]));

export function meterValues(amps: string, voltage: string) {
  if (!amps.trim() || !Number.isFinite(Number(amps)) || Number(amps) < 0 ||
      (voltage.trim() && (!Number.isFinite(Number(voltage)) || Number(voltage) <= 0)))
    throw new Error('Enter measured current in amps (0 or greater); optional voltage must be positive.');
  return {amps: Number(amps), voltage: voltage.trim() ? Number(voltage) : null};
}
export function loadReadings(storage: Storage): Reading[] {
  const text = storage.getItem(READINGS_KEY);
  if (text === null) return [];
  const data = JSON.parse(text);
  if (!data || data.version !== 1 || !Array.isArray(data.readings)) throw new Error('Unrecognised saved readings; stored data has not been changed.');
  for (const row of data.readings) {
    if (!row || typeof row.id !== 'string' || typeof row.pcb !== 'string' || !row.pcb.trim() ||
        typeof row.notes !== 'string' || !Number.isFinite(Date.parse(row.at)) || !Number.isFinite(Date.parse(row.appliedAt)) ||
        !Number.isFinite(row.amps) || row.amps < 0 ||
        (row.voltage !== null && (!Number.isFinite(row.voltage) || row.voltage <= 0)) ||
        !row.preset || !row.sample || ![SINGLE_COLOUR_BUILD, ...MIXED_BUILDS].includes(row.sample.build) || !row.sample.output ||
        !row.sample.power || !Number.isFinite(row.sample.power.effectiveLedMa) || !Number.isFinite(row.sample.power.baseMa))
      throw new Error('Invalid saved reading; stored data has not been changed.');
    const mixed = 'groups' in row.preset;
    const canonical = mixed ? MIXED_CHECKLIST.find(value => value.key === row.preset.key) :
      preset(row.preset.group, row.preset.colour, row.preset.count, row.preset.level);
    if (!canonical || (mixed && !MIXED_BUILDS.includes(row.sample.build)) || row.preset.key !== canonical.key ||
        (mixed ? JSON.stringify(row.preset.groups) !== JSON.stringify((canonical as MixedPreset).groups) :
          JSON.stringify(row.preset.indices) !== JSON.stringify((canonical as SinglePreset).indices) ||
          JSON.stringify(row.preset.rgb) !== JSON.stringify((canonical as SinglePreset).rgb)) ||
        JSON.stringify(row.sample.output.groups) !== JSON.stringify(sumsFor(canonical)))
      throw new Error('Saved preset/output mismatch; stored data has not been changed.');
  }
  return data.readings;
}
export function readingsJSON(readings: Reading[]): string {
  return JSON.stringify({version: 1, readings}, null, 2);
}
export function appendReading(storage: Storage, row: Reading): Reading[] {
  const readings = [...loadReadings(storage), row]; // Read current storage, not this component's earlier snapshot.
  storage.setItem(READINGS_KEY, readingsJSON(readings));
  return readings;
}
export function readingsCSV(readings: Reading[]): string {
  const quote = (value: string | number | null) => {
    let text = value === null ? '' : String(value);
    if (typeof value === 'string' && /^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const rows = readings.map(row => {
    const p = row.preset, mixed = 'groups' in p;
    return [row.pcb, row.at, p.key, mixed ? 'mixed' : p.group, mixed ? 'Mixed' : p.colour,
    mixed ? 104 : p.count, mixed ? null : p.level, mixed ? null : p.rgb.join('/'), row.amps, row.voltage,
    `0x${row.sample.build.toString(16)}`, row.sample.power.baseMa + row.sample.power.effectiveLedMa,
    JSON.stringify(row.sample.output.groups), row.notes,
    ...(['front', 'rear', 'badge'] as const).map(group => mixed ?
      p.groups.find(value => value.group === group)!.rgb.join('/') :
      p.group === group || p.group === 'all' ? p.rgb.join('/') : '0/0/0')];
  });
  return '\uFEFF' + [['PCB', 'Recorded at', 'Preset ID', 'Group', 'Colour', 'LED count', 'Level /255', 'RGB',
    'Measured A', 'Measured V', 'Firmware build', 'Estimated board mA', 'Transmitted RGB sums', 'Notes', 'Front RGB', 'Rear RGB', 'Badge RGB'],
    ...rows].map(row => row.map(quote).join(',')).join('\r\n');
}
