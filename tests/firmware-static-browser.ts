import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {stat} from 'node:fs/promises';
const [dependencies, report, screenshot] = process.argv.slice(2);
if (!dependencies || !report || !screenshot) throw new Error('Required: DEPENDENCIES NEW_REPORT SCREENSHOT.');
const root = path.resolve('dist');
const server = Bun.serve({hostname: '127.0.0.1', port: 0, async fetch(request) {
  const url = new URL(request.url);
  let target = path.resolve(root, '.' + decodeURIComponent(url.pathname));
  if (target !== root && !target.startsWith(root + path.sep)) return new Response('Not found', {status: 404});
  try {
    if ((await stat(target)).isDirectory()) {
      if (!url.pathname.endsWith('/')) return Response.redirect(new URL(url.pathname + '/' + url.search, url), 308);
      target = path.join(target, 'index.html');
    }
    if (!(await Bun.file(target).exists())) return new Response('Not found', {status: 404});
    return new Response(Bun.file(target));
  } catch {return new Response('Not found', {status: 404});}
}});
const base = `http://127.0.0.1:${server.port}`;
const {chromium} = createRequire(path.join(dependencies, 'package.json'))('playwright-core');
const browser = await chromium.launch({headless: false, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page = await browser.newPage({viewport: {width: 1280, height: 1000}});
const errors: string[] = [], requests: string[] = [], checks: string[] = [];
page.on('pageerror', (e: Error) => errors.push(e.message));
page.on('request', (r: any) => requests.push(r.url()));
await page.route('https://**/*', (r: any) => r.abort());
await page.addInitScript(() => {
  for (const api of ['hid', 'usb']) Object.defineProperty(navigator, api, {configurable: true, value: {
    getDevices: async () => {throw new Error('Automatic hardware access forbidden.');},
    requestDevice: async () => {throw new Error('Hardware access forbidden.');},
  }});
});
try {
  assert.equal((await fetch(base + '/toffee-lighting')).status, 404);
  assert.equal((await fetch(base + '/toffee-firmware', {redirect: 'manual'})).status, 308);
  // The updater is public: it does not need ?debug=1, and ?debug=0 does not hide it.
  for (const address of ['/toffee-firmware', '/toffee-firmware/', '/toffee-firmware/?debug=0']) {
    const response = await page.goto(base + address);
    assert.equal(response!.status(), 200);
    await page.getByRole('heading', {name: 'Module firmware update', exact: true}).waitFor();
    await page.getByRole('option', {name: 'Normal · 940 mA', exact: true}).waitFor({state: 'attached'});
    await page.getByRole('option', {name: '500 mA USB · 450 mA cap', exact: true}).waitFor({state: 'attached'});
    await page.getByLabel('Firmware version').selectOption('usb-500ma');
    await page.getByText('Update details & saved backups', {exact: true}).click();
    await page.getByText(/Limits estimated whole-board current to 450 mA/).waitFor();
    await page.reload();
    await page.getByRole('heading', {name: 'Module firmware update', exact: true}).waitFor();
    checks.push(address + ': direct navigation and refresh work without SPA fallback');
  }
  assert.equal((await page.goto(base + '/toffee-firmware/?recovery=1'))!.status(), 200);
  await page.getByRole('heading', {name: 'Recover your keyboard', exact: true}).waitFor();
  checks.push('/toffee-firmware/?recovery=1: recovery opens without Debug');
  for (const route of ['/toffee-firmware/?recovery=1', '/toffee-firmware/']) {
    await page.goto(base + route);
    await page.getByText('Windows: RP2 Boot missing or won’t connect', {exact: true}).click();
    const link = page.getByRole('link', {name: 'Download Toffee Windows Setup'});
    const downloadPath = await link.getAttribute('href');
    assert.equal(downloadPath, '/firmware-downloads/toffee-windows-setup-v1.exe');
    const response = await fetch(base + downloadPath);
    assert.equal(response.status, 200);
    const data = Buffer.from(await response.arrayBuffer());
    assert.equal(data.subarray(0, 2).toString('ascii'), 'MZ');
    const release = Buffer.from(await Bun.file('firmware-downloads/toffee-windows-setup-v1.exe').arrayBuffer());
    assert.ok(data.equals(release), 'The served setup must match the Windows release binary');
    checks.push(route + ': Windows setup link serves the exact release binary');
  }
  assert.equal(requests.some(r => r.includes('normal-index') || r.includes('.glb')), false);
  assert.deepEqual(errors, []);
  await page.screenshot({path: screenshot, fullPage: true});
  checks.push('Built production entry never loads normal app/GLTF or enumerates hardware');
  console.info(checks.join('\n'));
} finally {
  await Bun.write(report, JSON.stringify({checks, errors, hardware: 'forbidden; no PCB'}, null, 2));
  await browser.close(); await server.stop();
}
