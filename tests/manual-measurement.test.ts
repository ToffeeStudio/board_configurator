import {describe, expect, test} from 'bun:test';
import {ToffeeHIDDevice, ToffeeLightingAPI} from '../src/utils/toffee_studio/hid';
import {allOff, appendReading, BASELINE, CHECKLIST, COLOURS, debugCommand, GROUPS, INDICES, loadReadings,
  manualStatus, meterValues, preset, rawPayload, Reading, readingsCSV, readingsJSON,
  READINGS_KEY, readOutput, sumsFor, verifyPreset, ALL_CHECKLIST, MIXED_CHECKLIST, mixedPayload} from '../src/utils/toffee_studio/manual-measurement';
import {ManualHIDFixture} from './manual-hid-fixture';
const transport = () => {
  const device = new ManualHIDFixture();
  const hid = new ToffeeHIDDevice(device as unknown as HIDDevice);
  return {device, hid, api: new ToffeeLightingAPI(hid)};
};
const storage = () => {
  const values = new Map<string, string>();
  return {getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value)} as unknown as Storage;
};
async function reading(): Promise<Reading> {
  const {hid, api} = transport(), value = preset('front', 'White', 66, 10);
  await debugCommand(hid, 0x8a, rawPayload(value));
  return {id: 'one', pcb: 'PCB-A', at: '2026-10-06T00:00:00Z', appliedAt: '2026-10-06T00:00:00Z',
    amps: .320, voltage: 5.02, notes: 'manual', preset: value, sample: await verifyPreset(hid, api, value)};
}
describe('Manual measurement presets', () => {
  test('fixed checklist is 120 unique full-group states: RGB/white/orange, six ascending levels', () => {
    expect(CHECKLIST.length).toBe(120);
    expect(new Set(CHECKLIST.map(p=>p.key)).size).toBe(120);
    expect(BASELINE.level).toBe(0);
    for (const group of GROUPS) for (const colour of ['Red','Green','Blue','White','Orange']) {
      const states=CHECKLIST.filter(p=>p.group===group && p.colour===colour);
      expect(states.length).toBe(6);
      expect(states.every(p=>p.count===INDICES[group].length)).toBe(true);
      expect(states.every((p,i)=>p.level>0 && p.level<=255 && (!i || p.level>states[i-1].level))).toBe(true);
    }
    expect(CHECKLIST[0].key).toBe('v1:front:Red:66:26');
    expect(CHECKLIST[119].key).toBe('v1:all:Orange:104:110');
    expect(CHECKLIST.filter(p=>p.level===255).length).toBeGreaterThan(0);
    for(const value of CHECKLIST) {
      const sums=sumsFor(value);
      const roughMa=80+sums.reduce((total,rgb,g)=>total+rgb.reduce((a,b)=>a+b,0)*[12,15,13][g]/255,0);
      expect(roughMa).toBeLessThan(1000); // Choice of static points only, not enforcement.
    }
  });
  test('all 104 mapped LEDs are partitioned once, including index 103', () => {
    expect(GROUPS.map(g => INDICES[g].length)).toEqual([66,22,16,104]);
    const indices = [...INDICES.front, ...INDICES.rear, ...INDICES.badge];
    expect(indices.sort((a,b) => a-b)).toEqual(INDICES.all);
    expect(INDICES.front).toContain(103);
  });
  test('every group/colour encodes exact populations and unscaled RGB at 0..255', () => {
    for (const group of GROUPS) for (const colour of Object.keys(COLOURS) as (keyof typeof COLOURS)[]) {
      for (const count of [1,2,3,Math.min(50, INDICES[group].length),INDICES[group].length]) {
        for (const level of [0,10,20,50,150,250,255]) {
          const value = preset(group, colour, count, level), bytes = rawPayload(value);
          expect([...bytes.slice(0,3)]).toEqual(COLOURS[colour].map(c => Math.round(c*level/255)));
          const active = Array.from({length:104}, (_,i)=>i).filter(i => bytes[3+(i>>3)] & (1<<(i&7)));
          expect(active).toEqual(INDICES[group].slice(0,count));
          expect(sumsFor(value).flat().reduce((a,b)=>a+b,0)).toBe(value.rgb.reduce((a,b)=>a+b,0)*count);
        }
      }
    }
    expect([...rawPayload(preset('all','White',104,255))]).toEqual(Array(16).fill(255));
    expect(preset('all','Orange',104,10).rgb).toEqual([10,5,0]);
  });
  test('invalid required profile inputs fail before any transport', () => {
    for (const count of [0,67,NaN,1.2]) expect(()=>preset('front','White',count,10)).toThrow();
    for (const level of [-1,256,NaN,1.2]) expect(()=>preset('front','White',1,level)).toThrow();
    expect(()=>preset('missing' as any,'White',1,10)).toThrow();
    expect(()=>preset('front','constructor' as any,1,10)).toThrow();
  });
});
describe('Manual protocol', () => {
  test('30 appended fixed mixed states have exact independent RGB on all 104 LEDs', async () => {
    expect(ALL_CHECKLIST.length).toBe(150);
    expect(ALL_CHECKLIST.slice(0,120)).toEqual(CHECKLIST);
    expect(new Set(ALL_CHECKLIST.map(p => p.key)).size).toBe(150);
    const {device,hid,api} = transport();
    for (const p of MIXED_CHECKLIST) {
      expect(new Set(p.groups.map(g => g.colour)).size).toBe(3);
      expect(new Set(p.groups.map(g => g.level)).size).toBe(3);
      expect(p.groups.map(g => g.group)).toEqual(['front','rear','badge']);
      await debugCommand(hid,0x8c,mixedPayload(p));
      expect((await verifyPreset(hid,api,p)).output.groups).toEqual(sumsFor(p));
      for (const group of p.groups) for (const i of group.indices) expect(device.pixels[i]).toEqual(group.rgb);
      const roughMa = 80 + sumsFor(p).reduce((sum, rgb, g) => sum + rgb.reduce((a,b)=>a+b,0)*[12,15,13][g]/255, 0);
      if (MIXED_CHECKLIST.indexOf(p) < 25) expect(roughMa).toBeLessThan(1000);
    }
    device.build = 0x26100601;
    await expect(verifyPreset(hid,api,MIXED_CHECKLIST[0])).rejects.toThrow('Mixed-colour states require');
    await allOff(hid);
    expect((await readOutput(hid)).groups.flat()).toEqual(Array(9).fill(0));
  });
  test('exact final RGB, no hidden cap; all-off is volatile only', async () => {
    const {device,hid,api}=transport(), value=preset('all','White',104,255);
    await manualStatus(hid,api);
    await debugCommand(hid,0x8a,rawPayload(value));
    expect((await verifyPreset(hid,api,value)).output.groups).toEqual([[16830,16830,16830],[5610,5610,5610],[4080,4080,4080]]);
    await allOff(hid);
    expect((await readOutput(hid)).groups.flat()).toEqual(Array(9).fill(0));
    expect(device.packets.every(p=>[0x88,0x86,0x8a,0x89,0x7c].includes(p[1]))).toBe(true);
  });
  test('normal firmware, wrong builds, stale/mismatched output and rejection fail clearly', async () => {
    const {device,hid,api}=transport(); device.manual=false;
    await expect(manualStatus(hid,api)).rejects.toThrow('Unlimited manual test firmware');
    expect(device.packets.map(p=>p[1])).toEqual([0x88]);
    device.manual=true; device.build++;
    await expect(manualStatus(hid,api)).rejects.toThrow('Unexpected');
    device.build--; device.age=501;
    await expect(manualStatus(hid,api)).rejects.toThrow('not ready');
    await expect(readOutput(hid)).rejects.toThrow('stale');
    device.age=0; device.mismatch=true;
    await expect(verifyPreset(hid,api,preset('all','White',104,0))).rejects.toThrow('differs');
    device.reject=true;
    await expect(allOff(hid)).rejects.toThrow('rejected');
  });
});
describe('Manual data only', () => {
  test('zero amps is valid, blank or negative current is not; voltage is optional', () => {
    expect(meterValues('0','')).toEqual({amps:0,voltage:null});
    expect(meterValues(' 0.320 ','5.02')).toEqual({amps:.320,voltage:5.02});
    for(const value of ['', ' ', '-1', 'NaN', 'Infinity']) expect(()=>meterValues(value,'')).toThrow();
    for(const value of ['0', '-5', 'no']) expect(()=>meterValues('.3',value)).toThrow();
  });
  test('stores/reloads separate PCB observations, exports complete JSON and escaped CSV', async () => {
    const db=storage(), first=await reading();
    expect(loadReadings(db)).toEqual([]);
    appendReading(db,first);
    appendReading(db,{...first,id:'two',pcb:'PCB-B',amps:.33,notes:'=SUM(1,2)\n"quoted"'});
    const rows=loadReadings(db);
    expect(rows.map(row=>row.amps)).toEqual([.32,.33]);
    expect(JSON.parse(readingsJSON(rows))).toEqual({version:1,readings:rows});
    const csv=readingsCSV(rows);
    expect(csv).toContain('"Measured A"'); expect(csv).toContain('"PCB-B"');
    expect(csv).toContain('"\'=SUM(1,2)\n""quoted"""');
    expect(csv).toContain('"0x26101002"');
  });
  test('old records and new mixed records reload together; exports include all group RGB bytes', async () => {
    const db=storage(), old=await reading();
    old.sample.build=0x26100601;
    appendReading(db,old);
    const {hid,api}=transport(), p=MIXED_CHECKLIST[0];
    await debugCommand(hid,0x8c,mixedPayload(p));
    const mixed={...old,id:'mixed',pcb:'PCB-B',preset:p,sample:await verifyPreset(hid,api,p)};
    appendReading(db,mixed);
    expect(loadReadings(db)).toEqual([old,mixed]);
    const previousMixed=structuredClone(mixed);
    previousMixed.id='previous-mixed'; previousMixed.sample.build=0x26101001;
    appendReading(db,previousMixed);
    expect(loadReadings(db).at(-1)).toEqual(previousMixed);
    expect(readingsCSV(loadReadings(db))).toContain('"6/6/6","13/0/13","14/0/0"');
    const snapshot=db.getItem(READINGS_KEY);
    const corrupted=structuredClone(mixed); corrupted.preset.groups[0].rgb[0]++;
    db.setItem(READINGS_KEY,readingsJSON([old,corrupted]));
    const bad=db.getItem(READINGS_KEY);
    expect(()=>appendReading(db,mixed)).toThrow('mismatch');
    expect(db.getItem(READINGS_KEY)).toBe(bad);
    db.setItem(READINGS_KEY,snapshot!);
    expect(loadReadings(db)).toEqual([old,mixed,previousMixed]);
  });
  test('five higher-current states target 0.9–1A using the fitted model, not an active limit', () => {
    const weights=[[11175,11182,11416],[12706,12536,12435],[12862,12370,11788]];
    const estimates=MIXED_CHECKLIST.slice(25).map(value => 110 + Math.ceil(sumsFor(value).reduce((sum,rgb,g) =>
      sum+rgb.reduce((total,v,c)=>total+v*weights[g][c],0),0)/255000));
    expect(estimates).toEqual([903,925,941,960,979]);
    expect(MIXED_CHECKLIST[24].key).toBe('mixed-v1:25');
    expect(MIXED_CHECKLIST[29].key).toBe('mixed-v1:30');
  });
  test('corrupt or incompatible storage is never overwritten; quota failure is explicit', async () => {
    const db=storage(), row=await reading();
    for(const text of ['not JSON','null','{"version":2,"readings":[]}', readingsJSON([{...row,preset:{...row.preset,key:'wrong'}}])]) {
      db.setItem(READINGS_KEY,text);
      expect(()=>appendReading(db,row)).toThrow(); expect(db.getItem(READINGS_KEY)).toBe(text);
    }
    const full={getItem:()=>null,setItem:()=>{throw new Error('Quota exceeded');}} as unknown as Storage;
    expect(()=>appendReading(full,row)).toThrow('Quota');
  });
});
