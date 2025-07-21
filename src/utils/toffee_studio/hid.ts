import {Buffer} from 'buffer';
import {ToffeeCDC} from './cdc';

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
export class ToffeeHIDDevice {
  private packetId: number = 0;

  constructor(private webHidDevice: HIDDevice) {
    if (!webHidDevice) {
      throw new Error('ToffeeHIDDevice requires a valid HIDDevice object.');
    }
  }

  /**
   * Ensures the device connection is open before communication.
   * This should be called before any send/receive operations.
   */
  public async open(): Promise<void> {
    if (!this.webHidDevice.opened) {
      await this.webHidDevice.open();
    }
  }

  /**
   * Closes the device connection.
   */
  public async close(): Promise<void> {
    if (this.webHidDevice.opened) {
      await this.webHidDevice.close();
    }
  }

  /**
   * Sends a structured packet to the device.
   */
  private async sendPacket(
    commandId: CommandID,
    data: Uint8Array = new Uint8Array(),
  ): Promise<void> {
    const buffer = new ArrayBuffer(PACKET_SIZE);
    const view = new DataView(buffer);
    const packet = new Uint8Array(buffer);

    // Build header
    view.setUint8(0, MAGIC_BYTE);
    view.setUint8(1, commandId);
    view.setUint32(2, this.packetId, true); // true for little-endian

    // Copy data payload
    packet.set(data, HEADER_SIZE);

    console.log(
      `Sending packet ${this.packetId} (CMD: 0x${commandId.toString(
        16,
      )}):`,
      Buffer.from(packet).toString('hex'),
    );
    await this.webHidDevice.sendReport(0, packet);
    this.packetId++;
  }

  /**
   * Waits for and receives a single packet from the device.
   */
  private receivePacket(timeoutMs: number = 1500): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        // Cleanup listener before rejecting
        this.webHidDevice.removeEventListener('inputreport', listener);
        reject(new Error(`HID read timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      const listener = (event: HIDInputReportEvent) => {
        // Ensure the report is from the correct device and is not empty
        if (event.device === this.webHidDevice && event.data.byteLength > 0) {
          clearTimeout(timeout);
          this.webHidDevice.removeEventListener('inputreport', listener);
          const responseData = new Uint8Array(event.data.buffer);
          console.log(
            'Received response:',
            Buffer.from(responseData).toString('hex'),
          );
          resolve(responseData);
        }
      };

      this.webHidDevice.addEventListener('inputreport', listener);
    });
  }
  /**
   * Sends a packet without waiting for a response. Useful for trigger commands.
   */
  public async sendPacketOnly(commandId: CommandID, data?: Uint8Array): Promise<void> {
    // This is a public wrapper for the private sendPacket method
    await this.sendPacket(commandId, data);
  }

  /**
   * Executes a command by sending a packet and waiting for a response.
   */
  public async executeCommand(
    commandId: CommandID,
    data?: Uint8Array,
  ): Promise<[ReturnCode, Uint8Array]> {
    await this.sendPacket(commandId, data);
    try {
      const response = await this.receivePacket();
      const status = response[0] as ReturnCode;
      const responseData = response.slice(1);
      return [status, responseData];
    } catch (e) {
      console.error(`Error executing command 0x${commandId.toString(16)}:`, e);
      return [ReturnCode.INVALID_COMMAND, new Uint8Array()];
    }
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
export class ToffeeLightingAPI {
  constructor(private hid: ToffeeHIDDevice) {}

  /**
   * Sets the lighting animation effect.
   * @param effectId The ID of the animation (0-9).
   */
  public async setAnimation(effectId: number): Promise<void> {
    const payload = new Uint8Array([effectId]);
    // Changed to executeCommand to wait for a response, creating a natural delay.
    await this.hid.executeCommand(CommandID.MODULE_CMD_SET_ANIMATION, payload);
  }

  /**
   * Sets the lighting animation speed.
   * @param speed The speed value (0-255).
   */
  public async setSpeed(speed: number): Promise<void> {
    const payload = new Uint8Array([speed]);
    // Changed to executeCommand to wait for a response.
    await this.hid.executeCommand(CommandID.MODULE_CMD_SET_SPEED, payload);
  }

  /**
   * Sets the lighting brightness.
   * @param brightness The brightness value (0-255).
   */
  public async setBrightness(brightness: number): Promise<void> {
    const payload = new Uint8Array([brightness]);
    // Changed to executeCommand to wait for a response.
    await this.hid.executeCommand(CommandID.MODULE_CMD_SET_BRIGHTNESS, payload);
  }

  /**
   * Sets the lighting color (Hue and Saturation).
   * @param hue The hue value (0-255).
   * @param saturation The saturation value (0-255).
   */
  public async setColor(hue: number, saturation: number): Promise<void> {
    const payload = new Uint8Array([hue, saturation]);
    // Changed to executeCommand to wait for a response.
    await this.hid.executeCommand(CommandID.MODULE_CMD_SET_COLOR_HS, payload);
  }
  /**
   * Gets the entire current lighting state from the device.
   * @returns A promise that resolves to an object with the lighting state.
   */
  public async getLightingState(): Promise<{ effect: number; speed: number; brightness: number; hue: number; saturation: number; }> {
    const [status, responseData] = await this.hid.executeCommand(CommandID.MODULE_CMD_GET_LIGHTING_STATE);
    console.log(`[ToffeeLightingAPI] Raw Response for GET_LIGHTING_STATE - Status: 0x${status.toString(16)}, Data:`, responseData);
    if (status !== ReturnCode.SUCCESS || responseData.length < 5) {
      throw new Error(`Failed to get lighting state. Status: ${status}`);
    }
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
