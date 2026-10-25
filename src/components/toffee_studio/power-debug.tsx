import {useEffect, useMemo, useState} from 'react';
import {PowerStatus, ToffeeHIDDevice, ToffeeLightingAPI} from 'src/utils/toffee_studio/hid';
import {DEBUG_ENABLED} from '../../config/debug';

// Read-only: opening Debug never sends a lighting setter, save or budget override.
export function PowerDebug({device}: {device: HIDDevice | null}) {
  return DEBUG_ENABLED ? <PowerDebugContent device={device}/> : null;
}
function PowerDebugContent({device}: {device: HIDDevice | null}) {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<PowerStatus | null>(null);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const api = useMemo(() => device ? new ToffeeLightingAPI(new ToffeeHIDDevice(device)) : null, [device]);

  useEffect(() => {
    let active = true;
    let stopped = false;
    let pending = false;
    let timer: ReturnType<typeof setTimeout>;
    let expiry: ReturnType<typeof setTimeout>;
    setStatus(null);
    setExpired(false);
    setError(null);
    if (!enabled || !api) return;
    const poll = async () => {
      if (!active || stopped || pending || document.hidden) return;
      pending = true;
      try {
        const next = await api.getPowerStatus();
        if (active && !stopped && !document.hidden) {
          clearTimeout(expiry);
          setStatus(next);
          setExpired(next.ageMs > 2000);
          expiry = setTimeout(() => setExpired(true), Math.max(0, 2001 - next.ageMs));
        }
      } catch (failure) {
        if (active && !stopped) {
          stopped = true;
          setStatus(null);
          setError((failure as Error).message);
          console.error('Power debug:', failure);
        }
      } finally {
        pending = false;
        if (active && !stopped && !document.hidden) timer = setTimeout(poll, 250);
      }
    };
    const visibility = () => {
      clearTimeout(timer);
      clearTimeout(expiry);
      setStatus(null);
      if (!document.hidden) void poll();
    };
    const disconnected = (event: HIDConnectionEvent) => {
      if (event.device !== device) return;
      stopped = true;
      clearTimeout(timer);
      clearTimeout(expiry);
      setStatus(null);
      setError('Board disconnected. Reconnect it, then retry.');
    };
    document.addEventListener('visibilitychange', visibility);
    navigator.hid.addEventListener('disconnect', disconnected);
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
      clearTimeout(expiry);
      document.removeEventListener('visibilitychange', visibility);
      navigator.hid.removeEventListener('disconnect', disconnected);
    };
  }, [enabled, api, device, retry]);

  const fresh = status && !expired && status.frameValid && status.ageMs <= 2000 && status.usbConfigured;
  const unlimited = status?.manualMeasurement || status?.currentUnlimited;
  const usage = status && status.ledBudgetMa > 0
    ? Math.round(status.effectiveLedMa * 100 / status.ledBudgetMa) : null;
  return <section aria-label="Lighting power debug" style={{margin: '0 16px 12px', flexShrink: 0}}>
    <button aria-pressed={enabled} onClick={() => setEnabled(value => !value)}>
      {enabled ? 'Hide Debug' : 'Debug: current budget'}
    </button>
    {enabled && <div style={{border: '1px solid #7153a4', borderRadius: 8, padding: '12px 16px', marginTop: 8}}>
      <strong>Lighting current · firmware estimate</strong>
      {unlimited && <p style={{margin: '6px 0'}}>{status?.manualMeasurement
        ? 'LIMITER DISABLED — manual measurement firmware. The displayed budget is informational only.'
        : 'CURRENT LIMITER DISABLED — normal saves and front/badge output caps remain. Budget is informational only.'}</p>}
      {!api ? <p>Connect and select your board.</p>
        : error ? <div role="alert"><p>{error}</p><button onClick={() => setRetry(value => value + 1)}>Retry debug</button></div>
        : !status ? <p>Reading firmware power status…</p>
        : <>
          {!status.configured && <p role="status">Budget not configured — uncalibrated reference model; this firmware holds LEDs off.</p>}
          {!status.manualMeasurement && status.modelRevision >= 0x8000 && <p role="status">Temporary test profile — estimates are not a qualified product budget. Lighting saves are disabled; controller timeout turns LEDs off.</p>}
          {!fresh ? <p role="status">No fresh output estimate. Waiting for a configured USB connection and a recent LED frame.</p>
            : <>
              <div style={{display: 'flex', flexWrap: 'wrap', gap: '12px 28px', margin: '10px 0'}}>
                <span>Requested LEDs{status.frontBadgeMax !== null ? ' (before output rescaling)' : ''}: <b data-testid="power-requested">{status.requestedLedMa} mA</b></span>
                <span>{unlimited ? 'Output LEDs' : 'Limited LEDs'}: <b data-testid="power-effective">{status.effectiveLedMa} mA</b></span>
                <span>Estimated board total: <b>{status.baseMa + status.effectiveLedMa} mA</b></span>
                <span>{unlimited ? 'Reference LED allowance (not enforced)' : 'LED budget'}: <b>{status.configured ? `${status.ledBudgetMa} mA` : 'Not set'}</b></span>
                <span>Budget used: <b data-testid="power-usage">{usage === null ? 'Unavailable' : `${usage}%`}</b></span>
                <span>Limiter: <b>{unlimited ? 'DISABLED' : `${((1000 - status.limitPermille) / 10).toFixed(1)}% dimming`}</b></span>
              </div>
              {status.frontBadgeMax !== null && <p data-testid="power-output-caps" style={{margin: '6px 0', fontSize: 12}}>
                Firmware output range: front 0–{status.frontBadgeMax}/255 · rear 0–255/255 · badge 0–{status.frontBadgeMax}/255.
                {' '}Front/badge RGB is rescaled before current limiting; slider and saved values stay 0–255.
              </p>}
              {usage !== null && <progress aria-label="Estimated LED budget used" max={100} value={usage} style={{width: '100%'}}/>}
              <p data-testid="power-budget-status" style={{margin: '6px 0'}}>{unlimited
                ? 'Limiter disabled'
                : status.configured
                ? status.limited ? 'Limiting active' : 'Within'
                : 'Budget not configured'}</p>
            </>}
          <small>Model {status.modelRevision} · base {status.baseMa} mA · margin {status.marginMa} mA · {unlimited ? 'reference board ceiling (not enforced)' : 'board ceiling'} {status.configured ? `${status.boardLimitMa} mA` : 'not set'} · frame {status.frame}, {status.ageMs} ms old at reply</small>
        </>}
      <ul aria-label="Firmware startup recovery" style={{margin: '8px 0 0', paddingLeft: 20, fontSize: 12}}>
        <li>Hold both Shift keys while plugging in to reset all lighting brightness to zero (updated normal firmware).</li>
        <li>Hold Escape while plugging in to reset EEPROM and enter the bootloader.</li>
      </ul>
    </div>}
  </section>;
}
