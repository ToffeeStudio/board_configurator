import {expect, test} from 'bun:test';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

async function simulation(scenario: string, action: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'toffee-extensive-simulation-'));
  const directory = path.join(root, 'SIMULATION-NOT-PCB-EVIDENCE');
  const extra: string[] = [];
  if (action === 'individual') {
    const file = path.join(root, 'explicit-individual-cases.json');
    await Bun.write(file, JSON.stringify([{index: 65, color: 'red'}, {index: 92, color: 'green'}, {index: 90, color: 'blue'}]));
    extra.push(file);
  }
  const child = Bun.spawn([process.execPath, '--preload', './tests/extensive-simulation-preload.ts',
    './tests/extensive-session.ts', '/virtual/toffee-simulation/node_modules', '0x01142000',
    'Module-B', '/virtual/simulation-camera', 'SIM-FRONT', 'SIM-BACK', directory, action, '0x26100202', ...extra],
    {env: {...process.env, TOFFEE_SIMULATION_SCENARIO: scenario}, stdout: 'pipe', stderr: 'pipe'});
  const output = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  await Bun.write(path.join(root, 'stdout.log'), output[0]);
  await Bun.write(path.join(root, 'stderr.log'), output[1]);
  if (!await Bun.file(path.join(directory, 'manifest.json')).exists())
    throw new Error(`Simulation exited ${output[2]} before its report: ${output[0]}\n${output[1]}\nLogs: ${root}`);
  const report = await Bun.file(path.join(directory, 'manifest.json')).json();
  const events = (await Bun.file(path.join(directory, 'events.jsonl')).text()).trim().split('\n').map(JSON.parse);
  console.log(`SIMULATION ${scenario}/${action}: exit ${output[2]}; evidence ${root}`);
  return {code: output[2], report, events, output: output.slice(0, 2).join('\n')};
}

test('offline runner collects all 312 RGB cases, cleans up, and never claims physical PASS', async () => {
  const result = await simulation('happy', 'rgb');
  expect(result.code).toBe(0); expect(result.report.cases.length).toBe(109);
  expect(result.report.result).toBe('INCONCLUSIVE'); expect(result.report.cleanup).toBe('all-off ACK received');
  expect(result.report.cases.filter((c: any) => c.id === 'L1').flatMap((c: any) => c.expected.packages).length).toBe(312);
  expect(result.output).toContain('SIMULATION ONLY');
}, 20000);
test('offline runner checks all eight group combinations and fixed-group isolation', async () => {
  const result = await simulation('happy', 'groups');
  expect(result.code).toBe(0); expect(result.report.cases.length).toBe(24);
  expect(result.report.cases.filter((c: any) => c.name.startsWith('group-bits-')).length).toBe(8);
}, 20000);
test('offline runner sends only reviewed invalid cases, records rejection and cleans up', async () => {
  const result = await simulation('happy', 'invalid');
  expect(result.code).toBe(0);
  expect(result.events.filter((e: any) => e.event === 'command-reply' && e.status === 0xef).length).toBe(290);
  expect(result.report.cleanup).toBe('all-off ACK received');
}, 20000);
test('camera failure immediately stops further patterns and retains the failure', async () => {
  const result = await simulation('camera-failure', 'rgb');
  expect(result.code).toBe(1); expect(result.report.result).toBe('FAIL');
  expect(result.report.cases.length).toBe(0); expect(result.report.error).toContain('FIXTURE STOP');
  const selections = result.events.filter((e: any) => e.event === 'command-request' && e.code === 0x7c);
  expect(selections.length).toBe(1); expect(selections[0].payload).toEqual([255, 255, 255, 255, 255]);
  expect(result.report.cleanup).toBe('all-off ACK received');
}, 20000);
test('wrong firmware cap stops before any lighting write or camera capture', async () => {
  const result = await simulation('wrong-cap', 'rgb');
  expect(result.code).toBe(1); expect(result.report.cases.length).toBe(0);
  expect(result.events.filter((e: any) => e.event === 'hid-send').every((e: any) => [0x85, 0x86].includes(e.bytes[1]))).toBe(true);
  expect(result.report.cleanup).toContain('not attempted');
}, 20000);
test('failed initial all-off is not retried as a test; only one cleanup attempt occurs', async () => {
  const result = await simulation('failed-off', 'rgb');
  expect(result.code).toBe(1); expect(result.report.cases.length).toBe(0);
  expect(result.events.filter((e: any) => e.event === 'hid-send' && e.bytes[1] === 0x7c).length).toBe(2);
}, 20000);
test('offline runner closes/reopens HID and checks that late keepalive cannot relight', async () => {
  const result = await simulation('happy', 'timeout');
  expect(result.code).toBe(0);
  expect(result.report.cases.length).toBe(3);
  const expired = result.events.filter((e: any) => e.event === 'test-status' && e.expired);
  expect(expired.length).toBe(2);
  expect(expired.every((e: any) => !e.active && e.groups === 0)).toBe(true);
  expect(result.report.cleanup).toBe('all-off ACK received');
}, 20000);
test('individual review uses the explicit case list and never lights a second package', async () => {
  const result = await simulation('happy', 'individual');
  expect(result.code).toBe(0); expect(result.report.cases.length).toBe(4);
  const selections = result.events.filter((e: any) => e.event === 'command-request' && e.code === 0x7c && e.payload.some((v: number) => v !== 255));
  expect(selections.map((e: any) => e.payload)).toEqual([
    [65, 255, 255, 255, 255], [255, 255, 92, 255, 255], [255, 90, 255, 255, 255]]);
}, 20000);
