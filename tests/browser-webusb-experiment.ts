// Explicit real hardware experiment. Run only with the intended single PCB.
import {chooseModule, fetchFirmware, FirmwareChoice, FirmwareConnection, ViaSettings, MODULE_FILTER, validateSettings} from '../src/utils/toffee_studio/firmware-update';
import {ToffeeHIDDevice, ToffeeLightingAPI} from '../src/utils/toffee_studio/hid';
import {DEBUG_ENABLED} from '../src/config/debug';
import {openPicoboot, uf2Payload, eraseImage} from '../src/utils/toffee_studio/picoboot';
if (!DEBUG_ENABLED) throw new Error('Debug disabled.');
const choice: FirmwareChoice = {id:'normal',name:'normal9',description:'Same normal firmware',file:'normal.uf2',sha256:'78d05883df9de9fcee88d9c216aa744be6ef1d4a55eeffbf2504b500f61f282b',profile:9,mode:'normal',testBuild:null};
const button = (id:string) => document.getElementById(id) as HTMLButtonElement;
const evidence:any = {events:[]};
let connection:FirmwareConnection, saved:ViaSettings, payload:Uint8Array, original:Uint8Array, picoboot:any;
let writeAttempted=false;
function log(stage:string, detail:unknown='') {
  evidence.events.push({at:new Date().toISOString(),stage,detail});
  document.getElementById('log')!.textContent=evidence.events.map((e:any)=>e.at+' '+e.stage+' '+JSON.stringify(e.detail)).join('\n');
  console.info('WebUSB experiment',stage,detail);
}
const digest=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
Object.assign(window,{webusbExperiment:{evidence,
  prepare,
  prepareBootloader,
  probe,
  archived(){if(!evidence.backup)throw new Error('Backup required');button('boot').disabled=false;},
  identityVerified(){button('probe').disabled=false;},
  readbackArchived(){if(!original)throw new Error('Original readback required');button('write').disabled=false;},
  original(){return Array.from(original);},
}});
log('capabilities',{webhid:!!navigator.hid,webusb:!!(navigator as any).usb,userAgent:navigator.userAgent});
async function prepare(device:HIDDevice){
  if(!device.opened)await device.open();
  connection=new FirmwareConnection(device);
  payload=uf2Payload(await fetchFirmware(choice));
  saved=await connection.readSettings();evidence.backup=saved;
  evidence.before=await new ToffeeLightingAPI(new ToffeeHIDDevice(device)).getPowerStatus();
  log('prepared',{payloadBytes:payload.length,sha256:choice.sha256,profile:9});
}
async function prepareBootloader(backup:ViaSettings){
  saved=validateSettings(backup);evidence.backup=saved;
  payload=uf2Payload(await fetchFirmware(choice));
  log('prepared-bootloader',{payloadBytes:payload.length,sha256:choice.sha256,profile:9});
}
async function probe(device:any){
  log('boot-device-selected',{serial:device.serialNumber,product:device.productName});
  picoboot=await openPicoboot(device);await picoboot.prepareRead();
  original=await picoboot.readImage(Math.ceil(payload.length/4096)*4096,(done:number,total:number)=>{
    if(done===total)log('read-complete',{done,total});
  });
  log('readback-ready',{bytes:original.length,sha256:await digest(original),imageMatches:payload.every((b,i)=>original[i]===b)});
}
button('connect').onclick=async()=>{
  button('connect').disabled=true;
  try{
    await prepare(await chooseModule());
  }catch(e){log('prepare-error',String(e));button('connect').disabled=false;}
};
button('boot').onclick=async()=>{
  button('boot').disabled=true;log('boot-request');
  try{await connection.enterBootloader();log('boot-request-sent');}
  catch(e){log('boot-request-uncertain',String(e));}
};
button('probe').onclick=async()=>{
  button('probe').disabled=true;
  try{
    const device=await(navigator as any).usb.requestDevice({filters:[{vendorId:0x2e8a,productId:3}]});
    await probe(device);
  }catch(e){log('probe-error',String(e));}
};
async function verify(device:HIDDevice){
  if(!device.opened)await device.open();connection=new FirmwareConnection(device);
  log('application-verifying');await connection.verify(choice);await connection.restoreSettings(saved);
  evidence.after=await new ToffeeLightingAPI(new ToffeeHIDDevice(device)).getPowerStatus();
  await device.close();button('reconnect').disabled=true;log('application-verified','Profile9,15s uptime,VIA unchanged/restored/read back.');
}
button('write').onclick=async()=>{
  if(writeAttempted)throw new Error('Single write only');writeAttempted=true;button('write').disabled=true;
  try{
    const bytes=eraseImage(payload,original);log('write-start',{bytes:bytes.length});
    await picoboot.writeImage(bytes,(done:number,total:number)=>{if(done===total)log('write-complete',{done,total});});
    const after=await picoboot.readImage(bytes.length,()=>{});
    if(after.some((b:number,i:number)=>b!==bytes[i]))throw new Error('Flash readback mismatch; stay in bootloader.');
    evidence.flashSha256=await digest(after);log('flash-verified',{bytes:after.length,sha256:evidence.flashSha256});
    await picoboot.reboot();log('reboot-acknowledged');
    const until=Date.now()+20000;
    while(Date.now()<until){
      const devices=(await navigator.hid.getDevices()).filter(d=>d.vendorId===MODULE_FILTER.vendorId&&d.productId===MODULE_FILTER.productId&&d.collections.some(c=>c.usagePage===MODULE_FILTER.usagePage&&c.usage===MODULE_FILTER.usage));
      if(devices.length===1){await verify(devices[0]);return;}
      await new Promise(resolve=>setTimeout(resolve,400));
    }
    button('reconnect').disabled=false;log('manual-reconnect-needed');
  }catch(e){log('update-error',String(e));}
};
button('reconnect').onclick=async()=>{button('reconnect').disabled=true;try{await verify(await chooseModule());}catch(e){log('verify-error',String(e));}};
