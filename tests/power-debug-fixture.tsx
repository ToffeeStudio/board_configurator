// Test-only fake device. No native HID enumeration, USB access or firmware writes.
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Provider} from 'react-redux';
import {store} from '../src/store';
import {PowerDebug} from '../src/components/toffee_studio/power-debug';
import GlowRange from '../src/components/toffee_studio/GlowRange/GlowRange';
import {ToffeeHIDDevice, ToffeeLightingAPI} from '../src/utils/toffee_studio/hid';

class FixtureDevice extends EventTarget {
  opened = false;
  level = 0;
  reads = 0;
  writes = 0;
  maximumPending = 0;
  pending = 0;
  delay = 0;
  reject = false;
  unconfigured = false;
  manual = false;
  currentUnlimited = false;
  schema = 2;
  frontBadgeMax = 190;
  stale = false;
  frame = 0;
  async open() {this.opened = true;}
  async sendReport(reportId: number, data: Uint8Array) {
    if (reportId !== 0) throw new Error('Unexpected report ID.');
    this.maximumPending = Math.max(this.maximumPending, ++this.pending);
    const packet = data.slice();
    try {
      if (this.delay) await new Promise(resolve => setTimeout(resolve, this.delay));
      const reply = new Uint8Array(32);
      if (packet[1] === 0x74) {
        this.writes++;
        this.level = packet[6];
      } else if (packet[1] === 0x88) {
        this.reads++;
        reply[0] = this.reject ? 0xef : 0;
        const requested = this.level * 3;
        const effective = this.unconfigured ? 0 : this.manual || this.currentUnlimited ? requested : Math.min(225, requested);
        reply[1] = this.manual ? 1 : this.schema;
        reply[25] = reply[1] === 2 ? this.frontBadgeMax : 0;
        reply[2] = (this.unconfigured ? 0 : 1) | (effective < requested ? 2 : 0) | 4 | 16 | (this.manual ? 32 : this.currentUnlimited ? 64 : 0);
        const scale = this.unconfigured ? 0 : this.manual || this.currentUnlimited ? 1000 : requested ? Math.min(1000, Math.floor(225000 / requested)) : 1000;
        const fields = [this.manual ? 0x8006 : this.currentUnlimited ? 14 : 42, ++this.frame, this.stale ? 3000 : 0, this.unconfigured ? 0 : 350,
          90, 35, requested, effective, scale, 1000, this.unconfigured ? 0 : 225];
        const view = new DataView(reply.buffer);
        fields.forEach((value, index) => view.setUint16(3 + index * 2, value, true));
      } else throw new Error(`Forbidden fixture command: ${packet[1]}`);
      reply[26] = 0xa5; reply[27] = packet[1]; reply.set(packet.slice(2, 6), 28);
      const event = new Event('inputreport');
      Object.assign(event, {device: this, reportId: 0, data: new DataView(reply.buffer)});
      this.dispatchEvent(event);
    } finally {this.pending--;}
  }
}
const device = new FixtureDevice();
const hidEvents = new EventTarget();
Object.defineProperty(navigator, 'hid', {value: hidEvents, configurable: true});
const api = new ToffeeLightingAPI(new ToffeeHIDDevice(device as unknown as HIDDevice));
Object.assign(window, {powerFixture: device, disconnectFixture: () => {
  const event = new Event('disconnect'); Object.assign(event, {device}); hidEvents.dispatchEvent(event);
}});
function Fixture() {
  const [brightness, setBrightness] = useState(0);
  const [connected, setConnected] = useState(true);
  return <main style={{maxWidth: 1000, margin: '0 auto'}}>
    <h1>Offline Debug UI test</h1>
    <p>SIMULATED DEVICE AND BUDGET — not connected to the PCB.</p>
    <PowerDebug device={connected ? device as unknown as HIDDevice : null}/>
    <div style={{padding: 16}}>
      <label>Actual configurator slider · {brightness}</label>
      <GlowRange aria-label="Fixture brightness" min={0} max={255} value={brightness}
        onChange={value => {setBrightness(value); void api.setBrightness(value);}}/>
      <button onClick={() => setConnected(value => !value)}>Toggle selected device</button>
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Provider store={store}><Fixture/></Provider>);
