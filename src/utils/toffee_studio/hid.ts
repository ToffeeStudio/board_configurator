import {ToffeeCDC} from './cdc';
import lightingMap from './lighting-map.json';
import {FRONT_EFFECTS, BADGE_EFFECTS} from './lighting-effects';

/**
 * Command IDs for the custom module filesystem protocol.
 */
export enum CommandID {
  MODULE_CMD_LS = 0x50,
  MODULE_CMD_CD = 0x51,
  MODULE_CMD_PWD = 0x52,
  MODULE_CMD_RM = 0x53,
  MODULE_CMD_MKDIR = 0x54,
  MODULE_CMD_TOUCH = 0x55,
  MODULE_CMD_CAT = 0x56,
  MODULE_CMD_OPEN = 0x57,
  MODULE_CMD_WRITE = 0x58,
  MODULE_CMD_CLOSE = 0x59,
  MODULE_CMD_FORMAT_FILESYSTEM = 0x5a,
  MODULE_CMD_FLASH_REMAINING = 0x5b,
  MODULE_CMD_CHOOSE_IMAGE = 0x5c,
  MODULE_CMD_WRITE_DISPLAY = 0x5d,
  MODULE_CMD_SET_TIME = 0x5e,
  MODULE_CMD_LS_NEXT = 0x60,
  MODULE_CMD_LS_ALL = 0x61,
  // New Lighting Commands
  MODULE_CMD_SET_ANIMATION = 0x71,
  MODULE_CMD_SET_SPEED = 0x72,
  MODULE_CMD_SET_BRIGHTNESS = 0x74,
  MODULE_CMD_SET_COLOR_HS = 0x75,
  MODULE_CMD_GET_LIGHTING_STATE = 0x76,
  MODULE_CMD_SET_LED_BRIGHTNESS = 0x7b,
  MODULE_CMD_FRONT_GET = 0x80,
  MODULE_CMD_FRONT_SET = 0x81,
  MODULE_CMD_BADGE_GET = 0x82,
  MODULE_CMD_BADGE_SET = 0x83,
  MODULE_CMD_LED_GET = 0x84,
  MODULE_CMD_CAPABILITIES = 0x85,
  MODULE_CMD_POWER_STATUS = 0x88,
  MODULE_CMD_BADGE_ANIMATION_GET = 0x8d,
  MODULE_CMD_BADGE_ANIMATION_SET = 0x8e,
}

/**
 * Return codes from the custom module.
 */
export enum ReturnCode {
  SUCCESS = 0x00,
  IMAGE_ALREADY_EXISTS = 0xe1,
  IMAGE_FLASH_FULL = 0xe2,
  IMAGE_W_OOB = 0xe3,
  IMAGE_H_OOB = 0xe4,
  IMAGE_NAME_IN_USE = 0xe5,
  IMAGE_NOT_FOUND = 0xe6,
  IMAGE_NOT_OPEN = 0xe7,
  IMAGE_PACKET_ID_ERR = 0xe8,
  FLASH_REMAINING = 0xe9,
  INVALID_COMMAND = 0xef,
  MORE_ENTRIES = 0xea,
}

const PACKET_SIZE = 32;
const MAGIC_BYTE = 0x09;
const HEADER_SIZE = 6; // Magic (1) + Command (1) + Packet ID (4)
const DATA_SIZE = PACKET_SIZE - HEADER_SIZE;

/**
 * A low-level class to handle raw HID packet communication with the custom device.
 * Assumes it's initialized with a pre-authorized HIDDevice object from VIA.
 */
type HIDSession = {queue: Promise<void>; packetId: number};
const sessions = new WeakMap<HIDDevice, HIDSession>();

export class ToffeeHIDDevice {
  private session: HIDSession;
  constructor(private webHidDevice: HIDDevice) {
    if (!webHidDevice) throw new Error('ToffeeHIDDevice requires a valid HIDDevice object.');
    let session = sessions.get(webHidDevice);
    if (!session) {
      session = {queue: Promise.resolve(), packetId: 0};
      sessions.set(webHidDevice, session);
    }
    this.session = session;
  }
  public async open(): Promise<void> {
    if (!this.webHidDevice.opened) await this.webHidDevice.open();
  }
  public async close(): Promise<void> {
    await this.session.queue;
    if (this.webHidDevice.opened) await this.webHidDevice.close();
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.session.queue.then(operation);
    this.session.queue = result.then(() => {}, () => {});
    return result;
  }
  private async sendPacket(commandId: CommandID, data: Uint8Array, packetId: number): Promise<void> {
    if (data.length > DATA_SIZE) throw new Error('HID payload exceeds 26 bytes.');
    const packet = new Uint8Array(PACKET_SIZE);
    const view = new DataView(packet.buffer);
    view.setUint8(0, MAGIC_BYTE);
    view.setUint8(1, commandId);
    view.setUint32(2, packetId, true);
    packet.set(data, HEADER_SIZE);
    console.log(`HID send #${packetId} command 0x${commandId.toString(16)}.`);
    await this.webHidDevice.sendReport(0, packet);
  }
  private async exchangeCommand(commandId: CommandID, data: Uint8Array): Promise<[ReturnCode, Uint8Array]> {
    await this.open();
    const packetId = this.session.packetId++ >>> 0;
    let listener!: (event: HIDInputReportEvent) => void;
    let timeout!: ReturnType<typeof setTimeout>;
    const response = new Promise<Uint8Array>((resolve, reject) => {
      listener = (event) => {
        if (event.device !== this.webHidDevice) return;
        if (event.data.byteLength !== PACKET_SIZE) {
          reject(new Error('Board returned an incomplete HID report.'));
          return;
        }
        const packet = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
        // Standard VIA replies, stale replies and another command must not satisfy this request.
        if (packet[26] !== 0xa5 || packet[27] !== commandId ||
            event.data.getUint32(28, true) !== packetId) return;
        resolve(packet.slice());
      };
      timeout = setTimeout(() => reject(new Error('HID read timed out after 1500ms; check connection and firmware version.')), 1500);
      this.webHidDevice.addEventListener('inputreport', listener);
    });
    try {
      const [, packet] = await Promise.all([this.sendPacket(commandId, data, packetId), response]);
      console.log(`HID reply #${packetId} status 0x${packet[0].toString(16)}.`);
      return [packet[0] as ReturnCode, packet.slice(1, 26)];
    } finally {
      clearTimeout(timeout);
      this.webHidDevice.removeEventListener('inputreport', listener);
    }
  }
  public sendPacketOnly(commandId: CommandID, data = new Uint8Array()): Promise<void> {
    return this.enqueue(async () => {
      await this.open();
      await this.sendPacket(commandId, data, this.session.packetId++ >>> 0);
    });
  }
  public executeCommand(commandId: CommandID, data = new Uint8Array()): Promise<[ReturnCode, Uint8Array]> {
    return this.enqueue(() => this.exchangeCommand(commandId, data));
  }
}

/**
 * A class to interact with the device's filesystem via the ToffeeHIDDevice.
 */
export class ToffeeFileSystemAPI {
  constructor(private hid: ToffeeHIDDevice) {}

  /**
   * Lists the files in the current directory on the device.
   * Handles pagination automatically.
   */
  public async ls(): Promise<string[]> {
    const allEntries: string[] = [];
    const decoder = new TextDecoder('utf-8');

    const parseAndAddEntries = (data: Uint8Array) => {
      const decoded = decoder.decode(data);
      // Split by null characters and filter out any empty strings that result
      const entries = decoded.split('\0').filter((e) => e.length > 0);
      allEntries.push(...entries);
    };

    let [retCode, responseData] = await this.hid.executeCommand(
      CommandID.MODULE_CMD_LS,
    );

    if (
      retCode === ReturnCode.SUCCESS ||
      retCode === ReturnCode.MORE_ENTRIES
    ) {
      parseAndAddEntries(responseData);
    } else {
      console.error(`ls command failed with code: 0x${retCode.toString(16)}`);
      return [];
    }

    while (retCode === ReturnCode.MORE_ENTRIES) {
      console.log('More entries to fetch, sending LS_NEXT...');
      [retCode, responseData] = await this.hid.executeCommand(
        CommandID.MODULE_CMD_LS_NEXT,
      );

      if (
        retCode === ReturnCode.SUCCESS ||
        retCode === ReturnCode.MORE_ENTRIES
      ) {
        parseAndAddEntries(responseData);
      } else {
        console.error(
          `ls_next command failed with code: 0x${retCode.toString(16)}`,
        );
        break; // Exit loop on error
      }
    }

    return allEntries;
  }
  /**
   * Triggers the device to dump all files over CDC and receives them.
   * @param cdc An active and connected ToffeeCDC instance.
   * @returns A promise that resolves to an array of received files.
   */
  public async ls_all(cdc: ToffeeCDC): Promise<{ filename: string; data: Uint8Array }[]> {
    console.log(`[ls_all] Sending command 0x${CommandID.MODULE_CMD_LS_ALL.toString(16)} via HID to trigger CDC dump...`);
    
    // 1. Send the HID command to trigger the CDC dump
    await this.hid.sendPacketOnly(CommandID.MODULE_CMD_LS_ALL);
    console.log('[ls_all] HID command sent.');

    // 2. Wait for the device and OS to initialize the CDC transfer
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // 3. Check for CDC connection and start receiving files
    if (!cdc.isConnected()) {
        console.error("[ls_all] CDC port is not connected. Aborting file receive.");
        return [];
    }

    console.log("[ls_all] CDC port is connected. Starting file reception...");
    return await cdc.receiveFiles();
  }
}

/**
 * A class to interact with the device's lighting system via the ToffeeHIDDevice.
 */
export type LightingState = {effect: number; speed: number; brightness: number; hue: number; saturation: number};
export type BadgeState = {enabled: boolean; brightness: number; hue: number; saturation: number};
export type BadgeAnimationState = BadgeState & {effect: number; speed: number};
export type LightingCapabilities = {version: number; frontEffects: number; badgeEffects: number};
export type PowerStatus = {
  frontBadgeMax: number | null; // v2 firmware output rescaling; v1 does not report it.
  manualMeasurement: boolean;
  currentUnlimited: boolean;
  configured: boolean; limited: boolean; usbConfigured: boolean; startupActive: boolean; frameValid: boolean;
  modelRevision: number; frame: number; ageMs: number; boardLimitMa: number; baseMa: number; marginMa: number;
  requestedLedMa: number; effectiveLedMa: number; limitPermille: number; startupPermille: number; ledBudgetMa: number;
};
const frontIndices = new Set(lightingMap.front.map(key => key.index));
function byte(value: number, name: string, maximum = 255): number {
  if (!Number.isInteger(value) || value < 0 || value > maximum)
    throw new Error(`${name} must be an integer from 0 to ${maximum}.`);
  return value;
}
function frontIndex(index: number): number {
  if (!frontIndices.has(index)) throw new Error('LED index must identify a regular front key.');
  return index;
}

export class ToffeeLightingAPI {
  constructor(private hid: ToffeeHIDDevice) {}

  public async getPowerStatus(): Promise<PowerStatus> {
    const [status, data] = await this.hid.executeCommand(CommandID.MODULE_CMD_POWER_STATUS);
    if (status === ReturnCode.INVALID_COMMAND)
      throw new Error('Debug current telemetry is unavailable in this firmware. A budget-enabled firmware update is required.');
    if (status !== ReturnCode.SUCCESS)
      throw new Error(`Board rejected current telemetry (status 0x${status.toString(16)}).`);
    if (data.length !== 25 || ![1, 2].includes(data[0]) || (data[1] & ~127) ||
        (data[0] === 1 && (data[24] !== 0 || (data[1] & 64))) || (data[0] === 2 && (data[1] & 32)))
      throw new Error('Unsupported or malformed current telemetry.');
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const value: PowerStatus = {
      frontBadgeMax: data[0] === 2 ? data[24] : null,
      manualMeasurement: Boolean(data[1] & 32),
      currentUnlimited: Boolean(data[1] & 64),
      configured: Boolean(data[1] & 1), limited: Boolean(data[1] & 2), usbConfigured: Boolean(data[1] & 4),
      startupActive: Boolean(data[1] & 8), frameValid: Boolean(data[1] & 16),
      modelRevision: view.getUint16(2, true), frame: view.getUint16(4, true), ageMs: view.getUint16(6, true),
      boardLimitMa: view.getUint16(8, true), baseMa: view.getUint16(10, true), marginMa: view.getUint16(12, true),
      requestedLedMa: view.getUint16(14, true), effectiveLedMa: view.getUint16(16, true),
      limitPermille: view.getUint16(18, true), startupPermille: view.getUint16(20, true), ledBudgetMa: view.getUint16(22, true),
    };
    const budget = value.configured ? Math.max(0, value.boardLimitMa - value.baseMa - value.marginMa) : 0;
    if (value.limitPermille > 1000 || value.startupPermille > 1000 || value.ledBudgetMa !== budget ||
        (!value.manualMeasurement && !value.currentUnlimited && value.effectiveLedMa > budget) || value.effectiveLedMa > value.requestedLedMa ||
        (value.currentUnlimited && (value.modelRevision !== 10 || value.frontBadgeMax !== 200 || value.limited || value.limitPermille !== 1000)) ||
        (value.manualMeasurement && (!value.configured || value.modelRevision < 0x8000 || value.limited || value.limitPermille !== 1000)))
      throw new Error('Inconsistent current telemetry; no budget reading accepted.');
    return value;
  }

  private async command(commandId: CommandID, payload: Uint8Array): Promise<Uint8Array> {
    const [status, response] = await this.hid.executeCommand(commandId, payload);
    if (status !== ReturnCode.SUCCESS) {
      throw new Error(
        `Board firmware rejected lighting command 0x${commandId.toString(16)} (status 0x${status.toString(16)}).`,
      );
    }
    return response;
  }

  /**
   * Sets the lighting animation effect.
   * @param effectId The ID of the animation (0-9).
   */
  public async setAnimation(effectId: number): Promise<void> {
    const payload = new Uint8Array([byte(effectId, 'Underglow effect', 9)]);
    await this.command(CommandID.MODULE_CMD_SET_ANIMATION, payload);
  }

  /**
   * Sets the lighting animation speed.
   * @param speed The speed value (0-255).
   */
  public async setSpeed(speed: number): Promise<void> {
    const payload = new Uint8Array([byte(speed, 'Speed')]);
    await this.command(CommandID.MODULE_CMD_SET_SPEED, payload);
  }

  /**
   * Sets the lighting brightness.
   * @param brightness The brightness value (0-255).
   */
  public async setBrightness(brightness: number): Promise<void> {
    const payload = new Uint8Array([byte(brightness, 'Brightness')]);
    await this.command(CommandID.MODULE_CMD_SET_BRIGHTNESS, payload);
  }

  /**
   * Sets the brightness of a single LED, on top of the global brightness.
   * @param ledIndex The LED index (0-based).
   * @param brightness 255 = full, 0 = off.
   */
  public async setLedBrightness(ledIndex: number, brightness: number): Promise<void> {
    const payload = new Uint8Array([frontIndex(ledIndex), byte(brightness, 'Brightness')]);
    await this.command(CommandID.MODULE_CMD_SET_LED_BRIGHTNESS, payload);
  }

  public async getCapabilities(): Promise<LightingCapabilities> {
    const data = await this.command(CommandID.MODULE_CMD_CAPABILITIES, new Uint8Array());
    if (data[1] !== 66 || data[2] !== 22 || data[3] !== 16 || data[4] !== 104 ||
        !(data[0] === 2 && data[5] === 9 ||
          data[0] === 3 && data[5] === FRONT_EFFECTS.length && data[6] === BADGE_EFFECTS.length)) {
      throw new Error('This menu requires the latest screenless Module lighting firmware.');
    }
    return {version: data[0], frontEffects: data[5], badgeEffects: data[0] === 2 ? 2 : data[6]};
  }
  public async getFrontState(): Promise<LightingState> {
    const data = await this.command(CommandID.MODULE_CMD_FRONT_GET, new Uint8Array());
    if (data[0] >= FRONT_EFFECTS.length) throw new Error('Invalid front lighting effect.');
    return {effect: data[0], speed: data[1], brightness: data[2], hue: data[3], saturation: data[4]};
  }
  public async setFrontState(state: LightingState): Promise<void> {
    await this.command(CommandID.MODULE_CMD_FRONT_SET,
      new Uint8Array([byte(state.effect, 'Front effect', FRONT_EFFECTS.length - 1), byte(state.speed, 'Speed'),
        byte(state.brightness, 'Brightness'), byte(state.hue, 'Hue'), byte(state.saturation, 'Saturation')]));
  }
  public async getBadgeState(): Promise<BadgeState> {
    const data = await this.command(CommandID.MODULE_CMD_BADGE_GET, new Uint8Array());
    if (data[0] > 1) throw new Error('Invalid badge lighting state.');
    return {enabled: data[0] === 1, brightness: data[1], hue: data[2], saturation: data[3]};
  }
  public async setBadgeState(state: BadgeState): Promise<void> {
    await this.command(CommandID.MODULE_CMD_BADGE_SET,
      new Uint8Array([Number(state.enabled), byte(state.brightness, 'Brightness'),
        byte(state.hue, 'Hue'), byte(state.saturation, 'Saturation')]));
  }
  public async getBadgeAnimationState(): Promise<BadgeAnimationState> {
    const data = await this.command(CommandID.MODULE_CMD_BADGE_ANIMATION_GET, new Uint8Array());
    if (data[0] > 1 || data[4] >= BADGE_EFFECTS.length) throw new Error('Invalid badge animation state.');
    return {enabled: data[0] === 1, brightness: data[1], hue: data[2], saturation: data[3],
      effect: data[4], speed: data[5]};
  }
  public async setBadgeAnimationState(state: BadgeAnimationState): Promise<void> {
    await this.command(CommandID.MODULE_CMD_BADGE_ANIMATION_SET,
      new Uint8Array([Number(state.enabled), byte(state.brightness, 'Brightness'),
        byte(state.hue, 'Hue'), byte(state.saturation, 'Saturation'),
        byte(state.effect, 'Badge effect', BADGE_EFFECTS.length - 1), byte(state.speed, 'Speed')]));
  }
  public async getLedBrightness(index: number): Promise<number> {
    const data = await this.command(CommandID.MODULE_CMD_LED_GET, new Uint8Array([frontIndex(index)]));
    if (data[0] !== index) throw new Error('Board returned the wrong LED state.');
    return data[1];
  }

  /**
   * Sets the lighting color (Hue and Saturation).
   * @param hue The hue value (0-255).
   * @param saturation The saturation value (0-255).
   */
  public async setColor(hue: number, saturation: number): Promise<void> {
    const payload = new Uint8Array([byte(hue, 'Hue'), byte(saturation, 'Saturation')]);
    await this.command(CommandID.MODULE_CMD_SET_COLOR_HS, payload);
  }
  /**
   * Gets the entire current lighting state from the device.
   * @returns A promise that resolves to an object with the lighting state.
   */
  public async getLightingState(): Promise<{ effect: number; speed: number; brightness: number; hue: number; saturation: number; }> {
    const responseData = await this.command(CommandID.MODULE_CMD_GET_LIGHTING_STATE, new Uint8Array());
    if (responseData[0] > 9) throw new Error('Invalid underglow effect.');
    // Response payload is: [effect, speed, brightness, hue, sat]
    return {
      effect: responseData[0],
      speed: responseData[1],
      brightness: responseData[2],
      hue: responseData[3],
      saturation: responseData[4],
    };
  }
}
