import {useEffect, useMemo, useRef, useState} from 'react';
import {useAppSelector} from 'src/store/hooks';
import {getSelectedKeyboardAPI} from 'src/store/devicesSlice';
import {LightingState, LightingCapabilities, ToffeeHIDDevice, ToffeeLightingAPI} from 'src/utils/toffee_studio/hid';
import {FRONT_EFFECTS, BADGE_EFFECTS} from 'src/utils/toffee_studio/lighting-effects';
import {AccentSelect} from 'src/components/inputs/accent-select';
import {ArrayColorPicker} from 'src/components/inputs/color-picker';
import {ControlRow, Label, Detail} from 'src/components/panes/grid';
import GlowRange from './GlowRange/GlowRange';

export function GroupLightingMenu({group}: {group: 'front' | 'badge'}) {
  const keyboard = useAppSelector(getSelectedKeyboardAPI);
  const api = useMemo(() => keyboard
    ? new ToffeeLightingAPI(new ToffeeHIDDevice(keyboard.getHID()._hidDevice!._device))
    : null, [keyboard]);
  const [state, setState] = useState<LightingState | null>(null);
  const [capabilities, setCapabilities] = useState<LightingCapabilities | null>(null);
  const latest = useRef<LightingState | null>(null);
  const currentApi = useRef(api);
  currentApi.current = api;
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setState(null);
    setCapabilities(null);
    latest.current = null;
    setError(null);
    if (api) {
      const load = async () => {
        const caps = await api.getCapabilities();
        if (active) setCapabilities(caps);
        if (group === 'front') return api.getFrontState();
        if (caps.version === 3) {
          const badge = await api.getBadgeAnimationState();
          return {effect: badge.enabled ? badge.effect : 0, speed: badge.speed,
            brightness: badge.brightness, hue: badge.hue, saturation: badge.saturation};
        }
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
    const badge = {enabled: value.effect !== 0, brightness: value.brightness,
      hue: value.hue, saturation: value.saturation};
    const command = group === 'front' ? api!.setFrontState(value)
      : capabilities!.version === 3 ? api!.setBadgeAnimationState({...badge, effect: value.effect, speed: value.speed})
      : api!.setBadgeState(badge);
    command.catch((failure: Error) => {
      console.error(group + ' lighting:', failure);
      if (currentApi.current === api) setError(failure.message);
    });
  };
  if (!api) return <div>Connect and select your board.</div>;
  if (error) return <div role="alert"><p>{error}</p>
    <button onClick={() => setRetry(value => value + 1)}>Retry</button></div>;
  if (!state || !capabilities) return <div>Loading {group} lighting...</div>;
  const animated = group === 'front' || capabilities.version === 3;
  const effects = group === 'front' ? FRONT_EFFECTS.slice(0, capabilities.frontEffects) : BADGE_EFFECTS;
  return <>
    <ControlRow><Label>{animated ? 'Effect' : 'Enabled'}</Label><Detail>
      {animated ? <AccentSelect aria-label={group === 'front' ? 'Front effect' : 'Badge effect'} options={effects}
        value={effects.find(option => option.value === state.effect)}
        onChange={option => update({effect: (option as {value: number}).value})}/>
        : <input aria-label="Badge lighting enabled" type="checkbox" checked={state.effect === 1}
            onChange={event => update({effect: Number(event.target.checked)})}/>}
    </Detail></ControlRow>
    <ControlRow><Label>Brightness</Label><Detail>
      <GlowRange aria-label={group === 'front' ? 'Front brightness' : 'Badge brightness'} min={0} max={255} value={state.brightness}
        onChange={brightness => update({brightness})}/>
    </Detail></ControlRow>
    {animated && <ControlRow><Label>Speed</Label><Detail>
      <GlowRange aria-label={group === 'front' ? 'Front speed' : 'Badge speed'} min={0} max={255} value={state.speed} onChange={speed => update({speed})}/>
    </Detail></ControlRow>}
    <ControlRow><Label>Colour</Label><Detail>
      <ArrayColorPicker color={[state.hue, state.saturation]}
        setColor={(hue, saturation) => update({hue, saturation})}/>
    </Detail></ControlRow>
    <p>Normal firmware saves changes after a one-second pause. Temporary test firmware does not save.</p>
    {group === 'badge' && <p>The badge is independent of front and rear lighting.</p>}
    {capabilities.version === 2 && <p>Update firmware to unlock reactive front effects and badge animations.</p>}
  </>;
}
