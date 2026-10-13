import {useEffect, useMemo, useRef, useState} from 'react';
import {useAppSelector} from 'src/store/hooks';
import {getSelectedKeyboardAPI} from 'src/store/devicesSlice';
import {ToffeeLightingAPI, ToffeeHIDDevice} from 'src/utils/toffee_studio/hid';
import lightingMap from 'src/utils/toffee_studio/lighting-map.json';
import {AccentSelect} from 'src/components/inputs/accent-select';
import GlowRange from './GlowRange/GlowRange';
import {ControlRow, Label, Detail} from 'src/components/panes/grid';

const OPTIONS = lightingMap.front.map(key => ({value: key.index, label: key.label}));
export function FrontLedMenu() {
  const keyboard = useAppSelector(getSelectedKeyboardAPI);
  const api = useMemo(() => keyboard
    ? new ToffeeLightingAPI(new ToffeeHIDDevice(keyboard.getHID()._hidDevice!._device))
    : null, [keyboard]);
  const [selected, setSelected] = useState(OPTIONS[0]);
  const [brightness, setBrightness] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const request = ++generation.current;
    setBrightness(null);
    setError(null);
    if (api) api.getCapabilities().then(() => api.getLedBrightness(selected.value))
      .then(value => { if (generation.current === request) setBrightness(value); })
      .catch((failure: Error) => { if (generation.current === request) setError(failure.message); });
    return () => { generation.current++; };
  }, [api, selected, retry]);
  if (!api) return <div>Connect and select your board.</div>;
  if (error) return <div role="alert"><p>{error}</p>
    <button onClick={() => setRetry(value => value + 1)}>Retry</button></div>;
  return <>
    <ControlRow><Label>Key</Label><Detail>
      <AccentSelect aria-label="Front key" options={OPTIONS} value={selected}
        onChange={option => setSelected(option as typeof selected)}/>
    </Detail></ControlRow>
    <ControlRow><Label>Brightness (0 = off)</Label><Detail>
      {brightness === null ? <div>Loading key brightness...</div> :
        <GlowRange aria-label="Key brightness" min={0} max={255} value={brightness} onChange={value => {
          const request = generation.current;
          setBrightness(value);
          api.setLedBrightness(selected.value, value).catch((failure: Error) => {
            console.error('Per-key lighting:', failure);
            if (generation.current === request) setError(failure.message);
          });
        }}/>}
    </Detail></ControlRow>
    <p>Per-key brightness scales the front effect. Normal firmware saves after a one-second pause; temporary test firmware does not save.</p>
  </>;
}
