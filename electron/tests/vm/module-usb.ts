// USB redirection fixture for a disposable QEMU guest. Uses no host USB APIs.
// Protocol: https://www.spice-space.org/usbredir.html
import {createServer, type Socket} from 'node:net';
import {ROM_CONFIG, ROM_DEVICE, ROM_SERIAL, VirtualRp2} from './virtual-rp2';
import {FirmwareFakeDevice} from '../../../tests/firmware-fake-device';

enum Message {
  Hello = 0, Connect = 1, Disconnect = 2, Reset = 3, Interfaces = 4, Endpoints = 5,
  SetConfiguration = 6, GetConfiguration = 7, Configuration = 8,
  SetAlternate = 9, GetAlternate = 10, Alternate = 11,
  StartInterrupt = 15, StopInterrupt = 16, InterruptStatus = 17,
  Cancel = 21, Control = 100, Bulk = 101, Interrupt = 103,
}

const DEVICE = Buffer.from('120100020000004067106d62000101020301', 'hex');
// Vendor page 0xff60, usage 0x61. 32-byte input/output reports with no report ID.
const REPORT = Buffer.from('0660ff0961a1010962150026ff007508952081020963150026ff00750895209102c0', 'hex');
const HID = Buffer.from([9, 0x21, 0x11, 0x01, 0, 1, 0x22, REPORT.length, 0]);
const CONFIG = Buffer.concat([
  Buffer.from([9, 2, 41, 0, 1, 1, 0, 0x80, 250]),
  Buffer.from([9, 4, 0, 0, 2, 3, 0, 0, 0]),
  HID,
  Buffer.from([7, 5, 0x81, 3, 32, 0, 1, 7, 5, 0x01, 3, 32, 0, 1]),
]);
const STRINGS = ['', 'Toffee Studio test fixture', 'Toffee Module (simulated)', 'TOFFEEVM0001'];

const CAP_DEVICE_VERSION = 1 << 1;
const CAP_PACKET_SIZE = 1 << 4;
const CAP_ID64 = 1 << 5;
const CAP_BULK_LENGTH = 1 << 6;
const CAPS = CAP_DEVICE_VERSION | CAP_PACKET_SIZE | CAP_ID64 | CAP_BULK_LENGTH;
const SUCCESS = 0;
const INVALID = 2;
const STALL = 4;
const SAFE_MA = 450;
const MAX_MA = 940;
const LEASE_MS = 5000;
const BOARD_ID = Buffer.from('11223344556677880000000000000000', 'hex');

class VirtualModule extends FirmwareFakeDevice {
  profile = 16;
  boardLimitMa = SAFE_MA;
  private renewed = 0;

  resetBudget() {
    this.boardLimitMa = SAFE_MA;
  }

  async sendReport(id: number, packet: Uint8Array) {
    if (performance.now() - this.renewed >= LEASE_MS) this.resetBudget();
    if (packet[0] !== 9 || packet[1] !== 0x8f) return super.sendReport(id, packet);

    const opcode = packet[6];
    const requested = packet[7] | (packet[8] << 8);
    const matches = BOARD_ID.every((byte, index) => packet[9 + index] === byte);
    const valid = opcode === 0 || opcode === 1 && matches && requested >= SAFE_MA && requested <= MAX_MA;
    if (valid && opcode === 1) {
      this.boardLimitMa = requested;
      this.renewed = performance.now();
    }
    const reply = new Uint8Array(32);
    reply[0] = valid ? SUCCESS : 0xef;
    const view = new DataView(reply.buffer);
    if (valid) {
      reply[1] = 1;
      view.setUint16(2, this.boardLimitMa, true);
      view.setUint16(4, MAX_MA, true);
      reply.set(BOARD_ID, 6);
    }
    reply.set([0xa5, 0x8f, ...packet.slice(2, 6)], 26);
    this.dispatchEvent(Object.assign(new Event('inputreport'), {device: this, data: view}));
  }
}

function descriptor(value: number, rom: boolean): Buffer | undefined {
  const type = value >> 8, index = value & 255;
  if (type === 1 && index === 0) return rom ? ROM_DEVICE : DEVICE;
  if (type === 2 && index === 0) return rom ? ROM_CONFIG : CONFIG;
  if (!rom && type === 0x21 && index === 0) return HID;
  if (!rom && type === 0x22 && index === 0) return REPORT;
  if (type === 3 && index < STRINGS.length) {
    if (index === 0) return Buffer.from([4, 3, 9, 4]);
    const romStrings = ['', 'Toffee Studio test fixture', 'RP2 Boot', ROM_SERIAL];
    const utf16 = Buffer.from((rom ? romStrings : STRINGS)[index], 'utf16le');
    return Buffer.concat([Buffer.from([2 + utf16.length, 3]), utf16]);
  }
}

async function serveModule(socket: Socket, shortRomRead: boolean) {
  const module = new VirtualModule();
  let rom = false, reboot = false;
  const rp2 = new VirtualRp2(() => { reboot = true; });
  rp2.flash.shortRead = shortRomRead;
  let peerCaps = 0, negotiated = false, pending = Buffer.alloc(0), configuration = 0;
  let interrupt = false, inputId = 0n;
  const replies: Buffer[] = [];

  function send(type: Message, data: Buffer, id = 0n) {
    const wide = Boolean(peerCaps & CAP_ID64);
    const header = Buffer.alloc(wide ? 16 : 12);
    header.writeUInt32LE(type, 0);
    header.writeUInt32LE(data.length, 4);
    if (wide) header.writeBigUInt64LE(id, 8);
    else header.writeUInt32LE(Number(id), 8);
    socket.write(Buffer.concat([header, data]));
  }

  function reportHeader(endpoint: number, status: number, length: number) {
    const header = Buffer.from([endpoint, status, 0, 0]);
    header.writeUInt16LE(length, 2);
    return header;
  }

  function flushReports() {
    if (!interrupt) return;
    for (const report of replies.splice(0)) {
      send(Message.Interrupt, Buffer.concat([reportHeader(0x81, SUCCESS, report.length), report]), inputId++);
    }
  }

  module.addEventListener('inputreport', event => {
    const data = (event as Event & {data: DataView}).data;
    if (replies.length === 8) replies.shift();
    replies.push(Buffer.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)));
  });

  const hello = Buffer.alloc(68);
  hello.write('Toffee Module HID lab fixture');
  hello.writeUInt32LE(CAPS, 64);
  send(Message.Hello, hello);

  function advertise() {
    const endpoints = Buffer.alloc(peerCaps & CAP_PACKET_SIZE ? 160 : 96);
    endpoints.fill(255, 0, 32);
    for (const index of [0, 16]) {
      endpoints[index] = 0;
      if (peerCaps & CAP_PACKET_SIZE) endpoints.writeUInt16LE(64, 96 + index * 2);
    }
    const epList = rom ? [[2, 2, 0], [17, 2, 0], [3, 2, 1], [20, 2, 1]] :
      [[1, 3, 0], [17, 3, 0]];
    for (const [index, kind, iface] of epList) {
      endpoints[index] = kind;
      endpoints[32 + index] = kind === 3 ? 1 : 0;
      endpoints[64 + index] = iface;
      if (peerCaps & CAP_PACKET_SIZE) endpoints.writeUInt16LE(kind === 3 ? 32 : 64, 96 + index * 2);
    }
    const interfaces = Buffer.alloc(132);
    interfaces.writeUInt32LE(rom ? 2 : 1);
    interfaces[36] = rom ? 8 : 3;
    if (rom) {
      interfaces[5] = 1;
      interfaces[37] = 0xff;
      interfaces[68] = 6;
      interfaces[100] = 0x50;
    }
    send(Message.Endpoints, endpoints);
    send(Message.Interfaces, interfaces);
  }

  function connect() {
    advertise();
    const ids = (rom ? ROM_DEVICE : DEVICE).subarray(8, 14);
    const device = Buffer.concat([Buffer.from([1, 0, 0, 0]), ids]);
    send(Message.Connect, device.subarray(0, peerCaps & CAP_DEVICE_VERSION ? 10 : 8));
  }

  function changeMode(next: boolean) {
    send(Message.Disconnect, Buffer.alloc(0));
    rom = next;
    module.booted = next;
    module.resetBudget();
    rp2.resetDrive();
    configuration = 0;
    interrupt = false;
    replies.length = 0;
    connect();
  }

  async function handleBulk(id: bigint, data: Buffer) {
    const wide = Boolean(peerCaps & CAP_BULK_LENGTH);
    const header = Buffer.from(data.subarray(0, wide ? 10 : 8));
    const endpoint = header[0], directionIn = Boolean(endpoint & 0x80);
    const length = header.readUInt16LE(2) + (wide ? header.readUInt16LE(8) * 65536 : 0);
    let payload: Uint8Array | undefined;
    let written = 0;
    if (rom && length <= 8192) {
      if (endpoint === 0x84) {
        const reply = await rp2.flash.transferIn(4, length);
        payload = new Uint8Array(reply.data.buffer, reply.data.byteOffset, reply.data.byteLength);
      } else if (endpoint === 3 && data.length === header.length + length) {
        const reply = await rp2.flash.transferOut(3, Uint8Array.from(data.subarray(header.length)));
        written = reply.bytesWritten;
      } else if (endpoint === 0x81) {
        payload = rp2.readDrive(length);
      } else if (endpoint === 2 && rp2.writeDrive(data.subarray(header.length))) {
        written = length;
      }
    }
    const success = directionIn ? payload !== undefined : written === length;
    header[1] = success ? SUCCESS : STALL;
    header.writeUInt16LE(directionIn ? payload?.length ?? 0 : written, 2);
    if (wide) header.writeUInt16LE(0, 8);
    send(Message.Bulk, payload ? Buffer.concat([header, payload]) : header, id);
    if (reboot) {
      reboot = false;
      changeMode(false);
    }
  }

  async function handle(type: Message, id: bigint, data: Buffer) {
    if (type === Message.Hello) {
      if (negotiated || data.length < 64) throw new Error('Unexpected usbredir hello.');
      peerCaps = data.length >= 68 ? data.readUInt32LE(64) & CAPS : 0;
      negotiated = true;
      connect();
      return;
    }
    if (!negotiated) throw new Error('USB redirection negotiation is required.');
    if (type === Message.Reset) {
      configuration = 0;
      module.resetBudget();
      interrupt = false;
      inputId = 0n;
      replies.length = 0;
      return;
    }
    if (type === Message.SetConfiguration || type === Message.GetConfiguration) {
      const requested = type === Message.SetConfiguration ? data[0] : configuration;
      const status = requested === 0 || requested === 1 ? SUCCESS : INVALID;
      if (status === SUCCESS && type === Message.SetConfiguration) {
        configuration = requested;
        advertise();
      }
      send(Message.Configuration, Buffer.from([status, configuration]), id);
      return;
    }
    if (type === Message.SetAlternate || type === Message.GetAlternate) {
      const status = (data[0] === 0 || rom && data[0] === 1) && (type === Message.GetAlternate || data[1] === 0) ? SUCCESS : INVALID;
      if (status === SUCCESS && type === Message.SetAlternate) advertise();
      send(Message.Alternate, Buffer.from([status, data[0], 0]), id);
      return;
    }
    if (type === Message.StartInterrupt || type === Message.StopInterrupt) {
      const endpoint = data[0];
      if (type === Message.StartInterrupt) {
        interrupt = endpoint === 0x81;
        inputId = 0n;
        send(Message.InterruptStatus, Buffer.from([interrupt ? SUCCESS : INVALID, endpoint]), id);
        flushReports();
      } else if (endpoint === 0x81) {
        interrupt = false;
      }
      return;
    }
    if (type === Message.Bulk) {
      await handleBulk(id, data);
      return;
    }
    if (type === Message.Interrupt) {
      const length = data.readUInt16LE(2);
      const status = data[0] === 1 && length === 32 && data.length === 36 ? SUCCESS : INVALID;
      if (status === SUCCESS) await module.sendReport(0, Uint8Array.from(data.subarray(4)));
      send(Message.Interrupt, reportHeader(data[0], status, status === SUCCESS ? length : 0), id);
      flushReports();
      if (module.booted && !rom) changeMode(true);
      return;
    }
    if (type === Message.Control) {
      const header = Buffer.from(data.subarray(0, 10));
      const request = header[1], requestType = header[2];
      const directionIn = Boolean(requestType & 0x80);
      const length = header.readUInt16LE(8), value = header.readUInt16LE(4);
      let reply: Buffer | undefined;
      if (request === 6 && (requestType === 0x80 || requestType === 0x81)) {
        reply = descriptor(value, rom);
      } else if (request === 0 && [0x80, 0x81, 0x82].includes(requestType)) {
        reply = Buffer.alloc(2);
      } else if (rom && requestType === 0xa1 && request === 0xfe) {
        reply = Buffer.from([0]); // One MSC LUN.
      } else if (rom && requestType === 0x21 && request === 0xff) {
        rp2.resetDrive();
        reply = Buffer.alloc(0);
      } else if (rom && requestType === 0x41 && request === 0x41) {
        await rp2.flash.controlTransferOut();
        reply = Buffer.alloc(0);
      } else if (rom && requestType === 0xc1 && request === 0x42) {
        const result = await rp2.flash.controlTransferIn();
        reply = Buffer.from(result.data.buffer, result.data.byteOffset, result.data.byteLength);
      } else if (requestType === 2 && request === 1 && length === 0) {
        reply = Buffer.alloc(0); // CLEAR_FEATURE(ENDPOINT_HALT).
      } else if (!rom && request === 0x0a && requestType === 0x21 && length === 0) {
        reply = Buffer.alloc(0);
      } else if (!rom && request === 9 && requestType === 0x21 && value === 0x0200 && length === 32 && data.length === 42) {
        await module.sendReport(0, Uint8Array.from(data.subarray(10)));
        reply = Buffer.alloc(0);
      }
      header[3] = reply ? SUCCESS : STALL;
      const payload = directionIn ? reply?.subarray(0, length) ?? Buffer.alloc(0) : Buffer.alloc(0);
      header.writeUInt16LE(reply ? directionIn ? payload.length : length : 0, 8);
      send(Message.Control, Buffer.concat([header, payload]), id);
      flushReports();
      if (module.booted && !rom) changeMode(true);
      return;
    }
    if (type !== Message.Cancel) throw new Error('Unsupported usbredir message: ' + type);
  }

  for await (const chunk of socket) {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 12) {
      const width = peerCaps & CAP_ID64 ? 16 : 12;
      const length = pending.readUInt32LE(4);
      if (length > 8208) throw new Error('Oversized usbredir message.');
      if (pending.length < width + length) break;
      const type = pending.readUInt32LE(0) as Message;
      const id = width === 16 ? pending.readBigUInt64LE(8) : BigInt(pending.readUInt32LE(8));
      const data = pending.subarray(width, width + length);
      pending = pending.subarray(width + length);
      await handle(type, id, data);
    }
  }
}

if (import.meta.main) {
  const [path, fault, ...rest] = process.argv.slice(2);
  if (!path || fault && fault !== '--short-rom-read' || rest.length) {
    throw new Error('Usage: bun module-usb.ts <private Unix socket path> [--short-rom-read]');
  }
  process.umask(0o077);
  const server = createServer(socket => {
    void serveModule(socket, fault === '--short-rom-read').catch(error => {
      console.error('Virtual Module:', error.message);
      socket.destroy();
    });
  });
  server.maxConnections = 1;
  server.listen(path, () => console.info('Virtual Module listening on', path));
  process.on('SIGINT', () => server.close());
}
