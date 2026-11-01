// Debug-only emulated Toffee Module.
//
// A fake WebHID device that answers the VIA protocol and the Toffee lighting commands from memory,
// so the configurator can be used without a board (open the app with ?debug=1, then press
// "Connect emulated board"). It never reaches USB, firmware or a real board. While it is connected,
// real boards are hidden from the app; disconnecting gives them back. Its keymap, macros and
// lighting last for this browser tab (sessionStorage), and so does the connection, so a reload
// comes back to the same emulated board.
import {DEBUG_ENABLED} from '../../config/debug';
import {BADGE_EFFECTS, FRONT_EFFECTS} from './lighting-effects';

export const EMULATED_PRODUCT_NAME = 'Toffee Module (emulated)';
const VENDOR_ID = 0x1067, PRODUCT_ID = 0x626d;
const ROWS = 9, COLS = 8, LAYERS = 4, MACRO_COUNT = 16, MACRO_BYTES = 1024, LED_COUNT = 104;
const STATE_KEY = 'toffee-emulated-board';
const CONNECTED_KEY = 'toffee-emulated-board-connected';
const KC_TRNS = 0x0001;

// Default Module layout: matrix "row,col" -> QMK keycode (protocol 12 numbering).
const KC = {
  A: 0x04, B: 0x05, C: 0x06, D: 0x07, E: 0x08, F: 0x09, G: 0x0a, H: 0x0b, I: 0x0c, J: 0x0d, K: 0x0e,
  L: 0x0f, M: 0x10, N: 0x11, O: 0x12, P: 0x13, Q: 0x14, R: 0x15, S: 0x16, T: 0x17, U: 0x18, V: 0x19,
  W: 0x1a, X: 0x1b, Y: 0x1c, Z: 0x1d, N1: 0x1e, N2: 0x1f, N3: 0x20, N4: 0x21, N5: 0x22, N6: 0x23,
  N7: 0x24, N8: 0x25, N9: 0x26, N0: 0x27, ENT: 0x28, ESC: 0x29, BSPC: 0x2a, TAB: 0x2b, SPC: 0x2c,
  MINS: 0x2d, EQL: 0x2e, LBRC: 0x2f, RBRC: 0x30, BSLS: 0x31, SCLN: 0x33, QUOT: 0x34, GRV: 0x35,
  COMM: 0x36, DOT: 0x37, SLSH: 0x38, CAPS: 0x39, DEL: 0x4c, PGUP: 0x4b, PGDN: 0x4e, RGHT: 0x4f,
  LEFT: 0x50, DOWN: 0x51, UP: 0x52, LCTL: 0xe0, LSFT: 0xe1, LALT: 0xe2, LGUI: 0xe3, RSFT: 0xe5,
  RGUI: 0xe7, MO1: 0x5221,
};
const DEFAULT_LAYER: Record<string, number> = {
  '0,0': KC.ESC, '1,0': KC.N1, '0,5': KC.N2, '1,5': KC.N3, '0,4': KC.N4, '1,4': KC.N5, '0,3': KC.N6,
  '1,3': KC.N7, '0,2': KC.N8, '1,2': KC.N9, '0,1': KC.N0, '1,1': KC.MINS, '0,6': KC.EQL, '1,6': KC.BSPC,
  '0,7': KC.GRV, '2,0': KC.TAB, '3,0': KC.Q, '2,1': KC.W, '3,1': KC.E, '2,2': KC.R, '3,2': KC.T,
  '2,3': KC.Y, '3,3': KC.U, '2,4': KC.I, '3,4': KC.O, '2,5': KC.P, '3,5': KC.LBRC, '2,6': KC.RBRC,
  '3,6': KC.BSLS, '2,7': KC.DEL, '4,0': KC.CAPS, '5,0': KC.A, '4,1': KC.S, '5,1': KC.D, '4,2': KC.F,
  '5,2': KC.G, '4,3': KC.H, '5,3': KC.J, '4,4': KC.K, '5,4': KC.L, '4,5': KC.SCLN, '5,5': KC.QUOT,
  '4,6': KC.ENT, '4,7': KC.PGUP, '7,0': KC.LSFT, '6,0': KC.LSFT, '6,1': KC.Z, '7,1': KC.X, '6,2': KC.C,
  '7,2': KC.V, '6,3': KC.B, '7,3': KC.N, '7,4': KC.M, '6,4': KC.COMM, '7,5': KC.DOT, '6,5': KC.SLSH,
  '6,6': KC.RSFT, '7,6': KC.UP, '6,7': KC.PGDN, '8,0': KC.LCTL, '8,1': KC.LGUI, '8,2': KC.LALT,
  '8,3': KC.SPC, '8,4': KC.RGUI, '8,5': KC.MO1, '8,6': KC.LEFT, '5,6': KC.DOWN, '7,7': KC.RGHT,
};

export type EmulatedState = {
  keymap: number[];      // LAYERS × ROWS × COLS keycodes
  macros: number[];      // MACRO_BYTES
  layoutOptions: number;
  rear: number[];        // underglow: effect, speed, brightness, hue, saturation
  front: number[];       // keylights (Toffee): effect, speed, brightness, hue, saturation
  badge: number[];       // enabled, brightness, hue, saturation, effect, speed
  leds: number[];        // per-LED brightness, LED_COUNT
  keylights: number[];   // VIA rgb_matrix channel 3: brightness, effect, speed, hue, saturation
};

export function defaultEmulatedState(): EmulatedState {
  const keymap = Array(LAYERS * ROWS * COLS).fill(0);
  for (const [position, code] of Object.entries(DEFAULT_LAYER)) {
    const [row, col] = position.split(',').map(Number);
    keymap[row * COLS + col] = code;
  }
  for (let i = ROWS * COLS; i < keymap.length; i++) keymap[i] = KC_TRNS;
  return {
    keymap, macros: Array(MACRO_BYTES).fill(0), layoutOptions: 0,
    rear: [7, 110, 180, 190, 255], front: [1, 100, 140, 190, 230], badge: [1, 160, 200, 255, 1, 100],
    leds: Array(LED_COUNT).fill(255), keylights: [180, 1, 140, 190, 230],
  };
}

const isByteArray = (value: unknown, length: number, maximum = 255) =>
  Array.isArray(value) && value.length === length &&
  value.every(entry => Number.isInteger(entry) && entry >= 0 && entry <= maximum);
function validState(value: any): value is EmulatedState {
  return value && isByteArray(value.keymap, LAYERS * ROWS * COLS, 0xffff) &&
    isByteArray(value.macros, MACRO_BYTES) && Number.isInteger(value.layoutOptions) &&
    isByteArray(value.rear, 5) && isByteArray(value.front, 5) && isByteArray(value.badge, 6) &&
    isByteArray(value.leds, LED_COUNT) && isByteArray(value.keylights, 5);
}

const tabStorage = (): Storage | null => {
  try {return window.sessionStorage;} catch {return null;}
};
function loadState(): EmulatedState {
  try {
    const saved = JSON.parse(tabStorage()?.getItem(STATE_KEY) || 'null');
    if (validState(saved)) return saved;
  } catch {
    // Ignore unreadable saved state.
  }
  return defaultEmulatedState();
}
function saveState(state: EmulatedState) {
  try {tabStorage()?.setItem(STATE_KEY, JSON.stringify(state));} catch {
    // The board still works for this page if storage is full or blocked.
  }
}

const clamp = (value: number, maximum: number) => Math.min(Math.max(value, 0), maximum);
const keymapBytes = (keymap: number[]) => keymap.flatMap(code => [code >> 8, code & 0xff]);

/**
 * Answers one 32-byte output report the way the Module firmware does. Returns the input report,
 * or null when the firmware would not reply. Changes `state` in place for set commands and
 * reports whether anything changed.
 */
export function emulatedReply(state: EmulatedState, report: Uint8Array, now = 0): {reply: Uint8Array | null; changed: boolean} {
  const p = new Uint8Array(32);
  p.set(report.slice(0, 32));
  const reply = new Uint8Array(32);
  let changed = false;
  // Toffee commands: [0x09, command, packet id ×4, payload…]; replies carry 0xa5, the command and
  // the packet id in bytes 26–31, and a status in byte 0.
  if (p[0] === 0x09 && p[1] >= 0x50 && p[1] <= 0x8e) {
    const code = p[1], a = p.slice(6);
    reply[26] = 0xa5; reply[27] = code; reply.set(p.slice(2, 6), 28);
    const data = (bytes: number[]) => reply.set(bytes, 1);
    switch (code) {
      case 0x85: data([3, 66, 22, 16, LED_COUNT, FRONT_EFFECTS.length, BADGE_EFFECTS.length]); break;
      case 0x76: data(state.rear); break;
      case 0x71: state.rear[0] = clamp(a[0], 9); changed = true; break;
      case 0x72: state.rear[1] = a[0]; changed = true; break;
      case 0x74: state.rear[2] = a[0]; changed = true; break;
      case 0x75: state.rear[3] = a[0]; state.rear[4] = a[1]; changed = true; break;
      case 0x80: data(state.front); break;
      case 0x81: state.front = [clamp(a[0], FRONT_EFFECTS.length - 1), a[1], a[2], a[3], a[4]]; changed = true; break;
      case 0x82: data(state.badge.slice(0, 4)); break;
      case 0x83: state.badge.splice(0, 4, a[0] ? 1 : 0, a[1], a[2], a[3]); changed = true; break;
      case 0x8d: data(state.badge); break;
      case 0x8e: state.badge = [a[0] ? 1 : 0, a[1], a[2], a[3], clamp(a[4], BADGE_EFFECTS.length - 1), a[5]]; changed = true; break;
      case 0x84:
        if (a[0] >= LED_COUNT) reply[0] = 0xef; else data([a[0], state.leds[a[0]]]);
        break;
      case 0x7b:
        if (a[0] >= LED_COUNT) reply[0] = 0xef; else {state.leds[a[0]] = a[1]; changed = true;}
        break;
      case 0x88: {
        // Current telemetry, schema 2: a normal, configured board well inside its budget.
        const d = new Uint8Array(25), v = new DataView(d.buffer);
        d[0] = 2; d[1] = 1 | 4 | 16;
        v.setUint16(2, 9, true); v.setUint16(4, now & 0xffff, true); v.setUint16(6, 20, true);
        v.setUint16(8, 940, true); v.setUint16(10, 103, true); v.setUint16(12, 0, true);
        v.setUint16(14, 412, true); v.setUint16(16, 412, true); v.setUint16(18, 1000, true);
        v.setUint16(20, 1000, true); v.setUint16(22, 837, true); d[24] = 190;
        reply.set(d, 1);
        break;
      }
      // Display filesystem and factory-debug commands: the screenless Module rejects them.
      default: reply[0] = 0xef;
    }
    return {reply, changed};
  }

  // VIA protocol: replies echo the request, with values filled in.
  reply.set(p);
  const offset = (p[1] << 8) | p[2], size = p[3];
  const keyIndex = (layer: number, row: number, col: number) => layer * ROWS * COLS + row * COLS + col;
  switch (p[0]) {
    case 0x01: reply[1] = 0; reply[2] = 12; break; // protocol version 12
    case 0x02: { // get keyboard value
      reply.fill(0, 2);
      if (p[1] === 0x01) {const t = now >>> 0; reply.set([t >>> 24, (t >> 16) & 255, (t >> 8) & 255, t & 255], 2);}
      else if (p[1] === 0x02) {const o = state.layoutOptions >>> 0; reply.set([o >>> 24, (o >> 16) & 255, (o >> 8) & 255, o & 255], 2);}
      // 0x03 switch matrix: nothing pressed. 0x04 firmware version: 0.
      break;
    }
    case 0x03: // set keyboard value: layout options; device indication only flashes LEDs
      if (p[1] === 0x02) {state.layoutOptions = ((p[2] << 24) | (p[3] << 16) | (p[4] << 8) | p[5]) >>> 0; changed = true;}
      break;
    case 0x04: {
      if (p[1] >= LAYERS || p[2] >= ROWS || p[3] >= COLS) break;
      const code = state.keymap[keyIndex(p[1], p[2], p[3])];
      reply[4] = code >> 8; reply[5] = code & 0xff;
      break;
    }
    case 0x05:
      if (p[1] >= LAYERS || p[2] >= ROWS || p[3] >= COLS) break;
      state.keymap[keyIndex(p[1], p[2], p[3])] = (p[4] << 8) | p[5]; changed = true;
      break;
    case 0x07: case 0x08: { // custom menu set / get, channel 3 = rgb_matrix (keylights)
      const [channel, id] = [p[1], p[2]];
      if (channel !== 3 || id < 1 || id > 4) break;
      if (p[0] === 0x08) {
        if (id === 4) {reply[3] = state.keylights[3]; reply[4] = state.keylights[4];}
        else reply[3] = state.keylights[[0, 0, 1, 2][id]];
      } else {
        if (id === 4) {state.keylights[3] = p[3]; state.keylights[4] = p[4];}
        else state.keylights[[0, 0, 1, 2][id]] = p[3];
        changed = true;
      }
      break;
    }
    case 0x09: break; // custom menu save: already kept
    case 0x0a: Object.assign(state, defaultEmulatedState()); changed = true; break; // EEPROM reset
    case 0x0b: return {reply: null, changed}; // bootloader jump: an emulated board stays put
    case 0x0c: reply[1] = MACRO_COUNT; break;
    case 0x0d: reply[1] = MACRO_BYTES >> 8; reply[2] = MACRO_BYTES & 0xff; break;
    case 0x0e: reply.fill(0, 4); reply.set(state.macros.slice(offset, offset + Math.min(size, 28)), 4); break;
    case 0x0f:
      for (let i = 0; i < Math.min(size, 28) && offset + i < MACRO_BYTES; i++) state.macros[offset + i] = p[4 + i];
      changed = true;
      break;
    case 0x10: state.macros.fill(0); changed = true; break;
    case 0x11: reply[1] = LAYERS; break;
    case 0x12: reply.fill(0, 4); reply.set(keymapBytes(state.keymap).slice(offset, offset + Math.min(size, 28)), 4); break;
    case 0x13: {
      const bytes = keymapBytes(state.keymap);
      for (let i = 0; i < Math.min(size, 28) && offset + i < bytes.length; i++) bytes[offset + i] = p[4 + i];
      for (let i = 0; i < state.keymap.length; i++) state.keymap[i] = (bytes[i * 2] << 8) | bytes[i * 2 + 1];
      changed = true;
      break;
    }
    case 0x14: case 0x15: break; // the Module has no encoders
    default: reply[0] = 0xff; // id_unhandled
  }
  return {reply, changed};
}

class EmulatedModule extends EventTarget {
  readonly vendorId = VENDOR_ID;
  readonly productId = PRODUCT_ID;
  readonly productName = EMULATED_PRODUCT_NAME;
  readonly collections = [{usagePage: 0xff60, usage: 0x61, type: 0, children: [], inputReports: [], outputReports: [], featureReports: []}];
  readonly emulated = true;
  opened = false;
  oninputreport: ((event: Event) => void) | null = null;
  constructor(private state: EmulatedState) {super();}
  async open() {this.opened = true;}
  async close() {this.opened = false;}
  async forget() {}
  async sendFeatureReport() {throw new Error('The emulated board has no feature reports.');}
  async receiveFeatureReport(): Promise<DataView> {throw new Error('The emulated board has no feature reports.');}
  async sendReport(_reportId: number, data: BufferSource) {
    if (!this.opened) throw new Error('The emulated board is not open.');
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) :
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const {reply, changed} = emulatedReply(this.state, bytes, Math.floor(performance.now()));
    if (changed) saveState(this.state);
    if (!reply) return;
    // Like USB, the reply arrives after sendReport resolves.
    setTimeout(() => {
      if (!this.opened) return;
      const event = new Event('inputreport');
      Object.assign(event, {device: this, reportId: 0, data: new DataView(reply.buffer)});
      this.dispatchEvent(event);
      this.oninputreport?.(event);
    }, 2);
  }
}

let active: EmulatedModule | null = null;
let restoreHid: (() => void) | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());

/** Browsers without WebHID get an empty stand-in in Debug mode, so the emulated board still works. */
export function ensureDebugHid(): void {
  if (!DEBUG_ENABLED || typeof navigator === 'undefined' || 'hid' in navigator) return;
  const stub = Object.assign(new EventTarget(), {
    getDevices: async () => [],
    requestDevice: async () => {throw new Error('This browser has no WebHID; only the emulated board is available.');},
  });
  Object.defineProperty(navigator, 'hid', {configurable: true, value: stub});
}

export const isEmulatedBoardConnected = () => active !== null;
export const isEmulatedDevice = (device: unknown) => device instanceof EmulatedModule;
export function subscribeEmulatedBoard(listener: () => void): () => void {
  listeners.add(listener);
  return () => {listeners.delete(listener);};
}

/** Makes the emulated board the only WebHID device the app can see. */
export function connectEmulatedBoard(): void {
  if (!DEBUG_ENABLED) throw new Error('The emulated board is only available in Debug mode (?debug=1).');
  if (active) return;
  ensureDebugHid();
  const hid = navigator.hid as unknown as Record<string, unknown>;
  const device = new EmulatedModule(loadState());
  const saved = (['getDevices', 'requestDevice'] as const).map(name => [name, Object.getOwnPropertyDescriptor(hid, name)] as const);
  hid.getDevices = async () => [device];
  hid.requestDevice = async () => [device];
  restoreHid = () => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(hid, name, descriptor);
      else delete hid[name];
    }
  };
  active = device;
  try {tabStorage()?.setItem(CONNECTED_KEY, '1');} catch {/* only this page remembers */}
  notify();
}

/** Gives the browser's real WebHID devices back to the app. */
export function disconnectEmulatedBoard(): void {
  if (!active) return;
  restoreHid?.();
  restoreHid = null;
  active.opened = false;
  active = null;
  try {tabStorage()?.removeItem(CONNECTED_KEY);} catch {/* nothing remembered */}
  notify();
}

/** After a reload in Debug mode, reconnects the emulated board if this tab had it connected. */
export function restoreEmulatedBoard(): void {
  if (!DEBUG_ENABLED) return;
  ensureDebugHid();
  let remembered = false;
  try {remembered = tabStorage()?.getItem(CONNECTED_KEY) === '1';} catch {/* not remembered */}
  if (remembered) connectEmulatedBoard();
}

