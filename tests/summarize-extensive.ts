// Read-only evidence aggregation. Never opens HID, invokes a camera or grades
// photographs as physical passes. Explicitly names every required input block.
import assert from 'node:assert/strict';
import path from 'node:path';
import {open} from 'node:fs/promises';

const [run, outputFile] = process.argv.slice(2);
if (!run || !outputFile) throw new Error('Required: RUN_DIRECTORY NEW_REPORT_JSON.');
const read = async (file: string) => Bun.file(path.join(run, file)).json();
const blocks = [];
for (const name of ['baseline-01', 'rgb-01', 'individual-01', 'groups-01', 'invalid-01', 'timeout-01', 'kill-timeout-01', 'soak-01', 'baseline-02']) {
  const manifest = await read(name + '/manifest.json');
  const events = (await Bun.file(path.join(run, name, 'events.jsonl')).text()).trim().split('\n').map(JSON.parse);
  const replies = events.filter(e => e.event === 'command-reply');
  const latencies = replies.map(e => e.latency_ms).sort((a, b) => a - b);
  const statuses = events.filter(e => e.event === 'test-status');
  const files = new Bun.Glob('*.png');
  let images = 0; for await (const _file of files.scan(path.join(run, name))) images++;
  blocks.push({name, started: manifest.started, finished: manifest.finished, elapsed_ms: manifest.elapsed_ms,
    error: manifest.error, cleanup: manifest.cleanup, camera_originals: images,
    logged_command_replies: replies.length, expected_rejections: replies.filter(e => e.status === 0xef).length,
    ack_latency_max_ms: latencies.at(-1), ack_latency_p95_ms: latencies[Math.floor(latencies.length * .95)],
    status_samples: statuses.length, enumeration_samples: events.filter(e => e.event === 'enumeration').length,
    observed_expiries: statuses.filter(e => e.expired).length,
    transport_result: manifest.error ? 'FAIL' : 'PASS',
    physical_result: 'See reviewed results; successful transport is not a physical/electrical pass.'});
}
const batch = await read('rgb-analysis-02.json'), individual = await read('individual-analysis-01.json');
const matches = new Set([...batch.results, ...individual.results].filter(r => r.result === 'EMISSION_MATCH').map(r => `${r.index}:${r.color}`));
const unresolved = batch.results.filter(r => r.index !== 103 && !matches.has(`${r.index}:${r.color}`))
  .map(r => ({index: r.index, color: r.color}));
assert.equal(batch.results.length, 312);
assert.equal(matches.size + unresolved.length + 3, 312);
const soak = blocks.find(b => b.name === 'soak-01')!;
const normal = await read('normal-restored-read.json'), original = await read('live-read.json');
assert.deepEqual(normal.initial, original.initial, 'Restored saved lighting/overrides differ from pre-test state.');
const other = await read('other-board-final.json');
assert.ok(other.original_lighting_unchanged && other.via_settings_unchanged && normal.other_board_settings_unchanged);
const browser = await read('browser-final.json');
const report = {generated: new Date().toISOString(), sample: 'Module-B', usb_location: '0x01142000',
  temporary_build_id: '0x26100202', cap_per_channel: 18, controller_timeout_ms: 5000,
  limitations: ['No exact installed-image readback.', 'No physical typing, measured electrical/thermal qualification or controlled cold-cycle series.',
    'Camera overexposure and reflections limit colour/isolation acceptance.', 'Badge effects deferred; equals repair/index 103 intentionally excluded.'],
  blocks, soak_30_minutes_transport_pass: soak.error === null && soak.elapsed_ms >= 1800000,
  rgb: {captured_unique_checks: 312, individual_repeats: individual.results.length, emission_matches: matches.size,
    known_hardware_exclusions: 3, needs_review: unresolved},
  restored_saved_lighting_and_all_66_overrides: true, both_via_snapshots_unchanged: true,
  other_board_original_lighting_unchanged: true, browser,
  source_of_per_plan_results: '../README.md'};
const file = await open(outputFile, 'wx', 0o644);
try {await file.writeFile(JSON.stringify(report, null, 2) + '\n'); await file.sync();} finally {await file.close();}
console.log(JSON.stringify({report: outputFile, blocks: blocks.length, rgb_matches: matches.size, rgb_review: unresolved.length,
  soak_pass: report.soak_30_minutes_transport_pass, restored_lighting: true, other_board_unchanged: true}));
