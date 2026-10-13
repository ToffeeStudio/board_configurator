import {describe, expect, test} from 'bun:test';
import {CommandID, ToffeeHIDDevice, ToffeeLightingAPI} from '../src/utils/toffee_studio/hid';
import lightingMap from '../src/utils/toffee_studio/lighting-map.json';
import {HID} from '../src/shims/node-hid';

class MockHID extends EventTarget {
  opened = false;
  openCount = 0;
  listenerCount = 0;
  packets: Uint8Array[] = [];

  constructor(public onSend: (packet: Uint8Array) => Promise<void>) {
    super();
  }

  async open() {
    this.opened = true;
    this.openCount++;
  }

  async sendReport(reportId: number, packet: Uint8Array) {
    expect(this.opened).toBe(true);
    expect(reportId).toBe(0);
    this.packets.push(packet.slice());
    await this.onSend(packet);
  }

  addEventListener(type: string, listener: EventListener) {
    super.addEventListener(type, listener);
    this.listenerCount++;
  }

  removeEventListener(type: string, listener: EventListener) {
    super.removeEventListener(type, listener);
    this.listenerCount--;
  }

  reply(bytes: number[], offset = 0) {
    const reply = new Uint8Array(32);
    reply.set(bytes);
    const request = this.packets[this.packets.length - 1];
    reply[26] = 0xa5;
    reply[27] = request[1];
    reply.set(request.slice(2, 6), 28);
    this.rawReply(reply, offset);
  }

  rawReply(bytes: Uint8Array, offset = 0, device: EventTarget = this) {
    const buffer = new Uint8Array(offset + bytes.length + 2).fill(0xff);
    buffer.set(bytes, offset);
    const event = new Event('inputreport');
    Object.assign(event, {
      device,
      data: new DataView(buffer.buffer, offset, bytes.length),
    });
    this.dispatchEvent(event);
  }
}

const asHID = (device: MockHID) => device as unknown as HIDDevice;

function powerPayload(): Uint8Array {
  const data = new Uint8Array(25);
  data[0] = 1;
  data[1] = 1 | 2 | 4 | 16;
  const view = new DataView(data.buffer);
  // Synthetic profile, not an electrical rating for the real PCB.
  [42, 1234, 15, 350, 90, 35, 900, 220, 250, 1000, 225]
    .forEach((value, index) => view.setUint16(2 + index * 2, value, true));
  return data;
}

describe('Module power telemetry', () => {
  test('reads firmware v2 output range without assuming a hard-coded cap', async () => {
    for (const maximum of [0, 120, 200, 255]) {
      const payload = powerPayload(); payload[0] = 2; payload[24] = maximum;
      const device = new MockHID(async () => device.reply([0, ...payload]));
      const value = await new ToffeeLightingAPI(new ToffeeHIDDevice(asHID(device))).getPowerStatus();
      expect(value.frontBadgeMax).toBe(maximum);
      expect(device.packets.map(packet => packet[1])).toEqual([0x88]);
    }
  });
  test('decodes versioned firmware status with offsets and no lighting write', async () => {
    const device = new MockHID(async () => device.reply([0, ...powerPayload()], 5));
    const api = new ToffeeLightingAPI(new ToffeeHIDDevice(asHID(device)));
    expect(await api.getPowerStatus()).toEqual({frontBadgeMax: null, manualMeasurement: false, currentUnlimited: false, configured: true, limited: true, usbConfigured: true,
      startupActive: false, frameValid: true, modelRevision: 42, frame: 1234, ageMs: 15,
      boardLimitMa: 350, baseMa: 90, marginMa: 35, requestedLedMa: 900,
      effectiveLedMa: 220, limitPermille: 250, startupPermille: 1000, ledBudgetMa: 225});
    expect(device.packets.map(packet => packet[1])).toEqual([0x88]);
    expect([...device.packets[0].slice(6)]).toEqual(Array(26).fill(0));
    expect(device.listenerCount).toBe(0);
  });
  test('old firmware is explicitly unsupported, then the shared queue can retry', async () => {
    const device = new MockHID(async () => device.reply([0xef]));
    const api = new ToffeeLightingAPI(new ToffeeHIDDevice(asHID(device)));
    await expect(api.getPowerStatus()).rejects.toThrow('budget-enabled firmware update');
    device.onSend = async () => device.reply([0, ...powerPayload()]);
    expect((await api.getPowerStatus()).configured).toBe(true);
    expect(device.listenerCount).toBe(0);
  });
  test('an explicit unconfigured profile is not invented into a usable budget', async () => {
    const payload = powerPayload(), view = new DataView(payload.buffer);
    payload[1] &= ~1;
    for (const offset of [8, 16, 18, 22]) view.setUint16(offset, 0, true);
    const device = new MockHID(async () => device.reply([0, ...payload]));
    const value = await new ToffeeLightingAPI(new ToffeeHIDDevice(asHID(device))).getPowerStatus();
    expect(value.configured).toBe(false);
    expect(value.ledBudgetMa).toBe(0);
    expect(value.effectiveLedMa).toBe(0);
    expect(value.requestedLedMa).toBe(900);
  });
  test('rejects unknown schema, reserved flags and inconsistent limits at the boundary', async () => {
    for (const mutate of [
      (p: Uint8Array) => {p[0] = 3;}, (p: Uint8Array) => {p[1] |= 128;},
      (p: Uint8Array) => {p[0] = 2; p[1] |= 32;},
      (p: Uint8Array) => {p[24] = 1;},
      (p: Uint8Array) => new DataView(p.buffer).setUint16(18, 1001, true),
      (p: Uint8Array) => new DataView(p.buffer).setUint16(20, 1001, true),
      (p: Uint8Array) => new DataView(p.buffer).setUint16(22, 100, true),
      (p: Uint8Array) => new DataView(p.buffer).setUint16(16, 226, true),
      (p: Uint8Array) => new DataView(p.buffer).setUint16(14, 100, true),
    ]) {
      const payload = powerPayload(); mutate(payload);
      const device = new MockHID(async () => device.reply([0, ...payload]));
      const api = new ToffeeLightingAPI(new ToffeeHIDDevice(asHID(device)));
      await expect(api.getPowerStatus()).rejects.toThrow('telemetry');
      expect(device.listenerCount).toBe(0);
    }
  });
  test('telemetry and slider writes share the existing non-overlapping queue', async () => {
    let pending = 0;
    const device = new MockHID(async packet => {
      expect(++pending).toBe(1);
      await Bun.sleep(1);
      device.reply(packet[1] === 0x88 ? [0, ...powerPayload()] : [0]);
      pending--;
    });
    const slider = new ToffeeLightingAPI(new ToffeeHIDDevice(asHID(device)));
    const debug = new ToffeeLightingAPI(new ToffeeHIDDevice(asHID(device)));
    await Promise.all([slider.setBrightness(18), debug.getPowerStatus(), slider.setBrightness(12), debug.getPowerStatus()]);
    expect(device.packets.map(packet => packet[1])).toEqual([0x74, 0x88, 0x74, 0x88]);
    expect(device.listenerCount).toBe(0);
  });
  test('manual firmware reports over-reference output honestly without implying enforcement', async () => {
    const payload = powerPayload(), view = new DataView(payload.buffer);
    payload[1] = 1 | 4 | 16 | 32;
    view.setUint16(2, 0x8006, true);
    view.setUint16(16, 900, true);
    view.setUint16(18, 1000, true);
    const device = new MockHID(async () => device.reply([0, ...payload]));
    const value = await new ToffeeLightingAPI(new ToffeeHIDDevice(asHID(device))).getPowerStatus();
    expect(value.manualMeasurement).toBe(true);
    expect(value.effectiveLedMa).toBe(900);
    expect(value.ledBudgetMa).toBe(225);
    expect(value.limited).toBe(false);
    expect(device.packets.map(packet => packet[1])).toEqual([0x88]);
    for (const mutate of [
      (p: Uint8Array) => {p[1] |= 2;},
      (p: Uint8Array) => new DataView(p.buffer).setUint16(18, 999, true),
      (p: Uint8Array) => new DataView(p.buffer).setUint16(2, 4, true),
    ]) {
      const bad = payload.slice(); mutate(bad);
      device.onSend = async () => device.reply([0, ...bad]);
      await expect(new ToffeeLightingAPI(new ToffeeHIDDevice(asHID(device))).getPowerStatus()).rejects.toThrow('telemetry');
    }
  });
});

describe('Module lighting HID', () => {
  test('opens the device and receives a reply arriving during sendReport', async () => {
    const device = new MockHID(async () => device.reply([0, 3, 100, 18, 170, 255]));
    const api = new ToffeeLightingAPI(new ToffeeHIDDevice(asHID(device)));
    expect(await api.getLightingState()).toEqual({
      effect: 3, speed: 100, brightness: 18, hue: 170, saturation: 255,
    });
    expect(device.openCount).toBe(1);
    expect(Array.from(device.packets[0].slice(0, 6))).toEqual([9, 0x76, 0, 0, 0, 0]);
    expect(device.listenerCount).toBe(0);
  });

  test('respects the input report DataView offset and length', async () => {
    const device = new MockHID(async () => device.reply([0, 2, 64, 18, 90, 200], 3));
    const api = new ToffeeLightingAPI(new ToffeeHIDDevice(asHID(device)));
    expect(await api.getLightingState()).toEqual({
      effect: 2, speed: 64, brightness: 18, hue: 90, saturation: 200,
    });
  });

  test('serializes rapid control changes with distinct packet IDs', async () => {
    let active = 0;
    let maximumActive = 0;
    const device = new MockHID(async () => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      await Bun.sleep(5);
      device.reply([0]);
      active--;
    });
    const api = new ToffeeLightingAPI(new ToffeeHIDDevice(asHID(device)));
    await Promise.all([api.setBrightness(18), api.setSpeed(110), api.setColor(90, 200)]);
    expect(maximumActive).toBe(1);
    expect(device.packets.map((packet) => packet[2])).toEqual([0, 1, 2]);
    expect(device.packets.map((packet) => Array.from(packet.slice(1, 2)))).toEqual([[0x74], [0x72], [0x75]]);
    expect(device.listenerCount).toBe(0);
  });

  test('reports firmware rejection for reads and every lighting setter', async () => {
    const device = new MockHID(async () => device.reply([0xef, ...Array(31).fill(0)]));
    const api = new ToffeeLightingAPI(new ToffeeHIDDevice(asHID(device)));
    for (const command of [
      () => api.getLightingState(), () => api.setAnimation(1),
      () => api.setSpeed(100), () => api.setBrightness(18),
      () => api.setColor(170, 255), () => api.setLedBrightness(0, 18),
    ]) {
      await expect(command()).rejects.toThrow('status 0xef');
    }
    expect(device.listenerCount).toBe(0);
  });

  test('rejects a truncated HID report', async () => {
    const device = new MockHID(async () => device.rawReply(new Uint8Array([0, 1])));
    const api = new ToffeeLightingAPI(new ToffeeHIDDevice(asHID(device)));
    await expect(api.getLightingState()).rejects.toThrow('incomplete HID report');
  });

  test('keeps a timeout distinct from a firmware rejection and removes its listener', async () => {
    const device = new MockHID(async () => {});
    const api = new ToffeeLightingAPI(new ToffeeHIDDevice(asHID(device)));
    await expect(api.getLightingState()).rejects.toThrow('HID read timed out');
    expect(device.listenerCount).toBe(0);
  });

  test('cleans up a failed send and permits a subsequent command', async () => {
    const device = new MockHID(async () => { throw new Error('Device disconnected'); });
    const hid = new ToffeeHIDDevice(asHID(device));
    await expect(hid.executeCommand(CommandID.MODULE_CMD_GET_LIGHTING_STATE)).rejects.toThrow('Device disconnected');
    expect(device.listenerCount).toBe(0);
    device.onSend = async () => device.reply([0, 0, 100, 18, 170, 255]);
    expect((await hid.executeCommand(CommandID.MODULE_CMD_GET_LIGHTING_STATE))[0]).toBe(0);
    expect(device.listenerCount).toBe(0);
  });

  test('ignores another device, standard VIA, stale packet IDs and wrong commands', async () => {
    const device = new MockHID(async packet => {
      device.rawReply(new Uint8Array(32), 0, new EventTarget());
      device.rawReply(new Uint8Array(32).fill(0x11));
      const reply = new Uint8Array(32);
      reply[26] = 0xa5;
      reply[27] = packet[1];
      new DataView(reply.buffer).setUint32(28, 999, true);
      device.rawReply(reply);
      reply.set(packet.slice(2, 6), 28);
      reply[27] = 0x82;
      device.rawReply(reply);
      device.reply([0, 4, 100, 18, 90, 200]);
    });
    const api = new ToffeeLightingAPI(new ToffeeHIDDevice(asHID(device)));
    expect((await api.getLightingState()).effect).toBe(4);
    expect(device.listenerCount).toBe(0);
  });

  test('shares one queue and packet sequence across independently constructed menus', async () => {
    let active = 0;
    const device = new MockHID(async () => {
      expect(++active).toBe(1);
      await Bun.sleep(1);
      device.reply([0]);
      active--;
    });
    const a = new ToffeeLightingAPI(new ToffeeHIDDevice(asHID(device)));
    const b = new ToffeeLightingAPI(new ToffeeHIDDevice(asHID(device)));
    await Promise.all(Array.from({length: 100}, (_, i) => (i % 2 ? a : b).setBrightness(i)));
    expect(device.packets.map(p => new DataView(p.buffer).getUint32(2, true)))
      .toEqual(Array.from({length: 100}, (_, i) => i));
    expect(device.openCount).toBe(1);
    expect(device.listenerCount).toBe(0);
  });

  test('checks the capability contract and group states', async () => {
    const device = new MockHID(async p => device.reply(p[1] === 0x85
      ? [0, 2, 66, 22, 16, 104, 9]
      : p[1] === 0x80 ? [0, 8, 255, 255, 255, 255] : [0, 1, 18, 170, 255]));
    const api = new ToffeeLightingAPI(new ToffeeHIDDevice(asHID(device)));
    await api.getCapabilities();
    expect(await api.getFrontState()).toEqual({effect: 8, speed: 255, brightness: 255, hue: 255, saturation: 255});
    expect(await api.getBadgeState()).toEqual({enabled: true, brightness: 18, hue: 170, saturation: 255});
    device.onSend = async () => device.reply([0, 1, 66, 22, 16, 104, 9]);
    await expect(api.getCapabilities()).rejects.toThrow('latest screenless');
    device.onSend = async () => device.reply([0, 9]);
    await expect(api.getFrontState()).rejects.toThrow('Invalid front');
    await expect(api.getBadgeState()).rejects.toThrow('Invalid badge');
    device.onSend = async () => device.reply([0, 10]);
    await expect(api.getLightingState()).rejects.toThrow('Invalid underglow');
  });

  test('encodes front and badge setters without changing the other group', async () => {
    const device = new MockHID(async () => device.reply([0]));
    const api = new ToffeeLightingAPI(new ToffeeHIDDevice(asHID(device)));
    await api.setFrontState({effect: 7, speed: 55, brightness: 19, hue: 66, saturation: 200});
    await api.setBadgeState({enabled: false, brightness: 23, hue: 33, saturation: 199});
    expect(Array.from(device.packets[0].slice(6, 11))).toEqual([7, 55, 19, 66, 200]);
    expect(Array.from(device.packets[1].slice(6, 10))).toEqual([0, 23, 33, 199]);
    expect(device.packets.map(p => p[1])).toEqual([0x81, 0x83]);
  });

  test('rejects invalid UI values before Uint8Array can silently wrap them', async () => {
    const device = new MockHID(async () => device.reply([0]));
    const api = new ToffeeLightingAPI(new ToffeeHIDDevice(asHID(device)));
    for (const value of [-1, 256, 1.5, NaN, Infinity]) {
      for (const command of [() => api.setBrightness(value), () => api.setSpeed(value),
        () => api.setColor(value, 255), () => api.setColor(0, value),
        () => api.setFrontState({effect: 1, speed: 100, brightness: value, hue: 0, saturation: 0}),
        () => api.setBadgeState({enabled: true, brightness: value, hue: 0, saturation: 0})])
        await expect(command()).rejects.toThrow('must be an integer');
    }
    await expect(api.setAnimation(10)).rejects.toThrow('Underglow effect');
    await expect(api.setFrontState({effect: 9, speed: 100, brightness: 18, hue: 0, saturation: 0}))
      .rejects.toThrow('Front effect');
    expect(device.packets.length).toBe(0);
  });

  test('only the verified 66 front packages can have per-key overrides', async () => {
    const device = new MockHID(async p => device.reply([0, p[6], 123]));
    const api = new ToffeeLightingAPI(new ToffeeHIDDevice(asHID(device)));
    for (const key of lightingMap.front) {
      await api.setLedBrightness(key.index, 0);
      expect(await api.getLedBrightness(key.index)).toBe(123);
    }
    for (const index of [1, 33, 65, 80, 104, 200, 255, -1, 1.5]) {
      await expect(api.getLedBrightness(index)).rejects.toThrow('regular front key');
      await expect(api.setLedBrightness(index, 18)).rejects.toThrow('regular front key');
    }
    device.onSend = async () => device.reply([0, 99, 123]);
    await expect(api.getLedBrightness(91)).rejects.toThrow('wrong LED state');
  });

  test('bounds transport payloads and recovers its queue after rejection', async () => {
    const device = new MockHID(async () => device.reply([0]));
    const hid = new ToffeeHIDDevice(asHID(device));
    await expect(hid.executeCommand(CommandID.MODULE_CMD_FRONT_SET, new Uint8Array(27)))
      .rejects.toThrow('exceeds 26');
    await hid.executeCommand(CommandID.MODULE_CMD_FRONT_SET, new Uint8Array(26));
    expect(device.packets.length).toBe(1);
    expect(device.packets[0][2]).toBe(1);
    expect(device.listenerCount).toBe(0);
  });

  test('VIA reader ignores a tagged lighting reply while its own read is pending', async () => {
    const device = new MockHID(async () => device.reply([0, 1, 100, 18, 0, 0]));
    HID._cache['mixed-traffic-test'] = { _device: asHID(device), vendorId: 0x1067,
      productId: 0x626d, interface: 1, path: 'mixed-traffic-test',
      productName: 'Module', usage: 0x61, usagePage: 0xff60};
    const via = new HID.HID('mixed-traffic-test');
    await via.openPromise;
    let resolved = false;
    const standard = via.readP().then(data => {resolved = true; return data;});
    const api = new ToffeeLightingAPI(new ToffeeHIDDevice(asHID(device)));
    expect((await api.getFrontState()).brightness).toBe(18);
    expect(resolved).toBe(false);
    const debug = new ToffeeHIDDevice(asHID(device));
    for (const command of [0x86, 0x88, 0x89, 0x8a, 0x8b, 0x8c]) {
      await debug.executeCommand(command as CommandID);
      expect(resolved).toBe(false);
    }
    const reply = new Uint8Array(32);
    reply.set([1, 0, 12]);
    device.rawReply(reply, 3);
    expect(Array.from((await standard).slice(0, 3))).toEqual([1, 0, 12]);
  });

  test('VIA retains a reply arriving before sendReport finishes, discarding only older traffic', async () => {
    const device = new MockHID(async () => {
      const response = new Uint8Array(32);
      response.set([1, 0, 12]);
      device.rawReply(response, 3);
      await Bun.sleep(5);
    });
    HID._cache['via-early-reply-test'] = {_device: asHID(device), vendorId: 0x1067,
      productId: 0x626d, interface: 1, path: 'via-early-reply-test',
      productName: 'Module', usage: 0x61, usagePage: 0xff60};
    const via = new HID.HID('via-early-reply-test');
    await via.openPromise;
    device.rawReply(new Uint8Array(32).fill(0x11));
    await Bun.sleep(5);
    await via.write([0, 1, ...Array(31).fill(0)]);
    const response = await Promise.race([via.readP(), Bun.sleep(50).then(() => null)]);
    expect(response).not.toBeNull();
    expect(Array.from(response!.slice(0, 3))).toEqual([1, 0, 12]);
  });
});
