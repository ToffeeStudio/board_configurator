export type MeterText = {text: string; confidence: number};

// Units are mandatory. Never guess a decimal point or repair an OCR digit.
export function readMeter(rows: MeterText[]) {
  const values = (unit: string) => rows.flatMap(row => [...row.text.matchAll(
    new RegExp(`(?:^|\\s)([0-9]+\\s*\\.\\s*[0-9]\\s*[0-9])\\s*${unit}(?=\\s|$)`, 'gi'),
  )].map(match => ({value: Number(match[1].replace(/\s/g, '')), confidence: row.confidence})));
  const current = values('A'), voltage = values('V');
  if (current.length !== 1 || voltage.length !== 1 || current[0].confidence < 0.9 || voltage[0].confidence < 0.9)
    throw new Error('Meter OCR needs exactly one confident decimal A and V reading.');
  return {currentMa: Math.round(current[0].value * 1000), voltage: voltage[0].value};
}

export function checkMeter(meter: {currentMa: number; voltage: number}) {
  if (!Number.isFinite(meter.currentMa) || meter.currentMa < 0 || meter.currentMa >= 450)
    throw new Error('Stop: low-drive campaign current outside 0–449 mA.');
  if (!Number.isFinite(meter.voltage) || meter.voltage < 4.75 || meter.voltage > 5.5)
    throw new Error('Stop: meter voltage outside 4.75–5.50 V.');
}

export function parseRgbSums(data: Uint8Array) {
  if (data.length !== 25 || data[0] !== 1 || data[1] !== 1 || data[24] !== 0)
    throw new Error('Missing or malformed final-output RGB telemetry.');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const ageMs = view.getUint16(4, true);
  if (ageMs >= 500) throw new Error('Final-output RGB telemetry is stale.');
  const counts = [66, 22, 16];
  const groups = counts.map((count, group) => Array.from({length: 3}, (_, color) => {
    const sum = view.getUint16(6 + (group * 3 + color) * 2, true);
    if (sum > count * 18) throw new Error('Final-output RGB sum exceeds test cap.');
    return sum;
  }));
  return {frame: view.getUint16(2, true), ageMs, groups};
}
