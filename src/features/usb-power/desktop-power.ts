import {MODULE_FILTER} from '../firmware-installer/firmware-update';
import {CommandID, ReturnCode, ToffeeHIDDevice} from '../../utils/toffee_studio/hid';
import {isEmulatedBoardConnected} from '../../utils/toffee_studio/emulated-board';
import {MAX_MA, SAFE_MA, PortBudget, type BudgetReply} from './port-budget';

async function command(hid: ToffeeHIDDevice, request?: Uint8Array): Promise<BudgetReply> {
  const [status, data] = await hid.executeCommand(CommandID.MODULE_CMD_DESKTOP_BUDGET, request);
  if (status === ReturnCode.INVALID_COMMAND) throw new Error('This firmware uses a fixed current limit.');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (status !== ReturnCode.SUCCESS || data[0] !== 1) throw new Error('The keyboard did not accept the desktop USB command.');
  const milliamps = view.getUint16(1, true);
  const maximum = view.getUint16(3, true);
  const board = Array.from(data.slice(5, 21), b => b.toString(16).padStart(2, '0')).join('');
  if (maximum > MAX_MA || milliamps < SAFE_MA || milliamps > maximum || /^0+$/.test(board)) {
    throw new Error('The keyboard sent invalid USB limit data.');
  }
  return {board, milliamps, maximum};
}

const matches = (device: HIDDevice) => device.vendorId === MODULE_FILTER.vendorId &&
  device.productId === MODULE_FILTER.productId &&
  device.collections.some(c => c.usagePage === MODULE_FILTER.usagePage && c.usage === MODULE_FILTER.usage);
const storageKey = (key: string) => 'toffee-usb-budget-v1:' + key;
let asleep = false;

export const desktopPower = new PortBudget({
  async connection() {
    if (asleep || isEmulatedBoardConnected()) return null;
    const devices = (await navigator.hid.getDevices()).filter(matches);
    if (devices.length !== 1) return null;
    const [device] = devices;
    const port = await window.toffeeDesktop!.modulePort();
    const current = (await navigator.hid.getDevices()).filter(matches);
    if (!port || current.length !== 1 || current[0] !== device || asleep || isEmulatedBoardConnected()) return null;
    const hid = new ToffeeHIDDevice(device);
    return {
      device, port,
      read: () => command(hid),
      set(board, ma) {
        const request = new Uint8Array(19);
        request[0] = 1;
        new DataView(request.buffer).setUint16(1, ma, true);
        request.set(Uint8Array.from(board.match(/../g)!, pair => parseInt(pair, 16)), 3);
        return command(hid, request);
      },
    };
  },
  saved(key) {
    const saved = localStorage.getItem(storageKey(key));
    return saved === null ? null : Number(saved);
  },
  save(key, value) {
    localStorage.setItem(storageKey(key), String(value));
  },
  clear(key) {
    localStorage.removeItem(storageKey(key));
  },
});

export function startDesktopPower() {
  if (!window.toffeeDesktop || !navigator.hid) return;
  const update = () => desktopPower.invalidate();
  navigator.hid.addEventListener('connect', update);
  navigator.hid.addEventListener('disconnect', update);
  window.toffeeDesktop.onPowerChange(next => { asleep = next; update(); });

  const poll = async () => {
    await desktopPower.reconcile();
    setTimeout(poll, 1250);
  };
  void poll();
}
