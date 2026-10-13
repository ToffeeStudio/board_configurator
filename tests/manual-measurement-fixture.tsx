// Render the actual page against a fake transport; never enumerate real USB.
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ManualMeasurement} from '../src/components/toffee_studio/manual-measurement';
import {ToffeeHIDDevice} from '../src/utils/toffee_studio/hid';
import {allOff} from '../src/utils/toffee_studio/manual-measurement';
import {ManualHIDFixture} from './manual-hid-fixture';
const device=new ManualHIDFixture(), events=new EventTarget();
Object.defineProperty(navigator,'hid',{value:events,configurable:true});
Object.assign(window,{manualFixture:device,disabledWrite:()=>allOff(new ToffeeHIDDevice(device as unknown as HIDDevice)),
  disconnectFixture:()=>{const event=new Event('disconnect');Object.assign(event,{device});events.dispatchEvent(event);}});
function Fixture() {
  const [connected,setConnected]=useState(true);
  return <div style={{height:'100vh',display:'flex',flexDirection:'column'}}><p style={{padding:'0 28px'}}>OFFLINE SIMULATED DEVICE — no PCB access</p>
    <ManualMeasurement device={connected ? device as unknown as HIDDevice : null} onConnect={()=>setConnected(v=>!v)}/></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
