// Read-only hosted-page check. Every hardware API is replaced before navigation.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
const [dependencies, report, screenshot] = process.argv.slice(2);
if (!dependencies || !report || !screenshot) throw new Error('Required: DEPENDENCIES NEW_REPORT SCREENSHOT.');
const {chromium} = createRequire(path.join(dependencies, 'package.json'))('playwright-core');
const browser = await chromium.launch({headless: false, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page = await browser.newPage({viewport: {width: 1280, height: 1000}});
const errors: string[] = [], requests: string[] = [], checks: string[] = [];
page.on('pageerror', (e: Error) => errors.push(e.message));
page.on('request', (r: any) => requests.push(r.url()));
await page.route('**/*', (r: any) => new URL(r.request().url()).origin === 'https://board-configurator.onrender.com' ? r.continue() : r.abort());
await page.addInitScript(() => {
  for (const api of ['hid', 'usb']) Object.defineProperty(navigator, api, {configurable: true, value: {
    getDevices: async () => {throw new Error('Hosted check must not enumerate hardware.');},
    requestDevice: async () => {throw new Error('Hosted check must not request hardware.');},
  }});
});
try {
  for (const suffix of ['', '/']) {
    const response = await page.goto('https://board-configurator.onrender.com/toffee-firmware' + suffix);
    assert.equal(response!.status(), 200);
    await page.getByRole('heading', {name: 'Module firmware update', exact: true}).waitFor();
    await page.getByRole('option', {name: 'Normal · 940 mA', exact: true}).waitFor({state: 'attached'});
    await page.getByText('Choose your firmware. We’ll install it and check your keyboard.', {exact: true}).waitFor();
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('button')?.disabled);
    assert.equal(await page.getByRole('button', {name: 'Update firmware', exact: true}).isEnabled(), true);
    await page.reload();
    await page.getByText('Update details & saved backups', {exact: true}).waitFor();
    assert.equal(await page.locator('button').count(), 1);
    checks.push('Live URL' + (suffix || ' without slash') + ': HTTP200, current updater/catalogue and refresh');
  }
  const recovery = await page.goto('https://board-configurator.onrender.com/toffee-firmware/?recovery=1');
  assert.equal(recovery!.status(), 200);
  await page.getByRole('heading', {name: 'Recover your keyboard', exact: true}).waitFor();
  await page.getByRole('option', {name: 'No saved backup — reinstall firmware', exact: true}).waitFor({state: 'attached'});
  assert.equal(await page.locator('button').count(), 1);
  assert.equal(await page.getByRole('button', {name: 'Recover keyboard', exact: true}).isDisabled(), true);
  checks.push('Live recovery route: HTTP200, one primary action, explicit saved-update selection, no hardware commands');
  assert.equal(requests.some(r => r.includes('normal-index') || r.includes('.glb')), false);
  assert.deepEqual(errors, []);
  await page.screenshot({path: screenshot, fullPage: true});
  console.info(checks.join('\n'));
} finally {
  await Bun.write(report, JSON.stringify({checks, errors, hardware: 'forbidden; no PCB'}, null, 2));
  await browser.close();
}
