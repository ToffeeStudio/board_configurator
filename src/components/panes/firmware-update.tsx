import {useEffect, useRef, useState} from 'react';
import styled from 'styled-components';
import {DEBUG_ENABLED, FIRMWARE_PATH} from '../../config/debug';
import {chooseModule, fetchFirmware, grantedModules, FirmwareChoice, FirmwareConnection} from '../../utils/toffee_studio/firmware-update';
import {chooseBootloader, flashBrowserFirmware, grantedBootloader} from '../../utils/toffee_studio/firmware-webusb';
import {FirmwareRecovery, readRecoveries, recoveryHash, saveRecovery} from '../../utils/toffee_studio/firmware-recovery';
import {BrowserUSB, FLASH_BASE, PicobootDevice, usbStep} from '../../utils/toffee_studio/picoboot';

const Page = styled.main`
  box-sizing: border-box; position: fixed; inset: 0; overflow: auto; z-index: 40;
  padding: 28px max(24px, calc((100vw - 640px) / 2)); background: #0d0b13; color: #eee8fa;
  font: 16px/1.5 system-ui, sans-serif;
  h1 {font-size: 30px; margin: 24px 0 8px;}
  p {font-size: 16px;} small {font-size: 13px; color: #bcb0cc;}
  section {padding: 24px; margin: 20px 0; border: 1px solid #423650; border-radius: 12px; background: #17121f;}
  button, select {font: inherit; color: inherit; border: 1px solid #88749f; border-radius: 7px; padding: 10px 14px; background: #2b203b; margin: 6px 10px 6px 0; max-width: 100%;}
  button {cursor: pointer; width: 100%; background: #c8aff0; color: #241632; font-weight: 650; margin: 12px 0 0;}
  button:disabled {opacity: .6; cursor: not-allowed;}
  button:focus-visible, a:focus-visible, select:focus-visible, summary:focus-visible {outline: 2px solid #cab1ff; outline-offset: 3px;}
  select {width: 100%; margin: 6px 0 0;} a {color: #cab1ff;} label {display: block; margin: 0;}
  .warning {border-left: 4px solid #dbb665; padding-left: 14px; color: #f1d49f;}
  .status {white-space: pre-wrap; margin: 14px 0 0;}
  .support {margin-top: 20px; border-top: 1px solid #423650; padding-top: 16px;}
  summary {cursor: pointer; color: #bcb0cc;} .exports a {display: block; margin: 12px 0;}
  code {overflow-wrap: anywhere;} progress {width: 100%; accent-color: #b59bdc;}
`;
const pause = () => new Promise(resolve => setTimeout(resolve, 250));
export function FirmwareUpdate() {
  return DEBUG_ENABLED ? <FirmwareUpdateContent/> : <p>Debug mode is disabled.</p>;
}
function FirmwareUpdateContent() {
  const usb = (navigator as Navigator & {usb?: BrowserUSB}).usb;
  const recovery = new URLSearchParams(location.search).has('recovery');
  const [choices, setChoices] = useState<FirmwareChoice[]>([]);
  const [selected, setSelected] = useState('normal');
  const [backup, setBackup] = useState<FirmwareRecovery | null>(null);
  const [backups, setBackups] = useState<FirmwareRecovery[]>([]);
  const [recoverySelection, setRecoverySelection] = useState('');
  const [recoveryConnection, setRecoveryConnection] = useState('bootloader');
  const [confirmed, setConfirmed] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [ownsPage, setOwnsPage] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'bootloader' | 'verify' | 'done' | 'failed'>('idle');
  const [busy, setBusy] = useState(false);
  const active = useRef(false), writeStarted = useRef(false);
  const actionButton = useRef<HTMLButtonElement>(null);
  const [exports, setExports] = useState<{settings: string | null; sectors: string | null} | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [message, setMessage] = useState(recovery ? 'Reconnect the same keyboard, then select its saved update.' : 'Your settings are backed up before the update.');
  const [error, setError] = useState(false);
  const choice = recovery && backup ? backup.choice : choices.find(entry => entry.id === selected);
  useEffect(() => {
    let release: (() => void) | undefined, cancelled = false;
    if (!navigator.locks) {setMessage('This browser needs Web Locks. Use current desktop Chrome or Edge.'); setError(true); return;}
    void navigator.locks.request('module-firmware-update', {ifAvailable: true}, lock => {
      if (cancelled) return;
      if (!lock) {setMessage('Another update page is open. Close it, then reload this page.'); setError(true); return;}
      setOwnsPage(true);
      return new Promise<void>(resolve => {release = resolve;});
    }).catch(failure => {setMessage(failure.message); setError(true);});
    return () => {cancelled = true; release?.();};
  }, []);
  useEffect(() => {
    fetch('/firmware-downloads/manifest.json').then(async response => {
      if (!response.ok) throw new Error('Firmware catalogue unavailable.');
      const entries: FirmwareChoice[] = await response.json();
      if (entries.length !== 3 || entries.some(v => !['normal', 'manual', 'current-unlimited'].includes(v.id) ||
          v.file !== v.id + '.uf2' || !/^[0-9a-f]{64}$/.test(v.sha256) || ![2,3].includes(v.lightingProtocol)))
        throw new Error('Invalid firmware catalogue.');
      setChoices(entries);
    }).catch(failure => {setMessage(failure.message); setError(true);});
    readRecoveries().then(saved => {setBackups(saved); setStorageReady(true);})
      .catch(failure => {setMessage('Local recovery storage unavailable: ' + failure.message); setError(true);});
  }, []);
  useEffect(() => {
    if (!busy && phase !== 'bootloader' && phase !== 'verify') return;
    const warn = (event: BeforeUnloadEvent) => {event.preventDefault(); event.returnValue = '';};
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy, phase]);
  useEffect(() => {
    if (!busy && (phase === 'bootloader' || phase === 'verify')) {
      actionButton.current!.focus({preventScroll: true});
      actionButton.current!.scrollIntoView({block: 'nearest'});
    }
  }, [busy, phase]);
  useEffect(() => {
    if (!backup) return;
    const settings = backup.settings ? URL.createObjectURL(new Blob([JSON.stringify(backup.settings, null, 2)], {type: 'application/json'})) : null;
    const sectors = backup.originalSectors ? URL.createObjectURL(new Blob([backup.originalSectors], {type: 'application/octet-stream'})) : null;
    setExports({settings, sectors});
    return () => {if (settings) URL.revokeObjectURL(settings); if (sectors) URL.revokeObjectURL(sectors);};
  }, [backup]);
  const run = async (operation: () => Promise<void>) => {
    if (active.current) return;
    active.current = true; setBusy(true); setError(false);
    try {await operation();}
    catch (failure) {
      setMessage((failure as Error).message); setError(true);
      console.error('Firmware updater:', (failure as Error).message);
    } finally {active.current = false; setBusy(false);}
  };
  const verify = async (device: HIDDevice, saved: FirmwareRecovery) => {
    if (!['verified', 'complete'].includes(saved.status)) throw new Error('Firmware bytes must be verified before restoring settings.');
    if (!device.opened) await usbStep(device.open(), 'keyboard open');
    const next = new FirmwareConnection(device);
    try {
      setMessage('Checking firmware mode and 15 seconds of stable uptime…');
      await next.verify(saved.choice);
      if (saved.settings) {
        setMessage('Restoring and checking your VIA keymap, macros and layout…');
        await next.restoreSettings(saved.settings);
      }
      const completed: FirmwareRecovery = {...saved, status: 'complete'};
      await saveRecovery(completed); setBackup(completed); setBackups(await readRecoveries());
      setPhase('done'); setPercent(100);
      setMessage(saved.settings ? 'Update complete. Firmware bytes and VIA settings verified. Please check normal typing.' :
        'Firmware recovered and keyboard checks passed. No saved VIA backup was available; check your keymap and normal typing.');
    } finally {await usbStep(device.close(), 'keyboard close').catch(failure => console.warn('Keyboard cleanup:', failure.message));}
  };
  const flash = async (device: PicobootDevice, saved: FirmwareRecovery, bytes: Uint8Array) => {
    if (writeStarted.current) throw new Error('This update was already attempted. No automatic flash retry.');
    writeStarted.current = true;
    let preserved = saved;
    try {
      await flashBrowserFirmware(device, bytes, saved.choice.sha256,
        saved.originalSectors ? {serial: saved.serial!, sectors: saved.originalSectors} : null, async sectors => {
        preserved = {...saved, status: 'writing', serial: device.serialNumber, originalSectors: sectors,
          originalSha256: await recoveryHash(sectors)};
        setMessage('Saving original firmware sectors locally before writing…');
        await saveRecovery(preserved); setBackup(preserved); setBackups(await readRecoveries());
      }, async verifiedBytes => {
        preserved = {...preserved, status: 'verified', verifiedBytes};
        setMessage('Saving verified result before restarting the keyboard…');
        await saveRecovery(preserved); setBackup(preserved); setBackups(await readRecoveries());
      }, (stage, done, total) => {
        setPercent(Math.round(done * 100 / total));
        setMessage(({read: 'Reading current firmware', write: 'Writing firmware', verify: 'Verifying firmware bytes'}[stage]) + `… ${done} / ${total} bytes`);
      });
    } catch (failure) {
      setPhase('failed'); throw failure;
    }
    setPhase('verify'); setBackup(preserved); setPercent(null);
    setMessage('Firmware written and byte-verified. Waiting for Module to reconnect…');
    const until = Date.now() + 10000;
    while (Date.now() < until) {
      const modules = await grantedModules();
      if (modules.length > 1) throw new Error('More than one Module is connected. Reconnect only the updated PCB.');
      if (modules.length === 1) {await verify(modules[0], preserved); return;}
      await pause();
    }
    setMessage('Firmware installed. Click Reconnect keyboard and select Module to finish checking your settings.');
  };
  const start = () => run(async () => {
    // Request device permission in the click's activation, before other awaits.
    const device = await chooseModule();
    const next = new FirmwareConnection(device);
    try {
      setMessage('Validating selected firmware and preserving private VIA settings…');
      const bytes = await fetchFirmware(choice!);
      const saved: FirmwareRecovery = {version: 2, id: crypto.randomUUID(), createdAt: new Date().toISOString(),
        choice: choice!, settings: await next.readSettings(), status: 'prepared', serial: null,
        targetImage: bytes, flashBase: FLASH_BASE, originalSectors: null, originalSha256: null, verifiedBytes: null};
      await saveRecovery(saved); setBackup(saved); setBackups(await readRecoveries());
      setPhase('bootloader'); setMessage('Requesting bootloader. Keep the same PCB connected…');
      try {await next.enterBootloader();}
      catch (failure) {setPhase('failed'); throw new Error('Bootloader request outcome uncertain: ' + (failure as Error).message + ' No automatic retry.');}
      const until = Date.now() + 4000;
      while (Date.now() < until) {
        const bootloader = await grantedBootloader(usb!);
        if (bootloader) {await flash(bootloader, saved, bytes); return;}
        await pause();
      }
      setMessage('Keyboard is in update mode; typing and lighting are paused. Click Allow bootloader access and select RP2 Boot. The update then continues automatically.');
    } finally {if (device.opened) await usbStep(device.close(), 'keyboard close').catch(failure => console.warn('Keyboard cleanup:', failure.message));}
  });
  const recover = () => run(async () => {
    if (recoveryConnection === 'keyboard') {
      setPhase('verify');
      await verify(await chooseModule(), backup!);
      return;
    }
    // The chooser must run in this click, before fetching or reading storage.
    const device = await chooseBootloader(usb!);
    let saved = backup;
    if (!saved) {
      const bytes = await fetchFirmware(choice!);
      saved = {version: 2, id: crypto.randomUUID(), createdAt: new Date().toISOString(), choice: choice!,
        settings: null, status: 'prepared', serial: null, targetImage: bytes, flashBase: FLASH_BASE,
        originalSectors: null, originalSha256: null, verifiedBytes: null};
    } else if (!saved.targetImage) {
      setMessage('This older backup needs the exact original release. Checking its saved SHA-256…');
      saved = {...saved, targetImage: await fetchFirmware(saved.choice)};
    }
    await saveRecovery(saved); setBackup(saved); setBackups(await readRecoveries());
    setPhase('bootloader');
    await flash(device, saved, saved.targetImage!);
  });
  const advance = () => {
    if (phase === 'idle') return recovery ? recover() : start();
    if (phase === 'bootloader') return run(async () => {
      const device = await chooseBootloader(usb!);
      await flash(device, backup!, backup!.targetImage!);
    });
    if (phase === 'verify') return run(async () => verify(await chooseModule(), backup!));
  };
  const buttonLabel = busy ? (phase === 'idle' ? 'Preparing update…' : phase === 'verify' ? 'Checking keyboard…' : 'Updating firmware…') :
    {idle: recovery ? 'Recover keyboard' : 'Update firmware', bootloader: 'Allow bootloader access', verify: 'Reconnect keyboard', done: 'Firmware updated', failed: 'Update stopped'}[phase];
  return <Page>
    <a href="/">← Configurator</a>
    <h1>{recovery ? 'Recover your keyboard' : 'Module firmware update'}</h1>
    <p>{recovery ? 'Continue an interrupted update and restore your saved settings.' : 'Choose your firmware. We’ll install it and check your keyboard.'}</p>
    <section aria-label="Firmware update">
      {recovery && <>
        <label htmlFor="recovery-backup">Saved update</label>
        <select id="recovery-backup" value={recoverySelection} disabled={busy || phase !== 'idle' || !ownsPage || !storageReady} onChange={event => {
          setRecoverySelection(event.target.value);
          setBackup(event.target.value === 'none' ? null : backups.find(entry => entry.id === event.target.value)!);
          setConfirmed(false); setRecoveryConnection('bootloader');
          setMessage('Ready to recover. Select RP2 Boot when Chrome asks.'); setError(false);
        }}>
          <option value="" disabled>Select this keyboard’s update</option>
          {backups.map(saved => <option key={saved.id} value={saved.id}>{new Date(saved.createdAt).toLocaleString()} · {saved.choice.name} · {saved.status}</option>)}
          <option value="none">No saved backup — reinstall firmware</option>
        </select>
        {phase === 'idle' && backup && ['verified', 'complete'].includes(backup.status) && <>
          <label htmlFor="recovery-connection">Keyboard connection</label>
          <select id="recovery-connection" value={recoveryConnection} disabled={busy || phase !== 'idle'} onChange={e => {
            setRecoveryConnection(e.target.value);
            setMessage(e.target.value === 'keyboard' ? 'Ready to check your keyboard. Select Module when Chrome asks.' : 'Ready to recover. Select RP2 Boot when Chrome asks.');
          }}>
            <option value="bootloader">RP2 Boot — keyboard is in update mode</option>
            <option value="keyboard">Module — keyboard has restarted</option>
          </select>
        </>}
      </>}
      <label htmlFor="firmware-version">Firmware</label>
      <select id="firmware-version" aria-label="Firmware version" value={choice?.id || selected} disabled={busy || phase !== 'idle' || recovery && !!backup} onChange={e => setSelected(e.target.value)}>
        {(recovery && backup ? [backup.choice] : choices).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
      {recovery && recoverySelection && <>
        {recoverySelection === 'none' && <p className="warning">Your previous keymap cannot be restored without its backup. The firmware currently on the board may be incomplete.</p>}
        <p><label><input type="checkbox" checked={confirmed} disabled={busy || phase !== 'idle'} onChange={e => setConfirmed(e.target.checked)}/> {recoverySelection !== 'none' ? 'This backup belongs to the only keyboard connected.' : 'Only the intended keyboard is connected. I understand there is no saved keymap to restore.'}</label></p>
      </>}
      {choice && choice.mode !== 'normal' && <p className="warning">No current limiting. Overload can disconnect the board. Use your physical meter.</p>}
      <button ref={actionButton} aria-describedby="firmware-status" disabled={busy || !choice || !storageReady || !ownsPage || phase === 'done' || phase === 'failed' || !navigator.hid || !usb || recovery && (!confirmed || !recoverySelection)}
        onClick={advance}>{buttonLabel}</button>
      <p id="firmware-status" className="status" role={error ? 'alert' : 'status'} aria-live="polite">{message}</p>
      {percent !== null && !error && <progress aria-label="Firmware update progress" max={100} value={percent}/>}
      <p><small>Keep only this keyboard connected and close other keyboard tabs. Keep the cable connected until the update finishes. Chrome may ask for keyboard and bootloader access.</small></p>
      {(!navigator.hid || !usb) && <p className="warning">This browser needs WebHID and WebUSB. Open in desktop Chrome/Edge on HTTPS or localhost. No hardware commands have been sent.</p>}
      {phase === 'failed' && <p className="warning">Update stopped. Your backup is retained in Update details. The update has not been confirmed complete.</p>}
      {!busy && (phase === 'failed' || !recovery && phase === 'idle') && <p><a href={FIRMWARE_PATH + '/?recovery=1'}>{phase === 'failed' ? 'Reconnect and recover this update' : 'Recover an interrupted update'}</a></p>}
      {recovery && <p><small>If RP2 Boot is missing from the chooser, the keyboard may need its physical bootloader procedure. Reconnecting alone may not restart a partially written firmware. Contact support for your PCB’s procedure.</small></p>}
      <details className="support">
        <summary>Update details &amp; saved backups</summary>
        <p>{choice?.description}</p>
        {choice && <small>SHA-256: <code>{choice.sha256}</code></small>}
        <p><small>Private keymaps/macros and original affected firmware sectors stay in this browser only. Nothing is uploaded. Backups survive reloads here; clearing site data removes them. This is not a full-device dump.</small></p>
        {!recovery && <select aria-label="Recovery backup" value={backup?.id || ''} disabled={busy || phase !== 'idle'} onChange={event => {
          const saved = backups.find(entry => entry.id === event.target.value);
          if (!saved) throw new Error('Select an existing recovery backup.');
          setBackup(saved);
        }}>
          <option value="" disabled>Select a backup</option>
          {backups.map(saved => <option key={saved.id} value={saved.id}>{new Date(saved.createdAt).toLocaleString()} · {saved.choice.name} · {saved.status}</option>)}
        </select>}
        {backup && exports && <div className="exports">
          {exports.settings && <a href={exports.settings} download="module-settings.json">Download private VIA backup</a>}
          {exports.sectors && <a href={exports.sectors} download={`original-firmware-${backup.id}.bin`}>Download original firmware sectors</a>}
        </div>}
        <p><a href="/firmware-downloads/module-firmware-and-updater.zip" download>Download existing macOS recovery tools</a>. These are not needed for browser updates.</p>
      </details>
      {phase === 'done' && <p><a href={FIRMWARE_PATH + '/'}>Start a new update</a></p>}
    </section>
  </Page>;
}
