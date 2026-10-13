import {useEffect, useMemo, useRef, useState} from 'react';
import {useAppSelector} from 'src/store/hooks';
import {getSelectedKeyboardAPI} from 'src/store/devicesSlice';
import {LightingState, ToffeeHIDDevice, ToffeeLightingAPI} from 'src/utils/toffee_studio/hid';
import {AccentSelect} from 'src/components/inputs/accent-select';
import {ArrayColorPicker} from 'src/components/inputs/color-picker';
import {ControlRow, Label, Detail} from 'src/components/panes/grid';
import GlowRange from './GlowRange/GlowRange';

const EFFECTS = ['Off', 'Solid', 'Breathing', 'Cycle All', 'Cycle Left–Right',
  'Cycle Up–Down', 'Gradient Left–Right', 'Gradient Up–Down', 'Rainbow Beacon']
  .map((label, value) => ({label, value}));

export function GroupLightingMenu({group}: {group: 'front' | 'badge'}) {
  const keyboard = useAppSelector(getSelectedKeyboardAPI);
  const api = useMemo(() => keyboard
    ? new ToffeeLightingAPI(new ToffeeHIDDevice(keyboard.getHID()._hidDevice!._device))
    : null, [keyboard]);
  const [state, setState] = useState<LightingState | null>(null);
  const latest = useRef<LightingState | null>(null);
  const currentApi = useRef(api);
  currentApi.current = api;
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setState(null);
    latest.current = null;
    setError(null);
    if (api) {
      const load = async () => {
        await api.getCapabilities();
        if (group === 'front') return api.getFrontState();
        const badge = await api.getBadgeState();
        return {effect: Number(badge.enabled), speed: 0, brightness: badge.brightness,
          hue: badge.hue, saturation: badge.saturation};
      };
      load().then(value => {
        if (active) { latest.current = value; setState(value); }
      }).catch((failure: Error) => { if (active) setError(failure.message); });
    }
    return () => { active = false; };
  }, [api, group, retry]);

  const update = (change: Partial<LightingState>) => {
    const value = {...latest.current!, ...change};
    latest.current = value;
    setState(value);
    const command = group === 'front' ? api!.setFrontState(value)
      : api!.setBadgeState({enabled: value.effect === 1, brightness: value.brightness,
          hue: value.hue, saturation: value.saturation});
    command.catch((failure: Error) => {
      console.error(group + ' lighting:', failure);
      if (currentApi.current === api) setError(failure.message);
    });
  };
  if (!api) return <div>Connect and select your board.</div>;
  if (error) return <div role="alert"><p>{error}</p>
    <button onClick={() => setRetry(value => value + 1)}>Retry</button></div>;
  if (!state) return <div>Loading {group} lighting...</div>;
  return <>
    <ControlRow><Label>{group === 'front' ? 'Effect' : 'Enabled'}</Label><Detail>
      {group === 'front' ? <AccentSelect aria-label="Front effect" options={EFFECTS}
        value={EFFECTS.find(option => option.value === state.effect)}
        onChange={option => update({effect: (option as {value: number}).value})}/>
        : <input aria-label="Badge lighting enabled" type="checkbox" checked={state.effect === 1}
            onChange={event => update({effect: Number(event.target.checked)})}/>}
    </Detail></ControlRow>
    <ControlRow><Label>Brightness</Label><Detail>
      <GlowRange aria-label={group === 'front' ? 'Front brightness' : 'Badge brightness'} min={0} max={255} value={state.brightness}
        onChange={brightness => update({brightness})}/>
    </Detail></ControlRow>
    {group === 'front' && <ControlRow><Label>Speed</Label><Detail>
      <GlowRange aria-label="Front speed" min={0} max={255} value={state.speed} onChange={speed => update({speed})}/>
    </Detail></ControlRow>}
    <ControlRow><Label>Colour</Label><Detail>
      <ArrayColorPicker color={[state.hue, state.saturation]}
        setColor={(hue, saturation) => update({hue, saturation})}/>
    </Detail></ControlRow>
    <p>Normal firmware saves changes after a one-second pause. Temporary test firmware does not save.</p>
    {group === 'badge' && <p>The badge uses its own solid colour, independent of front and rear lighting.</p>}
  </>;
}
