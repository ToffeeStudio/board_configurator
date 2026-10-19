import {useEffect, useRef, useState} from 'react';
import styled from 'styled-components';
import {DEBUG_ENABLED, FIRMWARE_PATH} from '../../config/debug';
import {chooseModule, fetchFirmware, grantedModules, FirmwareChoice, FirmwareConnection} from '../../utils/toffee_studio/firmware-update';
import {chooseBootloader, flashBrowserFirmware, grantedBootloader} from '../../utils/toffee_studio/firmware-webusb';
import {FirmwareRecovery, readRecoveries, saveRecovery} from '../../utils/toffee_studio/firmware-recovery';
import {BrowserUSB, PicobootDevice} from '../../utils/toffee_studio/picoboot';

const Page = styled.main`
  box-sizing: border-box; position: fixed; inset: 0; overflow: auto; z-index: 40;
  padding: 32px max(24px, calc((100vw - 1000px) / 2)); background: #0d0b13; color: #eee8fa;
  font: 16px/1.5 system-ui, sans-serif;
  h1 {font-size: 32px; margin-bottom: 8px;} h2 {font-size: 21px;}
  p {font-size: 16px;} small {font-size: 13px; color: #bcb0cc;}
  section {padding: 20px; margin: 20px 0; border: 1px solid #423650; border-radius: 12px; background: #17121f;}
  button, select {font: inherit; color: inherit; border: 1px solid #88749f; border-radius: 7px; padding: 10px 14px; background: #2b203b; margin: 6px 10px 6px 0; max-width: 100%;}
  button {cursor: pointer;} button:disabled {opacity: .45; cursor: not-allowed;}
  button:focus-visible, a:focus-visible, select:focus-visible {outline: 2px solid #cab1ff;}
  a {color: #cab1ff;} label {display: block; margin: 12px 0;} input {margin-right: 8px;}
  .warning {border-left: 4px solid #dbb665; padding-left: 14px; color: #f1d49f;}
  .status {white-space: pre-wrap; padding: 15px; border: 1px solid #88749f; border-radius: 8px;}
  code {overflow-wrap: anywhere;} progress {width: 100%; accent-color: #b59bdc;}
`;
function download(data: BlobPart, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([data], {type}));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
const pause = () => new Promise(resolve => setTimeout(resolve, 250));
export function FirmwareUpdate() {
  return DEBUG_ENABLED ? <FirmwareUpdateContent/> : <p>Debug mode is disabled.</p>;
}
function FirmwareUpdateContent() {
  const usb = (navigator as Navigator & {usb?: BrowserUSB}).usb;
  const [choices, setChoices] = useState<FirmwareChoice[]>([]);
  const [selected, setSelected] = useState('normal');
  const [backup, setBackup] = useState<FirmwareRecovery | null>(null);
  const [backups, setBackups] = useState<FirmwareRecovery[]>([]);
  const [image, setImage] = useState<Uint8Array | null>(null);
  const [phase, setPhase] = useState<'idle' | 'bootloader' | 'verify' | 'done' | 'failed'>('idle');
  const [busy, setBusy] = useState(false);
  const active = useRef(false), writeStarted = useRef(false);
  const [confirmed, setConfirmed] = useState(false);
  const [percent, setPercent] = useState<number | null>(null);
  const [message, setMessage] = useState('Choose firmware and press Update firmware. Nothing is sent automatically on page load.');
  const [error, setError] = useState(false);
  const choice = choices.find(entry => entry.id === selected);
  useEffect(() => {
    fetch('/firmware-downloads/manifest.json').then(async response => {
      if (!response.ok) throw new Error('Firmware catalogue unavailable.');
      const entries: FirmwareChoice[] = await response.json();
      if (entries.length !== 3 || entries.some(v => !['normal', 'manual', 'current-unlimited'].includes(v.id) ||
          v.file !== v.id + '.uf2' || !/^[0-9a-f]{64}$/.test(v.sha256) || ![2,3].includes(v.lightingProtocol)))
        throw new Error('Invalid firmware catalogue.');
      setChoices(entries);
    }).catch(failure => {setMessage(failure.message); setError(true);});
    readRecoveries().then(setBackups).catch(failure => {setMessage('Local recovery storage unavailable: ' + failure.message); setError(true);});
  }, []);
  useEffect(() => {
    if (!busy && phase !== 'bootloader' && phase !== 'verify') return;
    const warn = (event: BeforeUnloadEvent) => {event.preventDefault(); event.returnValue = '';};
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy, phase]);
  const run = async (operation: () => Promise<void>) => {
    if (active.current) return;
    active.current = true; setBusy(true); setError(false);
    try {await operation();}
    catch (failure) {
      setMessage((failure as Error).message); setError(true);
      console.error('Firmware updater:', (failure as Error).message);
    } finally {active.current = false; setBusy(false);}
  };
  const verify = async (device: HIDDevice, saved: FirmwareRecovery, justFlashed: boolean) => {
    if (!device.opened) await device.open();
    const next = new FirmwareConnection(device);
    try {
      setMessage('Checking firmware mode and 15 seconds of stable uptime…');
      await next.verify(saved.choice);
      setMessage('Restoring and checking your VIA keymap, macros and layout…');
      await next.restoreSettings(saved.settings);
      setPhase('done'); setPercent(100);
      setMessage(justFlashed ? 'Update complete. Firmware bytes and VIA settings verified. Please check normal typing.' :
        'VIA settings restored and verified. Firmware mode and uptime match; firmware bytes were not read back in this settings-only check.');
    } finally {await device.close();}
  };
  const flash = async (device: PicobootDevice, saved: FirmwareRecovery, bytes: Uint8Array) => {
    if (writeStarted.current) throw new Error('This update was already attempted. No automatic flash retry.');
    writeStarted.current = true;
    let preserved = saved;
    try {
      const result = await flashBrowserFirmware(device, bytes, saved.choice.sha256, async sectors => {
        preserved = {...saved, status: 'writing', serial: device.serialNumber, originalSectors: sectors};
        setMessage('Saving original firmware sectors locally before writing…');
        await saveRecovery(preserved); setBackup(preserved); setBackups(await readRecoveries());
      }, (stage, done, total) => {
        setPercent(Math.round(done * 100 / total));
        setMessage(({read: 'Backing up original firmware', write: 'Writing firmware', verify: 'Verifying firmware bytes'}[stage]) + `… ${done} / ${total} bytes`);
      });
      preserved = {...preserved, status: 'verified', verifiedBytes: result.verifiedBytes};
    } catch (failure) {
      setPhase('failed'); throw failure;
    }
    setPhase('verify'); setBackup(preserved);
    await saveRecovery(preserved); setBackups(await readRecoveries());
    setMessage('Firmware written and byte-verified. Waiting for Module to reconnect…');
    const until = Date.now() + 10000;
    while (Date.now() < until) {
      const modules = await grantedModules();
      if (modules.length > 1) throw new Error('More than one Module is connected. Reconnect only the updated PCB.');
      if (modules.length === 1) {await verify(modules[0], preserved, true); return;}
      await pause();
    }
    setMessage('Firmware bytes verified. Approve Module once more to verify settings after reboot.');
  };
  const start = () => run(async () => {
    // Request device permission in the click's activation, before other awaits.
    const device = await chooseModule();
    const next = new FirmwareConnection(device);
    try {
      setMessage('Validating selected firmware and preserving private VIA settings…');
      const bytes = await fetchFirmware(choice!);
      const saved: FirmwareRecovery = {id: crypto.randomUUID(), createdAt: new Date().toISOString(),
        choice: choice!, settings: await next.readSettings(), status: 'prepared', serial: null,
        originalSectors: null, verifiedBytes: null};
      await saveRecovery(saved); setBackup(saved); setBackups(await readRecoveries()); setImage(bytes);
      setPhase('bootloader'); setMessage('Requesting bootloader. Keep the same PCB connected…');
      try {await next.enterBootloader();}
      catch (failure) {setPhase('failed'); throw new Error('Bootloader request outcome uncertain: ' + (failure as Error).message + ' No automatic retry.');}
      const until = Date.now() + 4000;
      while (Date.now() < until) {
        const bootloader = await grantedBootloader(usb!);
        if (bootloader) {await flash(bootloader, saved, bytes); return;}
        await pause();
      }
      setMessage('Select RP2 Boot in the browser permission prompt to continue automatically. No files to copy.');
    } finally {if (device.opened) await device.close();}
  });
  return <Page>
    <a href="/">← Configurator</a>
    <h1>Module firmware update</h1>
    <p>Direct browser update. No Finder, file copying or Python installation.</p>
    <section>
      <h2>Choose firmware</h2>
      <select aria-label="Firmware version" value={selected} disabled={busy || phase !== 'idle'} onChange={e => setSelected(e.target.value)}>
        {choices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
      <p>{choice?.description}</p>
      {choice && choice.mode !== 'normal' && <p className="warning">No current limiting. Overload can disconnect the board. Use your physical meter.</p>}
      {choice && <small>SHA-256: <code>{choice.sha256}</code></small>}
      <label><input type="checkbox" checked={confirmed} disabled={busy || phase !== 'idle'} onChange={e => setConfirmed(e.target.checked)}/>
        Only the intended Module is connected. Keep this same PCB connected; close other board tabs and HID tools. Any selected recovery backup belongs to this PCB. I understand the selected mode.</label>
      <button disabled={busy || !choice || !confirmed || phase !== 'idle' || !navigator.hid || !usb} onClick={start}>Update firmware</button>
      <p><small>Approve Module and RP2 Boot if asked. The updater backs up, writes, verifies and reboots automatically. Do not unplug or close this page during an update.</small></p>
      {(!navigator.hid || !usb) && <p className="warning">This browser needs WebHID and WebUSB. Open in desktop Chrome/Edge on HTTPS or localhost. No hardware commands have been sent.</p>}
    </section>
    {phase === 'bootloader' && <section>
      <h2>Allow bootloader access</h2>
      <p>Select <strong>RP2 Boot</strong>, not a folder. Writing begins automatically after permission.</p>
      <button disabled={busy} onClick={() => run(async () => {
        const device = await chooseBootloader(usb!);
        await flash(device, backup!, image!);
      })}>Connect RP2 Boot & finish update</button>
    </section>}
    {phase === 'verify' && <section>
      <h2>Verify reconnected Module</h2>
      <button disabled={busy} onClick={() => run(async () => verify(await chooseModule(), backup!, writeStarted.current))}>Reconnect Module & verify</button>
      <p><small>This only checks/restores settings. It never flashes again.</small></p>
    </section>}
    <p className="status" role={error ? 'alert' : 'status'} aria-live="polite">{message}</p>
    {percent !== null && <progress aria-label="Firmware update progress" max={100} value={percent}/>}
    {phase === 'failed' && <p className="warning">Update stopped. No automatic retry. Your local recovery backup is retained below; an uncertain write is not reported as success.</p>}
    <section>
      <h2>Local recovery backups</h2>
      <p><small>Private keymaps/macros and original affected firmware sectors stay in this browser only. Nothing is uploaded. Backups survive reloads here; clearing site data removes them. This is not a full-device dump.</small></p>
      <select aria-label="Recovery backup" value={backup?.id || ''} disabled={busy || phase !== 'idle'} onChange={event => {
        const saved = backups.find(entry => entry.id === event.target.value);
        if (!saved) throw new Error('Select an existing recovery backup.');
        setBackup(saved);
      }}>
        <option value="" disabled>Select a backup</option>
        {backups.map(saved => <option key={saved.id} value={saved.id}>{new Date(saved.createdAt).toLocaleString()} · {saved.choice.name} · {saved.status}</option>)}
      </select>
      {backup && <>
        <button disabled={busy} onClick={() => download(JSON.stringify(backup.settings, null, 2), 'application/json', 'module-settings.json')}>Download private VIA backup</button>
        {backup.originalSectors && <button disabled={busy} onClick={() => download(backup.originalSectors!, 'application/octet-stream', `original-firmware-${backup.id}.bin`)}>Download original firmware sectors</button>}
        {phase === 'idle' && backup.status === 'verified' && <button disabled={busy || !confirmed} onClick={() => run(async () => {
          setPhase('verify'); await verify(await chooseModule(), backup, false);
        })}>Verify same PCB from this backup</button>}
      </>}
      <p><a href={FIRMWARE_PATH + '/'}>Start a new update</a></p>
      <details><summary>Optional native recovery tools</summary>
        <p><a href="/firmware-downloads/module-firmware-and-updater.zip" download>Download existing macOS recovery tools</a>. These are not needed for browser updates.</p>
      </details>
    </section>
  </Page>;
}
