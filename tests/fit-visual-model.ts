// Numerical analysis only: never opens images or invokes OCR/camera software.
import assert from 'node:assert/strict';
import {readFile, open} from 'node:fs/promises';
import {estimateCurrent} from './visual-measurement';

const [eventsPath, outputPath] = process.argv.slice(2);
if (!eventsPath || !outputPath) throw new Error('Required: VISUALLY_REVIEWED_EVENTS_JSONL NEW_REPORT_JSON.');
const events = (await readFile(eventsPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
assert.ok(events.some(e => e.event === 'start' && e.method === 'explicit image viewing, no OCR' && Number(e.build) === 0x26100404));
assert.ok(!events.some(e => e.event === 'failure'));
const readings = events.filter(e => e.event === 'visual-reading' && e.heldMs >= 30000);
const median = (values: number[]) => {
  assert.ok(values.length, 'Missing required measurement.');
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const baseline = readings.filter(e => e.name === 'off').map(e => e.currentMa);
const baseMa = median(baseline);
const groups = ['front', 'rear', 'badge'], colors = ['red', 'green', 'blue'];
const trainingNames = groups.flatMap(group => colors.map(color => `${group}-${color}-11-255`));
const coefficients = groups.map((group, g) => colors.map((color, c) => {
  const samples = readings.filter(e => e.name === `${group}-${color}-11-255`);
  for (const sample of samples) {
    const expected = [[0,0,0],[0,0,0],[0,0,0]]; expected[g][c] = 11 * 255;
    assert.deepEqual(sample.output.groups, expected, 'Fit only verified full-drive, isolated channels.');
  }
  return Math.round(median(samples.map(e => (e.currentMa - baseMa) / 11)));
}));
// A deliberately coarse allowance, not a statistical confidence interval:
// +25% and +1 mA/channel, rounded upward. Baseline reserve and 100 mA margin
// remain separate. This does NOT qualify operation above the measured envelope.
const conservative = coefficients.map(rgb => rgb.map(ma => Math.ceil(ma * 1.25 + 1)));
const validation = readings.filter(e => e.name !== 'off' && !trainingNames.includes(e.name)).map(e => {
  const predictedMa = estimateCurrent(baseMa, coefficients, e.output.groups);
  const conservativeMa = estimateCurrent(120, conservative, e.output.groups);
  assert.ok(e.currentMa <= conservativeMa + 100, 'Model plus margin underestimates a viewed validation point.');
  return {name: e.name, image: e.image, measuredMa: e.currentMa, voltage: e.voltage,
    outputSums: e.output.groups, predictedMa, residualMa: e.currentMa - predictedMa, conservativeMa};
});
const report = {
  method: 'Agent visually read each retained meter image; numerical baseline-plus-final-RGB-sums fit only.',
  input: eventsPath, build: '0x26100404', minimumHeldMs: 30000,
  baselineMa: {median: baseMa, min: Math.min(...baseline), max: Math.max(...baseline), samples: baseline},
  groupOrder: groups, channelOrder: colors, nominalMaPerFullChannel: coefficients,
  conservativeMaPerFullChannel: conservative, baselineReserveMa: 120, marginMa: 100,
  provisionalProductBudgetMa: 900, provisionalLedAllowanceMa: 680,
  validation, maxAbsoluteResidualMa: Math.max(...validation.map(v => Math.abs(v.residualMa))),
  measuredEnvelopeMa: [Math.min(...readings.map(e => e.currentMa)), Math.max(...readings.map(e => e.currentMa))],
  qualifiedFor900MaDeployment: false,
  limitations: ['10 mA display increments and variable baseline; no calibrated meter accuracy specification.',
    'Limited requests must use final transmitted sums, not requested 150/255 or 255/255.',
    'Sparse full drive measured; larger selections were limited. No full-load source/thermal qualification.',
    'No PCB temperature or transient-current measurement. Averages cannot prove peak-current safety.',
    'Broken LED 103 remains accounted for. Normal 900 mA profile must remain disabled until qualified.'],
};
const file = await open(outputPath, 'wx');
try {await file.writeFile(JSON.stringify(report, null, 2) + '\n');} finally {await file.close();}
console.log(JSON.stringify({baseMa, coefficients, conservative, validationPoints: validation.length,
  maxAbsoluteResidualMa: report.maxAbsoluteResidualMa, qualifiedFor900MaDeployment: false}));
