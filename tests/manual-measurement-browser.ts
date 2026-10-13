// Visible isolated Chrome + actual checklist components, exclusively fake WebHID.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {open, readFile} from 'node:fs/promises';
import path from 'node:path';
import {BASELINE, ALL_CHECKLIST} from '../src/utils/toffee_studio/manual-measurement';
const [dependencies, baseUrl, reportPath, screenshotPath] = process.argv.slice(2);
if (!dependencies || !baseUrl || !reportPath || !screenshotPath)
  throw new Error('Required: NODE_MODULES_DIRECTORY LOCAL_APP_URL NEW_REPORT_JSON SCREENSHOT_PNG.');
assert.equal(new URL(baseUrl).hostname, '127.0.0.1');
const report=await open(reportPath,'wx');
const {chromium}=createRequire(path.join(dependencies,'package.json'))('playwright-core');
const browser=await chromium.launch({headless:false,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//,(route:any)=>route.abort());
await context.addInitScript(()=>{
  const hid=new EventTarget();
  Object.assign(hid,{getDevices:async()=>[],requestDevice:async()=>{throw new Error('No physical USB allowed');}});
  Object.defineProperty(navigator,'hid',{value:hid,configurable:true});
});
const page=await context.newPage();page.setDefaultTimeout(12000);
const checks:string[]=[],errors:string[]=[];
page.on('pageerror',(e:Error)=>errors.push(e.message));
const check=(label:string)=>{checks.push(label);console.log('OFFLINE CHECKLIST PASS:',label);};
const state=()=>page.evaluate(()=>{
  const d=(window as any).manualFixture;
  return {packets:d.packets,pixels:d.pixels,maxPending:d.maxPending};
});
const set=(values:Record<string,unknown>)=>page.evaluate(v=>Object.assign((window as any).manualFixture,v),values);
const button=(name:string)=>page.getByRole('button',{name,exact:true});
const states=[BASELINE,...ALL_CHECKLIST];
const apply=async(n:number)=>{
  await button('Apply state '+n).click();
  await page.getByTestId('manual-applied').filter({hasText:states[n].key+' · output verified'}).waitFor();
  await page.waitForFunction(n=>!document.querySelector<HTMLButtonElement>('[aria-label="Apply state '+n+'"]')!.disabled,n);
};
const record=async(n:number,amps:string)=>{
  await page.getByLabel('Amps for state '+n,{exact:true}).fill(amps);
  await button('Save state '+n).click();
  await page.getByRole('status').filter({hasText:'Recorded'}).waitFor();
};
try {
  const fixtureUrl=new URL('/tests/manual-measurement-fixture.html',baseUrl).href;
  const html=await(await fetch(fixtureUrl,{headers:{accept:'*/*'}})).text();
  await page.route(fixtureUrl,(route:any)=>route.fulfill({contentType:'text/html',body:html}));
  await page.goto(fixtureUrl);
  await page.getByRole('heading',{name:'Lighting measurement checklist'}).waitFor();
  assert.equal(await page.getByRole('table',{name:'Fixed measurement states'}).locator('tbody tr').count(),151);
  assert.equal(await page.getByRole('combobox').count(),0);
  assert.equal(await page.getByRole('slider').count(),0);
  assert.equal(await button('+10').count(),0);
  assert.equal((await state()).packets.length,0);assert.ok(await button('Apply state 1').isDisabled());
  check('Exactly 150 fixed rows plus baseline; no configurable profile/colour/brightness controls, no HID on load');
  await set({manual:false});await button('Check firmware').click();
  await page.getByRole('alert').filter({hasText:'Unlimited manual test firmware is required'}).waitFor();
  assert.ok((await state()).packets.every((p:number[])=>p[1]===0x88));
  await set({manual:true});await button('Check firmware').click();
  await page.getByTestId('manual-firmware').filter({hasText:'Unlimited'}).waitFor();
  assert.ok(await button('Apply state 1').isDisabled());
  await page.getByLabel('PCB identifier',{exact:true}).fill('PCB-A');
  check('Firmware + PCB label required before applying fixed states');
  await set({build:0x26100601});await button('Check firmware').click();
  await page.getByTestId('manual-firmware').filter({hasText:'0x26100601'}).waitFor();
  assert.ok(await button('Apply state 121').isDisabled());
  assert.ok(await button('Apply state 1').isEnabled());
  await set({build:0x26101002});await button('Check firmware').click();
  await page.getByTestId('manual-firmware').filter({hasText:'0x26101002'}).waitFor();
  check('Old unlimited firmware still supports original rows, but mixed states require new firmware');
  await apply(0);await record(0,'0.080');
  await apply(1);assert.ok(await page.getByLabel('Amps for state 1',{exact:true}).isEnabled());
  assert.ok(await page.getByLabel('Amps for state 2',{exact:true}).isDisabled());
  const held=await state();await page.waitForTimeout(1100);
  assert.deepEqual((await state()).packets,held.packets);
  await record(1,'0.161');
  await page.getByTestId('checklist-progress').filter({hasText:'1 / 150 recorded for PCB-A'}).waitFor();
  check('Apply enables only its row; manual readings save without automatic advancement or output changes');
  await set({mismatch:true});await page.getByLabel('Amps for state 1',{exact:true}).fill('0.162');
  await button('Save state 1').click();
  await page.getByRole('alert').filter({hasText:'Actual RGB output differs'}).waitFor();
  assert.equal(await page.getByRole('table',{name:'Saved measurements'}).locator('tbody tr').count(),2);
  await set({mismatch:false,age:501});await button('Apply state 2').click();
  await page.getByRole('alert').filter({hasText:'not ready'}).waitFor();
  assert.ok(await button('Save state 1').isDisabled());await set({age:0});
  check('Stale and mismatched output cannot be recorded as a valid checklist observation');
  // Exercise every fixed button against the real helper/transport, including 255.
  for(let n=1;n<=150;n++){
    await apply(n);
    const p=states[n],actual=(await state()).pixels;
    const groups='groups' in p?p.groups:[p];
    const expected=Array.from({length:104},(_,i)=>groups.find(group=>group.indices.includes(i))?.rgb ?? [0,0,0]);
    assert.deepEqual(actual,expected,'exact fixed output for row '+n);
  }
  check('All 150 Apply buttons transmit exact fixed RGB; mixed groups are atomic and full255 states are not dimmed');
  await page.getByLabel('PCB identifier',{exact:true}).fill('PCB-B');
  assert.ok(await button('Save state 120').isDisabled());
  await apply(1);await record(1,'0.170');
  await page.getByTestId('checklist-progress').filter({hasText:'1 / 150 recorded for PCB-B'}).waitFor();
  assert.match(await page.getByTestId('state-1').innerText(),/0.170 A/);
  await page.getByLabel('PCB identifier',{exact:true}).fill('PCB-A');
  assert.match(await page.getByTestId('state-1').innerText(),/0.161 A/);
  check('Identical numbered state is repeatable across PCBs; progress and saved values follow the label');
  for(const format of ['JSON','CSV']){
    const downloaded=page.waitForEvent('download');await button('Export '+format).click();
    const data=await readFile(await(await downloaded).path(),'utf8');
    if(format==='JSON'){
      const rows=JSON.parse(data).readings;
      assert.deepEqual(rows.map((r:any)=>r.amps),[.08,.161,.17]);
      assert.equal(rows[1].preset.key,rows[2].preset.key);assert.equal(rows[1].voltage,null);
    }else {assert.ok(data.includes('"PCB-A"'));assert.ok(data.includes('"PCB-B"'));}
  }
  await page.getByRole('heading',{name:'Work down the list',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:screenshotPath});
  await page.reload();await page.getByRole('heading',{name:'Recorded measurements · 3',exact:true}).waitFor({state:'attached'});
  assert.equal((await state()).packets.length,0);
  await page.getByLabel('PCB identifier',{exact:true}).fill('PCB-A');
  await page.getByTestId('checklist-progress').filter({hasText:'1 / 150 recorded for PCB-A'}).waitFor();
  check('JSON/CSV retain all rows and browser reload restores progress without applying lighting');
  await button('Check firmware').click();await page.getByTestId('manual-firmware').filter({hasText:'Unlimited'}).waitFor();
  await page.getByRole('link',{name:'Jump to 30 mixed-colour cases ↓'}).click();
  await page.getByTestId('state-121').waitFor({state:'visible'});
  await apply(121); await record(121,'0.192');
  assert.match(await page.getByTestId('state-121').innerText(),/0.192 A/);
  const mixedDownload=page.waitForEvent('download');await button('Export CSV').click();
  const mixedCSV=await readFile(await(await mixedDownload).path(),'utf8');
  assert.ok(mixedCSV.includes('"6/6/6","13/0/13","14/0/0"'));
  await page.screenshot({path:screenshotPath+'.mixed.png'});
  await page.reload();await page.getByRole('heading',{name:'Recorded measurements · 4',exact:true}).waitFor({state:'attached'});
  await page.getByLabel('PCB identifier',{exact:true}).fill('PCB-A');
  assert.match(await page.getByTestId('state-121').innerText(),/0.192 A/);
  await page.getByTestId('checklist-progress').filter({hasText:'2 / 150 recorded for PCB-A'}).waitFor();
  await button('Check firmware').click();await page.getByTestId('manual-firmware').filter({hasText:'Unlimited'}).waitFor();
  check('Mixed state manually recorded, exported with three exact RGB triples, and preserved across reload');
  await set({delay:120});
  await page.evaluate(()=>{const b=document.querySelector<HTMLButtonElement>('[aria-label="Apply state 6"]')!;b.click();b.click();b.click();});
  await button('All off').click();await page.getByTestId('manual-applied').filter({hasText:BASELINE.key}).waitFor();
  await page.waitForTimeout(500);
  assert.ok((await state()).pixels.flat().every((n:number)=>n===0));assert.equal((await state()).maxPending,1);
  await set({delay:0});check('Rapid Apply clicks serialize; sticky All off cancels pending work without later relight');
  await page.evaluate(()=>(window as any).disconnectFixture());
  await page.getByRole('alert').filter({hasText:'Board disconnected'}).waitFor();
  assert.ok(await button('Apply state 1').isDisabled());
  assert.equal(await page.getByLabel('PCB identifier',{exact:true}).inputValue(),'');
  check('Disconnect invalidates firmware verification and PCB identity without deleting measurements');
  await page.goto(new URL('/toffee-debug',baseUrl).href);
  await page.getByRole('heading',{name:'Lighting measurement checklist'}).waitFor();
  await page.getByText('Lighting Debug',{exact:true}).waitFor();
  await page.screenshot({path:screenshotPath+'.route.png'});
  await page.setViewportSize({width:900,height:900});
  await page.getByTestId('state-150').scrollIntoViewIfNeeded();
  assert.ok(await button('All off').isVisible());
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:screenshotPath+'.bottom.png'});
  check('Actual route/sidebar loads offline; long list scrolls to state150 and keeps All off accessible');
  await page.route('**/src/config/debug.ts*',async(route:any)=>{
    const response=await route.fetch(),source=await response.text();assert.ok(source.includes('DEBUG_ENABLED = true'));
    await route.fulfill({response,body:source.replace('DEBUG_ENABLED = true','DEBUG_ENABLED = false')});
  });
  await page.reload();await page.getByText('Debug mode is disabled.',{exact:true}).waitFor();
  assert.equal(await page.getByText('Lighting Debug',{exact:true}).count(),0);
  await page.goto(new URL('/toffee-test',baseUrl).href);await page.getByText('Debug mode is disabled.',{exact:true}).waitFor();
  await page.goto(fixtureUrl);await page.getByText('Debug mode is disabled.',{exact:true}).waitFor();
  assert.match(await page.evaluate(async()=>{try{await(window as any).disabledWrite();return 'bad';}catch(e){return String(e);}}),/disabled/);
  assert.equal((await state()).packets.length,0);
  check('DEBUG_ENABLED=false blocks both debug routes/navigation and debug HID helpers');
  assert.deepEqual(errors,[]);
  await report.writeFile(JSON.stringify({scope:'OFFLINE simulated HID only; all150 UI requests checked',checks,errors},null,2));
}catch(error){
  await report.writeFile(JSON.stringify({checks,errors,failure:String(error)},null,2));
  await page.screenshot({path:screenshotPath+'.failure.png',timeout:3000}).catch(()=>{});
  throw error;
}finally{await browser.close();await report.close();}
