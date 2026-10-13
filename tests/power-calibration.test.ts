import {test, expect} from 'bun:test';
import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

for (const scenario of ['wrong-build', 'wrong-cap', 'stale-rgb', 'failed-off', 'camera-error', 'camera-owner', 'bad-ocr', 'overcurrent', 'low-voltage']) {
  test(`calibration runner fails closed: ${scenario}`, async () => {
    const directory = path.join(await mkdtemp(path.join(os.tmpdir(), 'toffee-power-sim-')), 'SIMULATION');
    const child = Bun.spawn([process.execPath, '--preload', './tests/power-calibration-preload.ts', './tests/power-calibration.ts',
      '/SIMULATED-DEPS', '0x00100000', 'sweep', '0x26100402', 'http://127.0.0.1:5174', '/SIMULATED-OCR', directory],
      {env: {...process.env, TOFFEE_CALIBRATION_SIMULATION: scenario}, stdout: 'pipe', stderr: 'pipe'});
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(out).toContain('SIMULATION ONLY'); expect(code).toBe(1);
    const events = (await Bun.file(path.join(directory, 'events.jsonl')).text()).trim().split('\n').map(JSON.parse);
    expect(events.some(e => e.event === 'failure')).toBe(true);
    const commands = events.filter(e => e.event === 'command');
    expect(commands.some(e => [0x71, 0x74, 0x81, 0x83].includes(e.code))).toBe(false);
    if (scenario.startsWith('wrong-')) expect(commands.some(e => e.code === 0x7c)).toBe(false);
    else expect(commands.at(-1).code).toBe(0x7c);
    if (scenario === 'failed-off') expect(err).toContain('All-off unconfirmed');
    console.log(`SIMULATION ${scenario}: stopped before group patterns; ${directory}`);
  }, 10000);
}
