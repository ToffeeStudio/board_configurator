// Visible isolated Chrome. No real navigator.hid, flashing or camera.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {open} from 'node:fs/promises';
import path from 'node:path';
import {FRONT_EFFECTS, BADGE_EFFECTS} from '../src/utils/toffee_studio/lighting-effects';
const [dependencies,base,reportPath,screenshotPath] = process.argv.slice(2);
if (!dependencies || !base || !reportPath || !screenshotPath) throw new Error('Required: DEPENDENCIES LOCAL_URL NEW_REPORT SCREENSHOT');
assert.equal(new URL(base).hostname,'127.0.0.1');
const report = await open(reportPath,'wx');
const {chromium} = createRequire(path.join(dependencies,'package.json'))('playwright-core');
const browser = await chromium.launch({headless:false,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page = await browser.newPage({viewport:{width:1300,height:1000}});
page.setDefaultTimeout(10000);
const checks: string[] = [], errors: string[] = [];
page.on('pageerror',(error: Error)=>errors.push(error.message));
const snapshot = ()=>page.evaluate(()=>{const d=(window as any).groupFixture;return {front:[...d.front],badge:[...d.badge],pending:d.pending,maximum:d.maximumPending,packets:d.packets.map((p:number[])=>p[1])};});
const check = (message:string)=>{checks.push(message);console.info('EFFECTS UI PASS:',message);};
const choose = async (group:string,label:string)=>{
  const input = page.getByRole('combobox',{name:group+' effect'});
  await input.fill(label);
  await page.getByRole('option',{name:label,exact:true}).click();
};
try {
  await page.route('https://**/*',(route:any)=>route.abort());
  const url = new URL('/tests/group-effects-fixture.html',base).href;
  const html = await (await fetch(url,{headers:{accept:'*/*'}})).text();
  await page.route(url,(route:any)=>route.fulfill({contentType:'text/html',body:html}));
  await page.goto(url);
  await page.getByRole('combobox',{name:'Badge effect'}).waitFor();
  const before = await snapshot();
  assert.ok(before.packets.every(n=>[0x85,0x80,0x8d].includes(n)));
  check('Initial load reads capability and state without lighting writes');
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
  await page.getByRole('slider',{name:'Front speed'}).focus();
  for(let i=0;i<10;i++) await page.getByRole('slider',{name:'Front speed'}).press('ArrowRight');
  await page.waitForFunction(()=>(window as any).groupFixture.pending===0);
  assert.equal((await snapshot()).maximum,1);
  check('Actual slider keyboard changes stay independent and rapid writes never overlap');
  await page.getByRole('button',{name:'Reload menus'}).click();
  await page.getByRole('combobox',{name:'Badge effect'}).waitFor();
  assert.equal(await page.getByRole('slider',{name:'Badge speed'}).inputValue(),'255');
  check('Reloaded menus recover animation/speed/brightness from firmware state');
  await page.screenshot({path:screenshotPath,fullPage:true});
  await page.evaluate(()=>{(window as any).groupFixture.reject=true;});
  await choose('Front','Solid');
  await page.getByRole('alert').filter({hasText:'status 0xef'}).waitFor();
  await page.evaluate(()=>{(window as any).groupFixture.reject=false;});
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await page.getByRole('combobox',{name:'Front effect'}).waitFor();
  check('Rejected setters report errors and Retry reloads state');
  await page.evaluate(()=>{const d=(window as any).groupFixture;d.version=2;d.front[0]=1;d.badge=[1,18,40,255,1,100];d.packets=[];});
  await page.getByRole('button',{name:'Reload menus'}).click();
  await page.getByRole('checkbox',{name:'Badge lighting enabled'}).waitFor();
  assert.equal(await page.getByRole('combobox',{name:'Badge effect'}).count(),0);
  await page.getByRole('combobox',{name:'Front effect'}).click();
  assert.equal(await page.getByRole('option').count(),9);
  await page.keyboard.press('Escape');
  await page.getByRole('checkbox',{name:'Badge lighting enabled'}).uncheck();
  await page.waitForFunction(()=>(window as any).groupFixture.badge[0]===0);
  assert.ok((await snapshot()).packets.every(n=>![0x8d,0x8e].includes(n)));
  check('Old firmware exposes only its supported9 front options and solid badge controls');
  assert.deepEqual(errors,[]);
} finally {
  await report.writeFile(JSON.stringify({checks,errors,hardware:'simulated only'},null,2)); await report.close();
  await browser.close();
}
