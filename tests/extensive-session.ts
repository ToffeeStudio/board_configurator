// Opt-in real PCB/camera tests. Execute only after the plan's unpowered inspection.
// Temporary firmware is mandatory: startup off, 18/channel cap, 5s watchdog,
// RAM-only lighting changes. Never run this against the other Module or stock firmware.
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir, open} from 'node:fs/promises';
import childProcess from 'node:child_process';
import {promisify} from 'node:util';
import {CommandID, ToffeeHIDDevice, ToffeeLightingAPI} from '../src/utils/toffee_studio/hid';
import map from '../src/utils/toffee_studio/lighting-map.json';
import {NativeHIDDevice, rawPath} from './native-hid-adapter';
import {badgeIndices, rearIndices, rgbCases, parseTestStatus} from './extensive-plan';

const [dependencies, locationText, sample, cameraBinary, frontId, backId, outputDirectory, action, buildText, individualFile] = process.argv.slice(2);
if (!dependencies || !locationText || !sample || !cameraBinary || !frontId || !backId || !outputDirectory || !action || !buildText)
  throw new Error('Required: NODE_MODULES USB_LOCATION SAMPLE CAMERA_BINARY FRONT_ID BACK_ID NEW_OUTPUT_DIRECTORY baseline|rgb|individual|groups|invalid|timeout|kill-timeout|soak EXPECTED_TEST_BUILD_ID [INDIVIDUAL_CASES_JSON].');
assert.equal(Number(locationText), 0x01142000, 'Only exposed Module B is authorised.');
assert.equal(sample, 'Module-B');
assert.ok(['baseline', 'rgb', 'individual', 'groups', 'invalid', 'timeout', 'kill-timeout', 'soak'].includes(action));
let individualCases: {index: number; color: 'red' | 'green' | 'blue'}[] = [];
if (action === 'individual') {
  if (!individualFile) throw new Error('Required explicit INDIVIDUAL_CASES_JSON for individual action.');
  individualCases = await Bun.file(individualFile).json();
  assert.ok(individualCases.length > 0);
  for (const c of individualCases) {
    assert.ok(Number.isInteger(c.index) && c.index >= 0 && c.index < 104);
    assert.ok(['red', 'green', 'blue'].includes(c.color));
  }
}
const expectedBuild = Number(buildText); assert.ok(Number.isInteger(expectedBuild) && expectedBuild > 0);
const plannedRGB = rgbCases([...map.front.map(key => key.index), ...badgeIndices].sort((a, b) => a - b), rearIndices);
await mkdir(outputDirectory); // Destination conflicts stop instead of overwrite.
const events = await open(path.join(outputDirectory, 'events.jsonl'), 'wx', 0o644);
const started = new Date().toISOString(), began = performance.now();
const targetPath = rawPath(Number(locationText), dependencies);
const native = new NativeHIDDevice(targetPath, dependencies);
const hid = new ToffeeHIDDevice(native as unknown as HIDDevice), api = new ToffeeLightingAPI(hid);
const cases: object[] = [];
let failure: Error | null = null, confirmedTest = false, heartbeatRunning = false;
let heartbeat: Promise<void> = Promise.resolve(), previousUptime: number | null = null;
let logQueue: Promise<void> = Promise.resolve();
const log = (event: object) => {
  const line = JSON.stringify({time: new Date().toISOString(), ...event}) + '\n';
  logQueue = logQueue.then(async () => {await events.write(line);});
  return logQueue;
};
const send = native.sendReport.bind(native);
native.sendReport = async (id, data) => {await log({event: 'hid-send', bytes: [...data]}); await send(id, data);};
native.addEventListener('inputreport', event => {
  const data = (event as HIDInputReportEvent).data;
  if (data.byteLength === 32 && data.getUint8(26) === 0xa5)
    void log({event: 'hid-reply', bytes: [...new Uint8Array(data.buffer, data.byteOffset, data.byteLength)]})
      .catch(error => {failure = error;});
});
const check = () => {if (failure) throw failure;};
const interrupt = () => {heartbeatRunning = false; failure = new Error('Host interrupted; stop and recheck the fixture before resuming.');};
process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
const command = async (code: number, payload: number[], expected: number) => {
  check(); const start = performance.now();
  await log({event: 'command-request', code, payload, expected});
  const [status, response] = await hid.executeCommand(code as CommandID, new Uint8Array(payload));
  await log({event: 'command-reply', code, payload, status, latency_ms: performance.now() - start, response: [...response]});
  assert.equal(status, expected, `Unexpected status for command 0x${code.toString(16)}.`);
  return response;
};
const status = async () => {
  const data = parseTestStatus(await command(0x86, [], 0), expectedBuild);
  if (previousUptime !== null) {
    const delta = (data.uptime - previousUptime) >>> 0;
    assert.ok(delta < 120000, 'Firmware reset or unexpected uptime gap.');
  }
  previousUptime = data.uptime;
  await log({event: 'test-status', ...data}); return data;
};
const startHeartbeat = () => {
  heartbeatRunning = true;
  heartbeat = (async () => {
    while (heartbeatRunning) {
      await Bun.sleep(1000);
      if (heartbeatRunning) await command(0x87, [], 0);
    }
  })().catch(async error => {failure = error; heartbeatRunning = false; await log({event: 'heartbeat-failure', error: String(error)});});
};
const stopHeartbeat = async () => {heartbeatRunning = false; await heartbeat; check();};
const off = async () => {
  const data = await command(0x7c, [255, 255, 255, 255, 255], 0);
  assert.equal(data[10], 201, 'Unexpected configured diagnostic count.');
};
const camera = promisify(childProcess.execFile);
const capture = async (id: string, name: string, face: string) => {
  const image = `${name}-${face}.png`, requested = new Date().toISOString();
  const {stdout} = await camera(cameraBinary, [id, path.join(outputDirectory, image)], {timeout: 25000});
  console.log(stdout.trim());
  return {face, id, image, requested, completed: new Date().toISOString()};
};
const pair = async (id: string, name: string, expected: object) => {
  check(); const t = performance.now();
  const results = await Promise.allSettled([capture(frontId, name, 'front'), capture(backId, name, 'back')]);
  await log({event: 'camera-pair', id, name, results: results.map(result =>
    result.status === 'fulfilled' ? result : {status: 'rejected', error: String(result.reason)})});
  const rejected = results.filter(result => result.status === 'rejected');
  if (rejected.length) throw new Error(`FIXTURE STOP: incomplete camera pair ${name}; Ethan must repair/confirm before resuming.`);
  check();
  const observed = await status();
  assert.ok(!observed.expired, 'Unexpected controller timeout during a held test pattern.');
  const record = {id, name, expected, status: 'INCONCLUSIVE',
    reason: 'Capture/ACK complete; package-local visual scoring still required.',
    elapsed_ms: performance.now() - t, images: results.map(r => (r as PromiseFulfilledResult<object>).value), firmware: observed};
  cases.push(record); await log({event: 'case-complete', ...record});
};
const selection = async (id: string, name: string, leds: number[], expected: object) => {
  await off(); await command(0x7c, leds, 0); await pair(id, name, expected); await off();
};
const front = {effect: 1, speed: 100, brightness: 18, hue: 0, saturation: 255};
const badge = {enabled: true, brightness: 18, hue: 85, saturation: 255};
const groups = async (bits: number) => {
  await api.setBrightness(0); await api.setAnimation(0); await api.setSpeed(100); await api.setColor(170, 255);
  await api.setFrontState({...front, effect: bits & 1 ? 1 : 0});
  await api.setBadgeState({...badge, enabled: Boolean(bits & 4)});
  await api.setBrightness(bits & 2 ? 18 : 0);
};
try {
  await native.open(); await api.getCapabilities();
  const initial = await status(); confirmedTest = true;
  await log({event: 'session-start', sample, location: locationText, action, initial,
    cameras: {front: frontId, back: backId}, cap: 18, controller_timeout_ms: 5000});
  startHeartbeat(); await off(); await pair('A3', 'all-off-baseline', {groups: [], rgb: [0, 0, 0]});
  if (action === 'baseline') {
    for (let repetition = 1; repetition <= 3; repetition++) {
      await command(0x7d, [], 0); await pair('A4', `repeat-${repetition}-front`, {front_and_badge: 82, rgb: [18, 18, 18]});
      await off(); await pair('A4', `repeat-${repetition}-off-1`, {groups: []});
      await command(0x7f, [0, 0], 0); await pair('A4', `repeat-${repetition}-rear`, {rear: 22, phase: 0});
      await off(); await pair('A4', `repeat-${repetition}-off-2`, {groups: []});
    }
    for (const index of [64, 65, 80, 81, 82, 83, 84, 103])
      await selection('L3', `transition-${index}`, [index, 255, 255, 255, 255], {index, rgb: [18, 0, 0], known_fault: index === 103});
    for (const phase of [0, 64, 128, 192]) {
      await command(0x7f, [0, phase], 0); await pair('L4', `rear-frozen-${phase}`, {rear: 22, phase, geometry: '(x+y)/2, rear camera x mirrored'}); await off();
    }
    await command(0x7f, [1, 0], 0); const cycleStart = performance.now(); let cycleFrame = 0;
    while (performance.now() - cycleStart < 20480)
      await pair('L4', `rear-cycle-${cycleFrame++}`, {rear: 22, cycle_period_ms: 10240, elapsed_ms: performance.now() - cycleStart});
  } else if (action === 'rgb') {
    for (const c of plannedRGB) await selection(c.id, c.name, c.leds, {face: c.face, packages: c.expected});
  } else if (action === 'individual') {
    const slots = {red: 0, green: 2, blue: 1}, colors = {red: [18, 0, 0], green: [0, 18, 0], blue: [0, 0, 18]};
    for (const c of individualCases) {
      const leds = [255, 255, 255, 255, 255]; leds[slots[c.color]] = c.index;
      await selection('L1', `individual-${c.index}-${c.color}`, leds,
        {face: rearIndices.includes(c.index) ? 'back' : 'front',
          packages: [{...c, rgb: colors[c.color], known_fault: c.index === 103}]});
    }
  } else if (action === 'groups') {
    for (const key of map.front) await api.setLedBrightness(key.index, 255);
    for (let bits = 0; bits < 8; bits++) {
      await groups(bits); await pair('L5', `group-bits-${bits}`, {bits, front, rear: {brightness: 18, hue: 170}, badge}); await off();
    }
    for (const changing of ['front', 'rear', 'badge']) {
      await groups(7);
      const stable = {front: await api.getFrontState(), rear: await api.getLightingState(), badge: await api.getBadgeState()};
      for (const [brightness, hue] of [[4, 0], [8, 85], [12, 170], [18, 36], [0, 36]]) {
        if (changing === 'front') await api.setFrontState({...front, brightness, hue});
        if (changing === 'rear') {await api.setBrightness(brightness); await api.setColor(hue, 255);}
        if (changing === 'badge') await api.setBadgeState({...badge, brightness, hue});
        const actual = {front: await api.getFrontState(), rear: await api.getLightingState(), badge: await api.getBadgeState()};
        for (const fixed of ['front', 'rear', 'badge'] as const)
          if (fixed !== changing) assert.deepEqual(actual[fixed], stable[fixed]);
        await pair('L5', `change-${changing}-${brightness}-${hue}`, {changing, actual});
      }
      await off();
    }
    await log({event: 'blocked-subtest', id: 'L5', reason: 'Three concurrent independent animations: badge effects are deferred; only solid badge is implemented.'});
  } else if (action === 'invalid') {
    const before = {front: await api.getFrontState(), rear: await api.getLightingState(), badge: await api.getBadgeState()};
    for (let index = 201; index < 255; index++) {
      for (let slot = 0; slot < 5; slot++) {
        const leds = [255, 255, 255, 255, 255]; leds[slot] = index; await command(0x7c, leds, 0xef);
      }
    }
    for (const index of [1, 65, 80, 104, 200, 255]) {
      await command(0x7b, [index, 18], 0xef); await command(0x84, [index], 0xef);
    }
    for (const [code, payload] of [[0x7c, [0, 0, 255, 255, 255]], [0x81, [9, 100, 18, 0, 255]],
      [0x83, [2, 18, 0, 255]], [0x71, [255]], [0x7f, [2, 0]], [0x50, []], [0x5a, []], [0xfe, []]] as [number, number[]][])
      await command(code, payload, 0xef);
    assert.deepEqual({front: await api.getFrontState(), rear: await api.getLightingState(), badge: await api.getBadgeState()}, before);
    await pair('F1', 'invalid-input-still-off', {groups: [], reviewed_invalid_cases: 290, wrong_length: 'offline only: fixed-size hardware reports'});
  } else if (action === 'timeout') {
    await command(0x7c, [0, 255, 255, 255, 255], 0); await pair('F3', 'before-controller-loss', {index: 0, rgb: [18, 0, 0]});
    await stopHeartbeat(); await native.close(); await Bun.sleep(6000); await native.open();
    const expired = await status(); assert.ok(expired.expired && !expired.active && expired.groups === 0);
    // Record expected timeout separately: the ordinary pair helper rejects timeouts.
    const images = await Promise.all([capture(frontId, 'controller-lost-off', 'front'), capture(backId, 'controller-lost-off', 'back')]);
    cases.push({id: 'F3', name: 'controller-lost-off', expected: {groups: []}, firmware: expired,
      images, status: 'INCONCLUSIVE', reason: 'Host handle closed/reopened and timeout state verified; physical USB disconnect and visual scoring pending.'});
    await command(0x87, [], 0); assert.ok((await status()).expired, 'Late keepalive must not relight.');
    await off(); startHeartbeat();
  } else if (action === 'kill-timeout') {
    await stopHeartbeat(); await native.close();
    const child = childProcess.spawn(process.execPath, ['tests/kill-controller.ts', dependencies, locationText, buildText],
      {stdio: ['ignore', 'pipe', 'pipe']});
    const exited = new Promise<{code: number | null; signal: string | null}>(resolve =>
      child.once('exit', (code, signal) => resolve({code, signal})));
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Disposable controller failed to arm within 10s.')), 10000);
        let output = '';
        child.stdout.on('data', data => {
          output += data.toString(); void log({event: 'child-stdout', text: data.toString()});
          if (output.includes('CONTROLLER_ARMED_LED_0')) {clearTimeout(timer); resolve();}
        });
        child.stderr.on('data', data => {void log({event: 'child-stderr', text: data.toString()});});
        child.once('error', error => {clearTimeout(timer); reject(error);});
        child.once('exit', () => {clearTimeout(timer); reject(new Error('Disposable controller exited before expected kill.'));});
      });
      const before = await Promise.all([capture(frontId, 'before-process-kill', 'front'), capture(backId, 'before-process-kill', 'back')]);
      await log({event: 'before-process-kill', pid: child.pid, expected: {index: 0, rgb: [18, 0, 0]}, images: before});
      assert.ok(child.kill('SIGKILL'));
      const exit = await exited; assert.equal(exit.signal, 'SIGKILL');
      await log({event: 'controller-killed', pid: child.pid, ...exit});
      await Bun.sleep(6000); await native.open();
      const expired = await status(); assert.ok(expired.expired && !expired.active && expired.groups === 0);
      const images = await Promise.all([capture(frontId, 'process-killed-off', 'front'), capture(backId, 'process-killed-off', 'back')]);
      cases.push({id: 'F3', name: 'process-killed-off', firmware: expired, images,
        status: 'INCONCLUSIVE', reason: 'Actual SIGKILL and expired/off state verified; package-local visual review required.'});
      await command(0x87, [], 0); assert.ok((await status()).expired);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      if (!native.opened) await native.open();
    }
    await off(); startHeartbeat();
  } else if (action === 'soak') {
    await groups(7); await api.setFrontState({...front, effect: 2, saturation: 0}); await api.setAnimation(2);
    const soakStart = performance.now(); let nextPhoto = 0, nextEnumeration = 0;
    while (performance.now() - soakStart < 1800000) {
      check(); const elapsed = performance.now() - soakStart;
      if (elapsed >= nextEnumeration) {
        const currentPath = rawPath(Number(locationText), dependencies);
        assert.equal(currentPath, targetPath, 'Target re-enumerated during the soak.');
        await log({event: 'enumeration', elapsed_ms: elapsed, path: currentPath});
        console.log(`SOAK ${Math.round(elapsed / 1000)}s / 1800s; physical typing/visual supervision remains required.`);
        nextEnumeration += 60000;
      }
      if (elapsed >= nextPhoto) {await pair('E1', `soak-${Math.round(elapsed / 1000)}`, {elapsed_ms: elapsed, cap: 18}); nextPhoto += 300000;}
      const current = await status(); assert.ok(!current.expired); await Bun.sleep(1000);
    }
    await pair('E1', 'soak-end', {elapsed_ms: performance.now() - soakStart, cap: 18});
  }
} catch (error) {
  failure = error as Error;
  await log({event: 'STOP', error: String(error), action: 'Pause; notify Ethan. Do not resume a fixture failure until he confirms repair and a recheck succeeds.'});
  console.error(`STOP: ${error}`);
} finally {
  heartbeatRunning = false; await heartbeat;
  let cleanup = 'not attempted: required temporary firmware was not verified';
  if (confirmedTest) {
    // One all-off attempt even after failure. No restore/retry/escalation.
    try {const [code] = await hid.executeCommand(0x7c as CommandID, new Uint8Array([255, 255, 255, 255, 255])); assert.equal(code, 0); cleanup = 'all-off ACK received';}
    catch (error) {cleanup = `all-off failed: Ethan must disconnect USB; ${error}`; failure = failure || error as Error;}
  }
  if (native.opened) await hid.close();
  await log({event: 'cleanup', cleanup}); await events.sync(); await events.close();
  const report = {started, finished: new Date().toISOString(), elapsed_ms: performance.now() - began,
    sample, location: locationText, build: buildText, action, cap: 18,
    result: failure ? 'FAIL' : 'INCONCLUSIVE', error: failure ? String(failure) : null,
    meaning: 'Command/capture evidence is not visual, typing, electrical or thermal qualification.', cleanup, cases};
  const file = await open(path.join(outputDirectory, 'manifest.json'), 'wx', 0o644);
  await file.writeFile(JSON.stringify(report, null, 2) + '\n'); await file.sync(); await file.close();
}
if (failure) process.exit(1);
console.log(`CAPTURE COMPLETE: ${cases.length} cases. Review package-local images; no full physical PASS is implied.`);
