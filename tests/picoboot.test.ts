import {expect,test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {Picoboot,FLASH_BASE,uf2Payload,eraseImage, type PicobootDevice} from '../src/utils/toffee_studio/picoboot';
class Usb {
  flash=new Uint8Array(0x100000).fill(0x5a); packets:Uint8Array[]=[];
  code=0;token=0;length=0;address=0;size=0;dataPending=false;xip=false;flashPrepared=false;
  short=false;badStatus=false;shortRead=false;
  async clearHalt(direction:string,endpoint:number){expect([direction,endpoint]).toEqual(direction==='in'?['in',4]:['out',3]);}
  async controlTransferOut(){return{status:'ok',bytesWritten:0};}
  async controlTransferIn(){const b=new Uint8Array(16),v=new DataView(b.buffer);v.setUint32(0,this.token,true);v.setUint32(4,this.badStatus?1:0,true);b[8]=this.code;return{status:'ok',data:v};}
  async transferOut(endpoint:number,bytes:Uint8Array){
    expect(endpoint).toBe(3);
    if(this.dataPending){this.flash.set(bytes,this.address-FLASH_BASE);this.dataPending=false;}
    else if(bytes.length===32){
      this.packets.push(bytes.slice());const v=new DataView(bytes.buffer,bytes.byteOffset);
      expect(v.getUint32(0,true)).toBe(0x431fd10b);this.token=v.getUint32(4,true);this.code=bytes[8];this.length=v.getUint32(12,true);
      this.address=v.getUint32(16,true);this.size=v.getUint32(20,true);
      if(this.code===1){expect(bytes[9]).toBe(1);expect(bytes[16]).toBe(1);}
      if(this.code===7){expect(this.flashPrepared).toBe(true);this.xip=true;}
      if(this.code===6){this.xip=false;this.flashPrepared=true;}
      if(this.code===3){expect(this.xip).toBe(false);expect(this.length).toBe(0);this.flash.fill(255,this.address-FLASH_BASE,this.address-FLASH_BASE+this.size);}
      if(this.code===5){expect(this.xip).toBe(false);expect(this.size).toBe(this.length);this.dataPending=true;}
      if(this.code===0x84){expect(this.xip).toBe(true);expect(this.size).toBe(this.length);}
    }else{expect(this.code).toBe(0x84);expect(bytes.length).toBe(1);}
    return{status:'ok',bytesWritten:bytes.length-(this.short?1:0)};
  }
  async transferIn(endpoint:number,count:number){expect(endpoint).toBe(4);const data=count===1?new Uint8Array():this.flash.slice(this.address-FLASH_BASE,this.address-FLASH_BASE+count-(this.shortRead?1:0));return{status:'ok',data:new DataView(data.buffer)};}
}
const session=(usb:Usb)=>new Picoboot(usb as unknown as PicobootDevice,1,4,3);
test('same UF2 extraction follows the validated block addresses and payload only',()=>{
  const uf2=new Uint8Array(readFileSync('firmware-downloads/normal.uf2')),binary=uf2Payload(uf2);
  expect(binary.length).toBe(uf2.length / 512 * 256);
  for (let block=0; block<uf2.length/512; block++)
    expect(binary.slice(block*256,(block+1)*256)).toEqual(uf2.slice(block*512+32,block*512+288));
  expect(binary.slice(0,256)).toEqual(uf2.slice(32,288));
  expect(binary.slice(-256)).toEqual(uf2.slice(-480,-224));
});
test('timeout latches failure and a late OUT cannot continue the interrupted command', async () => {
  const usb = new Usb(), c = session(usb);
  let release!: () => void;
  usb.transferOut = async () => {
    await new Promise<void>(resolve => {release = resolve;});
    return {status: 'ok', bytesWritten: 32};
  };
  const pending = c.prepareRead();
  await expect(pending).rejects.toThrow('timed out');
  release();
  await Bun.sleep(20);
  await expect(c.readImage(4096, () => {})).rejects.toThrow('unavailable');
  expect(usb.packets).toHaveLength(0);
}, 10000);
test('read/erase/program/readback preserves bytes beyond the UF2 in its last sector',async()=>{
  const usb=new Usb(),c=session(usb),payload=uf2Payload(new Uint8Array(readFileSync('firmware-downloads/normal.uf2')));
  const affected=Math.ceil(payload.length/4096)*4096;
  await c.prepareRead();const before=await c.readImage(affected,()=>{}),image=eraseImage(payload,before);
  expect(image.slice(payload.length)).toEqual(before.slice(payload.length));
  await c.writeImage(image,()=>{});expect(await c.readImage(image.length,()=>{})).toEqual(image);
  const erase=usb.packets.find(p=>p[8]===3)!;
  expect(new DataView(erase.buffer).getUint32(16,true)).toBe(FLASH_BASE);
  expect(new DataView(erase.buffer).getUint32(20,true)).toBe(affected);
  expect(usb.packets.filter(p=>p[8]===5).length).toBe(affected/4096);
});
test('invalid alignment/range/backup fails before any erase or programming',async()=>{
  const usb=new Usb(),c=session(usb);
  await expect(c.read(FLASH_BASE,255)).rejects.toThrow('aligned');
  await expect(c.read(FLASH_BASE+0x100000,256)).rejects.toThrow('first 1 MiB');
  await expect(c.writeImage(new Uint8Array(256),()=>{})).rejects.toThrow('erase sectors');
  expect(()=>eraseImage(new Uint8Array(88320),new Uint8Array(88320))).toThrow('original readback');
  expect(usb.packets.length).toBe(0);
});
test('short transfers and failed command status prevent any subsequent command',async()=>{
  for(const failure of ['short','badStatus'] as const){const usb=new Usb(),c=session(usb);usb[failure]=true;
    await expect(c.prepareRead()).rejects.toThrow('PICOBOOT');const count=usb.packets.length;
    await expect(c.writeImage(new Uint8Array(4096),()=>{})).rejects.toThrow('unavailable');expect(usb.packets.length).toBe(count);}
});
test('short read fails without accepting partial image bytes',async()=>{
  const usb=new Usb(),c=session(usb);await c.prepareRead();usb.shortRead=true;
  await expect(c.readImage(4096,()=>{})).rejects.toThrow('short read');
});
test('reset clears host endpoint state before resetting the ROM command interface', async()=>{
  const usb=new Usb(),c=session(usb),calls:string[]=[];
  usb.clearHalt=async(direction,endpoint)=>{calls.push(`${direction}:${endpoint}`);};
  usb.controlTransferOut=async()=>{calls.push('ROM reset');return{status:'ok',bytesWritten:0};};
  await c.prepareRead();
  expect(calls).toEqual(['in:4','out:3','ROM reset']);
  expect(usb.packets[0][8]).toBe(1);
});
test('failed endpoint reset stops before any PICOBOOT command or erase', async()=>{
  const usb=new Usb(),c=session(usb);
  usb.clearHalt=async()=>{throw new Error('Host pipe unavailable');};
  await expect(c.prepareRead()).rejects.toThrow('Host pipe unavailable');
  expect(usb.packets).toHaveLength(0);
  await expect(c.writeImage(new Uint8Array(4096),()=>{})).rejects.toThrow('unavailable');
});
test('late endpoint reset cannot continue after its timeout', async()=>{
  const usb=new Usb(),c=session(usb),calls:string[]=[];
  let release!:()=>void;
  usb.clearHalt=async(direction)=>{calls.push(direction);await new Promise<void>(resolve=>{release=resolve;});};
  usb.controlTransferOut=async()=>{calls.push('ROM reset');return{status:'ok',bytesWritten:0};};
  await expect(c.prepareRead()).rejects.toThrow('reset clear halt IN: transfer timed out');
  release();await Bun.sleep(20);
  expect(calls).toEqual(['in']);
  expect(usb.packets).toHaveLength(0);
  await expect(c.prepareRead()).rejects.toThrow('unavailable');
},10000);
test('USB failure identifies the command and acknowledgement stage without retrying it', async()=>{
  const usb=new Usb(),c=session(usb);
  usb.transferIn=async()=>{throw new Error('A transfer error has occurred.');};
  await expect(c.prepareRead()).rejects.toThrow('0x01 acknowledgement IN: A transfer error');
  expect(usb.packets).toHaveLength(1);
  await expect(c.readImage(4096,()=>{})).rejects.toThrow('unavailable');
});
