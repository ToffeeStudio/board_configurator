// Real menus and Redux selection, explicitly simulated HID only.
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Provider} from 'react-redux';
import {store} from '../src/store';
import {selectDevice} from '../src/store/devicesSlice';
import {HID} from '../src/shims/node-hid';
import {GroupLightingMenu} from '../src/components/toffee_studio/group-lighting-menu';
class Device extends EventTarget {
  vendorId = 0x1067; productId = 0x626d; productName = 'OFFLINE SIMULATED MODULE';
  collections = [{usagePage:0xff60,usage:0x61}];
  opened = false; version = 3; reject = false; pending = 0; maximumPending = 0;
  front = [1,100,18,40,255]; badge = [1,18,40,255,1,100]; packets: number[][] = [];
  async open() {this.opened = true;}
  async sendReport(report: number, packet: Uint8Array) {
    if (report !== 0 || !this.opened) throw new Error('Invalid simulated HID transaction.');
    this.maximumPending = Math.max(this.maximumPending, ++this.pending);
    this.packets.push([...packet]);
    try {
      await new Promise(resolve => setTimeout(resolve, 5));
      const reply = new Uint8Array(32);
      if (this.reject) reply[0] = 0xef;
      else switch (packet[1]) {
        case 0x85: reply.set(this.version === 3 ? [3,66,22,16,104,45,6] : [2,66,22,16,104,9],1); break;
        case 0x80: reply.set(this.front,1); break;
        case 0x81: this.front = [...packet.slice(6,11)]; break;
        case 0x82: reply.set(this.badge.slice(0,4),1); break;
        case 0x83: this.badge = [...packet.slice(6,10),1,100]; break;
        case 0x8d:
          if (this.version !== 3) throw new Error('Legacy board received animated badge read.');
          reply.set(this.badge,1); break;
        case 0x8e:
          if (this.version !== 3) throw new Error('Legacy board received animated badge write.');
          this.badge = [...packet.slice(6,12)]; break;
        default: throw new Error('Forbidden offline HID command ' + packet[1]);
      }
      reply[26] = 0xa5; reply[27] = packet[1]; reply.set(packet.slice(2,6),28);
      const event = new Event('inputreport');
      Object.assign(event,{device:this,data:new DataView(reply.buffer)});
      this.dispatchEvent(event);
    } finally {this.pending--;}
  }
}
const device = new Device();
Object.defineProperty(navigator,'hid',{configurable:true,value:{
  getDevices:async()=>[device],requestDevice:async()=>{throw new Error('No hardware allowed.');},
  addEventListener(){},removeEventListener(){},
}});
Object.assign(window,{groupFixture:device});
const [selected] = await HID.devices();
store.dispatch(selectDevice(selected as any));
function Fixture() {
  const [revision,setRevision] = useState(0);
  return <Provider store={store}><h1>SIMULATED lighting menus — no physical USB</h1>
    <button onClick={()=>setRevision(n=>n+1)}>Reload menus</button>
    <section aria-label="Front panel" key={'front'+revision}><h2>Front</h2><GroupLightingMenu group="front"/></section>
    <section aria-label="Badge panel" key={'badge'+revision}><h2>Badge</h2><GroupLightingMenu group="badge"/></section>
  </Provider>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
