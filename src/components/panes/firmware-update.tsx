import {useEffect, useRef, useState} from 'react';
import styled from 'styled-components';
import {DEBUG_ENABLED} from '../../config/debug';
import {chooseModule, fetchFirmware, FirmwareChoice, FirmwareConnection, validateSettings, ViaSettings} from '../../utils/toffee_studio/firmware-update';

const Page = styled.main`
  box-sizing: border-box; position: fixed; inset: 0; overflow: auto; z-index: 40;
  padding: 32px max(24px, calc((100vw - 1000px) / 2)); background: #0d0b13; color: #eee8fa;
  font: 16px/1.5 system-ui, sans-serif;
  h1 {font-size: 32px; margin-bottom: 8px;} h2 {font-size: 21px;}
  p {font-size: 16px;} small {font-size: 13px;}
  section {padding: 20px; margin: 20px 0; border: 1px solid #423650; border-radius: 12px; background: #17121f;}
  button, select {font: inherit; color: inherit; border: 1px solid #88749f; border-radius: 7px; padding: 10px 14px; background: #2b203b; margin: 6px 10px 6px 0;}
  button {cursor: pointer;} button:disabled {opacity: .45; cursor: not-allowed;}
  button:focus-visible, a:focus-visible, select:focus-visible {outline: 2px solid #cab1ff;}
  a {color: #cab1ff;} label {display: block; margin: 12px 0;} input {margin-right: 8px;}
  .warning {border-left: 4px solid #dbb665; padding-left: 14px; color: #f1d49f;}
  .status {white-space: pre-wrap; padding: 15px; border: 1px solid #88749f; border-radius: 8px;}
  small {color: #bcb0cc;} code {overflow-wrap: anywhere;}
`;
function download(data: BlobPart, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([data], {type}));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function FirmwareUpdate() {
  return DEBUG_ENABLED ? <FirmwareUpdateContent/> : <p>Debug mode is disabled.</p>;
}
function FirmwareUpdateContent() {
  const [choices, setChoices] = useState<FirmwareChoice[]>([]);
  const [selected, setSelected] = useState('normal');
  const [connection, setConnection] = useState<FirmwareConnection | null>(null);
  const [backup, setBackup] = useState<ViaSettings | null>(null);
  const [image, setImage] = useState<Uint8Array | null>(null);
  const [phase, setPhase] = useState<'prepare' | 'prepared' | 'bootloader' | 'done'>('prepare');
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const [confirmed, setConfirmed] = useState(false);
  const [backupSaved, setBackupSaved] = useState(false);
  const [sameBoard, setSameBoard] = useState(false);
  const [message, setMessage] = useState('Choose firmware. Nothing is sent to the PCB until you press a button.');
  const [error, setError] = useState(false);
  const choice = choices.find(entry => entry.id === selected);
  useEffect(() => {
    fetch('/firmware-downloads/manifest.json').then(async response => {
      if (!response.ok) throw new Error('Firmware catalogue unavailable.');
      const entries: FirmwareChoice[] = await response.json();
      if (entries.length !== 3 || entries.some(v => !['normal', 'manual', 'current-unlimited'].includes(v.id) ||
          v.file !== v.id + '.uf2' || !/^[0-9a-f]{64}$/.test(v.sha256) ||
          ![2,3].includes(v.lightingProtocol)))
        throw new Error('Invalid firmware catalogue.');
      setChoices(entries);
    }).catch(failure => {setMessage(failure.message); setError(true);});
  }, []);
  const run = async (operation: () => Promise<void>) => {
    if (active.current) return;
    active.current = true; setBusy(true); setError(false);
    try {await operation();}
    catch (failure) {
      const text = (failure as Error).message; setMessage(text); setError(true);
      console.error('Firmware updater:', text);
    } finally {active.current = false; setBusy(false);}
  };
  const prepare = () => run(async () => {
    // The chooser is invoked directly from the user's click, before fetch awaits.
    const device = await chooseModule();
    const next = new FirmwareConnection(device);
    setMessage('Validating firmware and reading private VIA backup…');
    const bytes = await fetchFirmware(choice!);
    const saved = await next.readSettings();
    setConnection(next); setBackup(saved); setImage(bytes); setPhase('prepared');
    setMessage('Ready. Download your backup and firmware before entering bootloader.');
  });
  const boot = () => run(async () => {
    setPhase('bootloader');
    setMessage('Requesting bootloader. Wait for RPI-RP2, then copy the selected UF2 once.');
    try {await connection!.enterBootloader();}
    catch (failure) {throw new Error('Bootloader request outcome uncertain: ' + (failure as Error).message +
      ' Check for RPI-RP2. Do not repeatedly send or copy.');}
  });
  const verify = () => run(async () => {
    const next = new FirmwareConnection(await chooseModule());
    setConnection(next); setMessage('Checking selected firmware and 15 seconds of stable VIA uptime…');
    await next.verify(choice!);
    setMessage('Verifying/restoring private VIA keymap, macros and layout…');
    await next.restoreSettings(backup!);
    setPhase('done'); setMessage('Expected firmware profile/mode and 15-second uptime verified. VIA backup matches. Please check typing. This is not a full flash readback or a cold-power test.');
    await next.device.close();
  });
  return <Page>
    <a href="/toffee-lighting">← Lighting</a> · <a href="/toffee-debug">Measurement checklist</a>
    <h1>Module firmware update</h1>
    <p>Debug tools · WebHID bootloader entry, UF2 copying and verified reconnection.</p>
    <section>
      <h2>1. Choose firmware</h2>
      <select aria-label="Firmware version" value={selected} disabled={busy || phase !== 'prepare'} onChange={e => setSelected(e.target.value)}>
        {choices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
      <p>{choice?.description}</p>
      {choice && choice.mode !== 'normal' && <p className="warning">No current limiting. Overload can disconnect the board. Use your physical meter.</p>}
      {choice && <small>SHA-256: <code>{choice.sha256}</code></small>}
      <label><input type="checkbox" checked={confirmed} disabled={busy || phase !== 'prepare'} onChange={e => setConfirmed(e.target.checked)}/>
        Only the intended Module is connected. Other board tabs, rescue scripts and HID tools are closed. I understand the selected mode.</label>
      <button disabled={busy || !choice || !confirmed || phase !== 'prepare' || !navigator.hid} onClick={prepare}>Connect & prepare backup</button>
      <button disabled={busy || !choice} onClick={() => run(async () => {
        const bytes = await fetchFirmware(choice!);
        download(bytes, 'application/octet-stream', choice!.file);
        setMessage('Verified UF2 downloaded. Downloading alone does not flash the PCB.');
      })}>Download selected UF2</button>
      {!navigator.hid && <p className="warning">WebHID is unavailable here. Open this page in desktop Chrome/Edge on HTTPS or localhost, or use the native updater.</p>}
    </section>
    {backup && <section>
      <h2>2. Preserve settings & enter bootloader</h2>
      <button disabled={busy} onClick={() => download(JSON.stringify(backup, null, 2), 'application/json', 'module-settings.json')}>Download private VIA backup</button>
      {image && <button disabled={busy} onClick={() => download(image, 'application/octet-stream', choice!.file)}>Download prepared UF2</button>}
      <p><small>The backup contains keymap, macros and layout—not a firmware dump or lighting backup. Keep it private. These versions retain existing on-board lighting storage.</small></p>
      <label><input type="checkbox" checked={backupSaved} disabled={busy} onChange={e => setBackupSaved(e.target.checked)}/>My backup and selected UF2 are downloaded.</label>
      <button disabled={busy || !backupSaved || phase !== 'prepared' || !connection} onClick={boot}>Enter bootloader</button>
    </section>}
    {(phase === 'bootloader' || phase === 'done') && <section>
      <h2>3. Copy once, then reconnect</h2>
      <p>Drag <strong>{choice?.file}</strong> onto the <strong>RPI-RP2</strong> drive. It should disappear as the board restarts. Do not copy again on an uncertain result.</p>
      <p><small>If it does not appear, stop here. Application HID needs responsive firmware; use the board’s physical boot/reset procedure or the native updater. The browser cannot verify physical USB location/bootloader serial.</small></p>
      <label><input type="checkbox" checked={sameBoard} disabled={busy} onChange={e => setSameBoard(e.target.checked)}/>The UF2 copy finished; this is the same physical PCB whose backup I downloaded.</label>
      <button disabled={busy || !sameBoard || phase === 'done'} onClick={verify}>Reconnect, verify & restore VIA</button>
    </section>}
    <p className="status" role={error ? 'alert' : 'status'} aria-live="polite">{message}</p>
    <section>
      <h2>Native updater & recovery</h2>
      <a href="/firmware-downloads/module-firmware-and-updater.zip" download>Download Python updater + all three UF2s (macOS)</a>
      <p><a href="/firmware-downloads/flash_module.py" download>Python script</a> · <a href="/firmware-downloads/led_discovery.py" download>Required companion module</a> · <a href="/firmware-downloads/README.txt" download>Instructions</a></p>
      <p><small>The zip includes dependencies list and SHA-256 manifest. Native updater checks an explicitly supplied USB location and RP2 serial, archives VIA settings and copies the UF2. Both approaches need responsive application firmware to enter bootloader by HID.</small></p>
      {phase === 'prepare' && <label>Already copied a UF2, or reloaded this page? Select that version above and import its pre-flash VIA backup.
        <input type="file" accept=".json,application/json" disabled={busy || !choice || !confirmed} onChange={event => {
          const file = event.target.files?.[0]; if (!file) return;
          void run(async () => {
            const saved = validateSettings(JSON.parse(await file.text()));
            setBackup(saved); setPhase('bootloader'); setMessage('Backup loaded. Reconnect the same physical PCB to verify the selected firmware before restoring.');
          });
        }}/>
      </label>}
      <p><a href="/toffee-firmware">Start a new update</a> (download your backup first)</p>
    </section>
  </Page>;
}
