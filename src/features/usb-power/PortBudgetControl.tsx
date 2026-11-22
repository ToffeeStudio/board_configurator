import {useState, useSyncExternalStore} from 'react';
import {desktopPower} from './desktop-power';
import {MAX_MA, SAFE_MA} from './port-budget';

export function PortBudgetControl() {
  const state = useSyncExternalStore(desktopPower.subscribe, desktopPower.snapshot);
  const [value, setValue] = useState('450');
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!window.toffeeDesktop) return null;
  const ma = Number(value);
  const valid = Number.isInteger(ma) && ma >= SAFE_MA && ma <= MAX_MA;

  const save = async (limit: number) => {
    if (!state.key) return;
    setBusy(true);
    try {
      await desktopPower.set(limit, state.key);
      setConfirmed(null);
    } finally {
      setBusy(false);
    }
  };

  return <details>
    <summary>USB current limit</summary>
    <p role="status">{state.message || `Estimated limit on this port: ${state.milliamps} mA.`}</p>
    {state.available && <>
      <label>Estimated current limit (mA) <input type="number" min={SAFE_MA} max={MAX_MA} value={value}
        onChange={event => { setValue(event.target.value); setConfirmed(null); }}/></label>
      {ma > SAFE_MA && <label>
        <input type="checkbox" checked={confirmed !== null && confirmed === state.key} onChange={event => setConfirmed(event.target.checked ? state.key : null)}/>
        I have verified this connection can supply the selected current.
      </label>}
      <button type="button" disabled={busy || !valid || ma > SAFE_MA && confirmed !== state.key}
        onClick={() => void save(ma)}>Remember for this USB port</button>
      <button type="button" disabled={busy} onClick={() => void save(SAFE_MA)}>Use 450 mA</button>
    </>}
  </details>;
}
