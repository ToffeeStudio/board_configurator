import {FirmwareFakeUSB} from '../../../tests/firmware-fake-usb';

export const ROM_SERIAL = 'TOFFEEVMROM1';
export const ROM_DEVICE = Buffer.from('12011001000000408a2e0300000101020301', 'hex');
export const ROM_CONFIG = Buffer.from([
  9, 2, 55, 0, 2, 1, 0, 0x80, 250,
  9, 4, 0, 0, 2, 8, 6, 0x50, 0,
  7, 5, 0x81, 2, 64, 0, 0, 7, 5, 2, 2, 64, 0, 0,
  9, 4, 1, 0, 2, 0xff, 0, 0, 0,
  7, 5, 3, 2, 64, 0, 0, 7, 5, 0x84, 2, 64, 0, 0,
]);

// Enumerate the ROM's MSC interface as a removable drive without media.
// The vendor interface carries the simulated flash and never accesses a host drive.
export class VirtualRp2 {
  readonly flash: FirmwareFakeUSB;
  private scsiData: Buffer | null = null;
  private scsiStatus: Buffer | null = null;

  constructor(reboot: () => void) {
    this.flash = new FirmwareFakeUSB(reboot);
  }

  resetDrive() {
    this.scsiData = null;
    this.scsiStatus = null;
  }

  writeDrive(packet: Buffer) {
    if (packet.length !== 31 || packet.readUInt32LE(0) !== 0x43425355) return false;
    const length = packet.readUInt32LE(8);
    const command = packet[15];
    let data = Buffer.alloc(0);
    if (command === 0x12) {
      data = Buffer.alloc(36);
      data.set([0, 0x80, 5, 2, 31]);
      data.write('Toffee  ', 8);
      data.write('Virtual RP2     ', 16);
      data.write('1.00', 32);
    } else if (command === 0x03) {
      data = Buffer.from([0x70, 0, 2, 0, 0, 0, 0, 10, 0, 0, 0, 0, 0x3a, 0, 0, 0, 0, 0]);
    }
    data = data.subarray(0, length);
    this.scsiData = length ? data : null;
    this.scsiStatus = Buffer.alloc(13);
    this.scsiStatus.writeUInt32LE(0x53425355);
    this.scsiStatus.writeUInt32LE(packet.readUInt32LE(4), 4);
    this.scsiStatus.writeUInt32LE(length - data.length, 8);
    this.scsiStatus[12] = command === 0x12 || command === 0x03 ? 0 : 1;
    return true;
  }

  readDrive(length: number) {
    if (this.scsiData !== null) {
      const data = this.scsiData.subarray(0, length);
      this.scsiData = null;
      return data;
    }
    const status = this.scsiStatus?.subarray(0, length);
    this.scsiStatus = null;
    return status;
  }
}
