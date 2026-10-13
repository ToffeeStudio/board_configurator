import {useEffect, useMemo, useRef, useState} from 'react';
import styled from 'styled-components';
import {DEBUG_ENABLED} from '../../config/debug';
import {ToffeeHIDDevice, ToffeeLightingAPI} from '../../utils/toffee_studio/hid';
import {allOff, appendReading, BASELINE, ALL_CHECKLIST, debugCommand, loadReadings,
  MIXED_BUILDS, manualStatus, meterValues, mixedPayload, Preset, rawPayload, Reading, readingsCSV,
  readingsJSON, Sample, verifyPreset, READINGS_KEY} from '../../utils/toffee_studio/manual-measurement';
import {PowerDebug} from './power-debug';

const Page = styled.div`
  height: 100%; overflow-y: auto; padding: 0 28px 28px; box-sizing: border-box;
  background: #0c0b12; color: #eeeaf7; position: relative; z-index: 4;
  font-size: 15px; line-height: 1.5;
  h1 {font-size: 28px; margin: 0 0 4px;} h2 {font-size: 18px; margin: 0 0 12px;}
  p {margin: 6px 0 14px; font-size: 15px;} small {color: #b7b0c8;}
  .toolbar {position: sticky; top: 0; z-index: 2; background: #0c0b12; padding: 20px 0 12px; border-bottom: 1px solid #383144;}
  section.card {border: 1px solid #383144; border-radius: 12px; padding: 20px; margin: 16px 0; background: #14111e;}
  .row {display: flex; gap: 10px; flex-wrap: wrap; align-items: center;}
  .warning {color: #ffd99a; border-left: 3px solid #dfaa53; padding: 8px 12px; background: #282014;}
  .error {color: #ffb9b9; padding: 12px; border: 1px solid #944d56; border-radius: 8px;}
  button, input {font: inherit; color: inherit; border: 1px solid #595065; border-radius: 7px; background: #221b30; padding: 9px 12px;}
  input {background: #0e0b15; box-sizing: border-box;}
  label {display: block; margin: 10px 0;} label span {display: block; margin-bottom: 5px;}
  button {cursor: pointer;} button:hover:not(:disabled) {border-color: #bea0ff; background: #473266;}
  button:disabled {opacity: .42; cursor: not-allowed;}
  button.primary {background: #6745a0; border-color: #a284d4; font-weight: 600;}
  button.stop {background: #572633; border-color: #dc8194; font-weight: 700; padding: 12px 20px;}
  button:focus-visible, input:focus-visible {outline: 2px solid #d0b9ff; outline-offset: 3px;}
  .table-scroll {overflow-x: auto;} table {border-collapse: collapse; width: 100%; text-align: left;}
  table[aria-label="Fixed measurement states"] td:nth-child(2) {min-width: 280px;}
  a {color: #c4a6ff;}
  th, td {padding: 12px; border-bottom: 1px solid #393143; vertical-align: middle;}
  th {color: #bfb2d6; font-weight: 500;} td small {display: block;}
  tr.active {background: #2e223e;} .measurement input {width: 110px;}
  .nowrap {white-space: nowrap;} .summary {color: #cabcdf;}
  @media(max-width: 1050px) {padding: 0 16px 16px; .toolbar {padding-top: 16px;} h1 {font-size: 24px;}}
`;
type Props = {device: HIDDevice | null; onConnect: () => void};
type Applied = {preset: Preset; sample: Sample; at: string; pcb: string};
const groupName = {front: 'Front', rear: 'Rear', badge: 'Badge', all: 'All LEDs'};
const STATES = [BASELINE, ...ALL_CHECKLIST];

function StateRow({number, value, active, busy, canApply, latest, canRecord, onApply, onRecord}: {
  number: number; value: Preset; active: boolean; busy: boolean; canApply: boolean;
  latest: Reading | undefined; canRecord: boolean; onApply: () => void; onRecord: (amps: string) => void;
}) {
  const [amps, setAmps] = useState('');
  useEffect(() => {setAmps('');}, [active, latest?.id]);
  return <tr id={number === 121 ? 'mixed-colour-states' : number === 146 ? 'higher-current-states' : undefined} style={{scrollMarginTop: 150}}
    data-testid={'state-' + number} className={active ? 'active' : ''} aria-current={active ? 'step' : undefined}>
    <td>{number === 0 ? 'Base' : String(number).padStart(3, '0')}</td>
    <td>{'groups' in value ? <><b>{number >= 146 ? 'Higher current' : 'Mixed colours'} · {number - 120}</b>{value.groups.map(group =>
      <small key={group.group}><span aria-hidden="true" style={{display: 'inline-block', width: 10, height: 10,
        marginRight: 6, background: `rgb(${group.rgb.join(',')})`, border: '1px solid #888'}}/>
        {groupName[group.group]} · {group.colour} · {group.level}/255 · RGB {group.rgb.join('/')}</small>)}</> :
      <><b>{number === 0 ? 'All off / baseline' : groupName[value.group] + ' · ' + value.colour}</b>
      <small>{value.count} LEDs · {value.level}/255 · RGB {value.rgb.join('/')}</small></>}</td>
    <td><button className={active ? 'primary' : ''} aria-label={'Apply state ' + number}
      disabled={!canApply} onClick={onApply}>{active ? 'Applied' : 'Apply'}</button></td>
    <td><form className="row measurement" onSubmit={event => {event.preventDefault(); onRecord(amps);}}>
      <input aria-label={'Amps for state ' + number} type="number" inputMode="decimal" min="0" step="any" required
        placeholder="0.320 A" value={amps} disabled={!active || busy}
        onChange={event => setAmps(event.target.value)}/>
      <button aria-label={'Save state ' + number} type="submit" disabled={!active || busy || !canRecord}>Save</button>
      {amps.trim() && Number(amps) >= 1 && <small>At/above 1 A — stop increasing.</small>}
    </form></td>
    <td className="nowrap">{latest ? <><b>✓ {latest.amps.toFixed(3)} A</b><small>{new Date(latest.at).toLocaleTimeString()}</small></> : '—'}</td>
  </tr>;
}

export function ManualMeasurement(props: Props) {
  return DEBUG_ENABLED ? <MeasurementContent {...props}/> : <p>Debug mode is disabled.</p>;
}
function MeasurementContent({device, onConnect}: Props) {
  const link = useMemo(() => {
    if (!device) return null;
    const hid = new ToffeeHIDDevice(device);
    return {hid, api: new ToffeeLightingAPI(hid)};
  }, [device]);
  const [pcb, setPcb] = useState('');
  const [ready, setReady] = useState<Awaited<ReturnType<typeof manualStatus>> | null>(null);
  const [applied, setApplied] = useState<Applied | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [readings, setReadings] = useState<Reading[]>([]);
  const [storageError, setStorageError] = useState('');
  const operation = useRef(0), locked = useRef(false);
  useEffect(() => {
    const refresh = () => {
      try {setReadings(loadReadings(localStorage)); setStorageError('');}
      catch (failure) {setStorageError(String(failure));}
    };
    const changed = (event: StorageEvent) => {if (event.key === READINGS_KEY || event.key === null) refresh();};
    refresh(); window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  useEffect(() => {
    operation.current++; locked.current = false;
    setReady(null); setApplied(null); setBusy(false); setPcb(''); setError(''); setNotice('');
    const disconnected = (event: HIDConnectionEvent) => {
      if (event.device !== device) return;
      operation.current++; locked.current = false;
      setReady(null); setApplied(null); setPcb(''); setBusy(false); setNotice('');
      setError('Board disconnected. Reconnect, check firmware and enter the PCB label again.');
    };
    navigator.hid?.addEventListener('disconnect', disconnected);
    return () => {operation.current++; navigator.hid?.removeEventListener('disconnect', disconnected);};
  }, [device]);
  // Stop invalidates unfinished page work; a cancelled action cannot queue raw RGB.
  async function run(job: (current: () => boolean) => Promise<void>, interrupt = false) {
    if (locked.current && !interrupt) return;
    const id = ++operation.current;
    locked.current = true; setBusy(true); setError(''); setNotice('');
    const current = () => id === operation.current;
    try {await job(current);}
    catch (failure) {if (current()) {setError(String(failure)); console.error('Manual measurement:', failure);}}
    finally {if (current()) {locked.current = false; setBusy(false);}}
  }
  const check = () => run(async current => {
    if (!link) throw new Error('Connect a board first.');
    setReady(null); setApplied(null);
    const status = await manualStatus(link.hid, link.api);
    if (current()) {setReady(status); setNotice('Unlimited firmware verified. Apply the baseline, then work down the list.');}
  });
  const stop = () => run(async current => {
    if (!link) throw new Error('No connected board to send all-off to.');
    setApplied(null);
    await allOff(link.hid);
    if (!current()) return;
    setNotice('All-off acknowledged. Saved lighting was not changed.');
    if (ready && pcb.trim()) {
      await new Promise(resolve => setTimeout(resolve, 120));
      const sample = await verifyPreset(link.hid, link.api, BASELINE);
      if (current()) setApplied({preset: BASELINE, sample, at: new Date().toISOString(), pcb: pcb.trim()});
    }
  }, true);
  const apply = (value: Preset) => run(async current => {
    if (!link || !ready) throw new Error('Check the matching manual firmware first.');
    if (!pcb.trim()) throw new Error('Enter a PCB identifier before applying a state.');
    const pcbLabel = pcb.trim();
    setApplied(null);
    const status = await manualStatus(link.hid, link.api);
    if ('groups' in value && !MIXED_BUILDS.includes(status.build))
      throw new Error('Mixed-colour states require unlimited build 0x26101001 or 0x26101002.');
    if (!current()) return;
    await allOff(link.hid);
    if (!current()) return;
    if ('groups' in value) await debugCommand(link.hid, 0x8c, mixedPayload(value));
    else if (value.level > 0) await debugCommand(link.hid, 0x8a, rawPayload(value));
    if (!current()) return;
    await new Promise(resolve => setTimeout(resolve, 120));
    const sample = await verifyPreset(link.hid, link.api, value);
    if (!current()) return;
    setApplied({preset: value, sample, at: new Date().toISOString(), pcb: pcbLabel});
    setNotice('Applied. Read your meter, enter amps on that row and save. Nothing advances automatically.');
  });
  const record = (value: Preset, amps: string) => run(async current => {
    if (!link || !applied || applied.pcb !== pcb.trim() || applied.preset.key !== value.key)
      throw new Error('Apply this state for the current PCB before recording.');
    const meter = meterValues(amps, '');
    const sample = await verifyPreset(link.hid, link.api, value);
    if (!current()) return;
    const row: Reading = {id: crypto.randomUUID(), pcb: applied.pcb, at: new Date().toISOString(),
      appliedAt: applied.at, ...meter, notes: '', preset: value, sample};
    setReadings(appendReading(localStorage, row));
    setNotice('Recorded ' + meter.amps.toFixed(3) + ' A for ' + row.pcb + '. Apply the next row when ready.');
  });
  const download = (format: 'json' | 'csv') => {
    try {
      const rows = loadReadings(localStorage);
      const text = format === 'json' ? readingsJSON(rows) : readingsCSV(rows);
      const url = URL.createObjectURL(new Blob([text], {type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8'}));
      const anchor = document.createElement('a'); anchor.href = url;
      anchor.download = 'toffee-current-readings-' + new Date().toISOString().slice(0, 10) + '.' + format;
      anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {setStorageError(String(failure));}
  };
  const canApply = Boolean(ready && pcb.trim() && !busy);
  const latest = new Map(readings.filter(row => row.pcb === pcb.trim()).map(row => [row.preset.key, row]));
  const complete = ALL_CHECKLIST.filter(value => latest.has(value.key)).length;
  const active = applied?.pcb === pcb.trim() ? applied : null;
  return <Page>
    <header className="toolbar">
      <div className="row" style={{justifyContent: 'space-between'}}>
        <div><h1>Lighting measurement checklist</h1><small>150 fixed states + baseline · 120 original + 30 mixed-colour · Apply → enter amps → Save</small></div>
        <button className="stop" onClick={stop} disabled={!link}>All off</button>
      </div>
      <div className="row" style={{justifyContent: 'space-between'}}>
        <span data-testid="checklist-progress">{complete} / {ALL_CHECKLIST.length} recorded{pcb.trim() ? ' for ' + pcb.trim() : ' — enter a PCB label'}</span>
        <small data-testid="manual-applied">{active ? active.preset.key + ' · output verified' : 'No verified state applied.'}</small>
      </div>
    </header>
    <p className="warning">No current limiter or timeout. Preset estimates are not safe-current guarantees. Watch your meter; skip higher states if near 1 A or unstable. Closing the page leaves output on.</p>
    <section className="card">
      <div className="row">
        <b>{device ? device.productName || 'Selected Module' : 'No board selected'}</b>
        <button onClick={onConnect} disabled={busy}>Connect / change board</button>
        <button onClick={check} disabled={!link || busy}>Check firmware</button>
        <span data-testid="manual-firmware">{ready ? 'Unlimited · 0x' + ready.build.toString(16) + ' · test changes not saved' : 'Manual test firmware required · latest: 0x26101002'}</span>
      </div>
      {ready && !MIXED_BUILDS.includes(ready.build) && <small>Rows 121–150 require mixed-colour test firmware (0x26101001 or 0x26101002). Original rows remain available.</small>}
      <label><span>PCB identifier</span><input style={{width: '100%'}} placeholder="e.g. PCB-A / PCB-B" value={pcb} disabled={busy}
        onChange={event => {setPcb(event.target.value); setApplied(null);}} maxLength={100}/></label>
      <small>Use the same label to resume. Use a different label for each physical PCB; the same rows make the comparison repeatable. Only one lighting controller/tab at a time.</small>
      <p><small><strong>PCB-B note:</strong> One front LED is broken and reported not to draw current. Front and All LEDs presets still address every mapped position; account for this when comparing boards.</small></p>
    </section>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {storageError && <p role="alert" className="error">Storage error: {storageError} Existing data is untouched.</p>}
    <section className="card">
      <div className="row" style={{justifyContent: 'space-between'}}>
        <h2>Work down the list</h2>
        <div className="row"><button onClick={() => download('csv')} disabled={!readings.length || Boolean(storageError)}>Export CSV</button>
          <button onClick={() => download('json')} disabled={!readings.length || Boolean(storageError)}>Export JSON</button></div>
      </div>
      <p><small>Rows 1–145 are unchanged. Rows 146–150 add higher-current mixed colours, targeting roughly 0.90–0.98 A by the fitted model—not measured guarantees. Stop increasing if your meter reaches 1 A. Saving verifies actual RGB output.</small></p>
      <div className="row"><a href="#mixed-colour-states">Jump to 30 mixed-colour cases ↓</a>
        <a href="#higher-current-states">Jump to 5 higher-current cases ↓</a></div>
      <div className="table-scroll"><table aria-label="Fixed measurement states">
        <thead><tr><th>#</th><th>Fixed state</th><th>Apply</th><th>Observed amps</th><th>Last saved for this PCB</th></tr></thead>
        <tbody>{STATES.map((value, number) => <StateRow key={value.key} number={number} value={value}
          active={active?.preset.key === value.key} busy={busy} canApply={canApply && (!('groups' in value) || Boolean(ready && MIXED_BUILDS.includes(ready.build)))} latest={latest.get(value.key)}
          canRecord={!storageError} onApply={() => {void apply(value);}} onRecord={amps => {void record(value, amps);}}/>)}</tbody>
      </table></div>
    </section>
    <PowerDebug device={device}/>
    <section className="card">
      <h2>Recorded measurements · {readings.length}</h2>
      <p><small>All readings, including repeats and earlier custom presets, remain stored in this browser at this exact localhost address. Export CSV/JSON to compare PCBs and back up before clearing browser data. New checklist entries contain amps only; older optional voltage/notes remain in exports.</small></p>
      <div className="table-scroll"><table aria-label="Saved measurements"><thead><tr><th>PCB</th><th>Preset</th><th>Measured A</th><th>Recorded</th></tr></thead>
        <tbody>{readings.slice().reverse().map(row => <tr key={row.id}><td>{row.pcb}</td><td>{row.preset.key}</td>
          <td>{row.amps.toFixed(3)}</td><td className="nowrap">{new Date(row.at).toLocaleString()}</td></tr>)}</tbody></table></div>
    </section>
  </Page>;
}
