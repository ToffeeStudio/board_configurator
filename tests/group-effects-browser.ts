// Visible isolated Chrome. No real navigator.hid, flashing or camera.
// Halo Stage lighting controls (all three zones) against a simulated Module.
// CHROME_PATH and HEADLESS=1 are optional overrides for machines without the Mac Chrome path.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {open} from 'node:fs/promises';
import path from 'node:path';
import chroma from 'chroma-js';
import {FRONT_EFFECTS, BADGE_EFFECTS, REAR_EFFECTS} from '../src/utils/toffee_studio/lighting-effects';
const [dependencies,base,reportPath,screenshotPath] = process.argv.slice(2);
if (!dependencies || !base || !reportPath || !screenshotPath) throw new Error('Required: DEPENDENCIES LOCAL_URL NEW_REPORT SCREENSHOT');
assert.equal(new URL(base).hostname,'127.0.0.1');
const report = await open(reportPath,'wx');
const {chromium} = createRequire(path.join(dependencies,'package.json'))('playwright-core');
const browser = await chromium.launch({headless:process.env.HEADLESS === '1',
  executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page = await browser.newPage({viewport:{width:1300,height:1000}});
page.setDefaultTimeout(10000);
const checks: string[] = [], errors: string[] = [];
page.on('pageerror',(error: Error)=>errors.push(error.message));
const snapshot = ()=>page.evaluate(()=>{const d=(window as any).groupFixture;return {rear:[...d.rear],front:[...d.front],badge:[...d.badge],pending:d.pending,maximum:d.maximumPending,packets:d.packets.map((p:number[])=>p[1])};});
const check = (message:string)=>{checks.push(message);console.info('EFFECTS UI PASS:',message);};
const TABS: Record<string,string> = {Underglow:'Underglow',Front:'Front Lighting',Badge:'Badge'};
const tab = (group:string)=>page.getByRole('navigation',{name:'Lighting zones'}).getByRole('button',{name:TABS[group],exact:true}).click();
const effects = (group:string)=>page.getByRole('group',{name:group+' effect'});
const choose = async (group:string,label:string)=>{
  await tab(group);
  await effects(group).getByRole('button',{name:label,exact:true}).click();
};
const rgb = (hex:string)=>'rgb('+chroma(hex).rgb().join(', ')+')';
try {
  await page.route('https://**/*',(route:any)=>route.abort());
  const url = new URL('/tests/group-effects-fixture.html',base).href;
  const html = await (await fetch(url,{headers:{accept:'*/*'}})).text();
  await page.route(url,(route:any)=>route.fulfill({contentType:'text/html',body:html}));
  await page.goto(url);
  await effects('Underglow').waitFor();
  const before = await snapshot();
  assert.deepEqual(before.packets,[0x85,0x76,0x80,0x8d]);
  check('Initial load reads capability and all three zone states without lighting writes');
  for (const option of REAR_EFFECTS) {
    await choose('Underglow',option.label);
    await page.waitForFunction(value=>(window as any).groupFixture.rear[0]===value,option.value);
  }
  check('All10 underglow effects send their IDs');
  for (const option of FRONT_EFFECTS) {
    await choose('Front',option.label);
    await page.waitForFunction(value=>(window as any).groupFixture.front[0]===value,option.value);
  }
  check('All45 front options send their correct stable IDs, including reactive/heatmap');
  for (const option of BADGE_EFFECTS) {
    await choose('Badge',option.label);
    await page.waitForFunction(value=>(window as any).groupFixture.badge[4]===value,option.value);
  }
  check('All6 independent badge options send exact animation state');
  await page.getByRole('slider',{name:'Badge speed'}).focus();
  await page.getByRole('slider',{name:'Badge speed'}).press('End');
  await page.getByRole('slider',{name:'Badge brightness'}).focus();
  await page.getByRole('slider',{name:'Badge brightness'}).press('End');
  await page.waitForFunction(()=>{const b=(window as any).groupFixture.badge;return b[1]===255&&b[5]===255;});
  assert.equal((await snapshot()).front[0],44);
  await tab('Front');
  await page.getByRole('slider',{name:'Front speed'}).focus();
  for(let i=0;i<10;i++) await page.getByRole('slider',{name:'Front speed'}).press('ArrowRight');
  await page.waitForFunction(()=>(window as any).groupFixture.pending===0);
  assert.equal((await snapshot()).maximum,1);
  check('Actual slider keyboard changes stay independent and rapid writes never overlap');

  await tab('Underglow');
  await page.getByRole('button',{name:'Cyan',exact:true}).click();
  await page.waitForFunction(()=>{const r=(window as any).groupFixture.rear;return r[3]===138&&r[4]===230;});
  const wheel = page.getByRole('slider',{name:'Underglow colour'});
  await wheel.focus();
  await wheel.press('ArrowRight');
  await wheel.press('ArrowDown');
  await page.waitForFunction(()=>{const r=(window as any).groupFixture.rear;return r[3]===142&&r[4]===222;});
  const box = (await wheel.boundingBox())!;
  await page.mouse.click(box.x+box.width/2,box.y+2); // top edge: red, full saturation
  await page.waitForFunction(()=>{const r=(window as any).groupFixture.rear;return r[3]===0&&r[4]>=245;});
  const rear = (await snapshot()).rear;
  const expected = rgb(chroma.hsv(rear[3]/255*360,rear[4]/255,1).hex());
  await page.waitForFunction(colour=>getComputedStyle(document.querySelector('[data-zone=rear] span')!).backgroundColor===colour,expected);
  check('Underglow swatch, wheel keys and wheel pointer send hue/saturation; the ambient light follows');

  await page.getByRole('button',{name:'Reload menus'}).click();
  await effects('Underglow').waitFor();
  await tab('Badge');
  assert.equal(await page.getByRole('slider',{name:'Badge speed'}).inputValue(),'255');
  check('Reloaded controls recover animation/speed/brightness from firmware state');
  await page.screenshot({path:screenshotPath,fullPage:true});
  await page.evaluate(()=>{(window as any).groupFixture.reject=true;});
  await choose('Front','Solid');
  await page.getByRole('alert').filter({hasText:'status 0xef'}).waitFor();
  await page.evaluate(()=>{(window as any).groupFixture.reject=false;});
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await effects('Front').waitFor();
  check('Rejected setters report errors and Retry reloads state');
  await page.evaluate(()=>{const d=(window as any).groupFixture;d.version=2;d.front[0]=1;d.badge=[1,18,40,255,1,100];d.packets=[];});
  await page.getByRole('button',{name:'Reload menus'}).click();
  await effects('Front').waitFor();
  assert.equal(await effects('Front').getByRole('button').count(),9);
  await tab('Badge');
  await page.getByRole('checkbox',{name:'Badge lighting enabled'}).waitFor();
  assert.equal(await effects('Badge').count(),0);
  await page.getByRole('checkbox',{name:'Badge lighting enabled'}).uncheck();
  await page.waitForFunction(()=>(window as any).groupFixture.badge[0]===0);
  assert.ok((await snapshot()).packets.every(n=>![0x8d,0x8e].includes(n)));
  check('Old firmware exposes only its supported9 front options and solid badge controls');
  assert.deepEqual(errors,[]);
} finally {
  await report.writeFile(JSON.stringify({checks,errors,hardware:'simulated only'},null,2)); await report.close();
  await browser.close();
}
