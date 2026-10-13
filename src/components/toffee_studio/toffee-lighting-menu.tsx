import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAppSelector } from 'src/store/hooks';
import { getSelectedKeyboardAPI } from 'src/store/devicesSlice';
import { ToffeeLightingAPI, ToffeeHIDDevice } from 'src/utils/toffee_studio/hid';
import { AccentSelect } from 'src/components/inputs/accent-select';
import GlowRange from './GlowRange/GlowRange';
import { ArrayColorPicker } from 'src/components/inputs/color-picker';
import { ControlRow, Label, Detail } from 'src/components/panes/grid';

type LightingState = Awaited<ReturnType<ToffeeLightingAPI['getLightingState']>>;

// Hard-coded options for the Effect dropdown, matching the definition file
const EFFECT_OPTIONS = [
  { value: 0, label: 'Solid' },
  { value: 1, label: 'Breathing' },
  { value: 2, label: 'Cycle L-R' },
  { value: 3, label: 'Cycle U-D' },
  { value: 4, label: 'Band Sat L-R' },
  { value: 5, label: 'Band Sat U-D' },
  { value: 6, label: 'Hue Breathing' },
  { value: 7, label: 'Rainbow Vortex' },
  { value: 8, label: 'Vortex' },
  { value: 9, label: 'Comet Tail' },
];

export const ToffeeLightingMenu: React.FC = () => {
  const keyboardAPI = useAppSelector(getSelectedKeyboardAPI);
  const toffeeLightingApi = useMemo(() => {
    if (!keyboardAPI) return null;
    const webHidDevice = keyboardAPI.getHID()._hidDevice!._device;
    return new ToffeeLightingAPI(new ToffeeHIDDevice(webHidDevice));
  }, [keyboardAPI]);
  const currentApi = useRef(toffeeLightingApi);
  currentApi.current = toffeeLightingApi;
  const [lightingState, setLightingState] = useState<LightingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLightingState(null);
    setError(null);
    if (toffeeLightingApi) {
      console.log('Underglow: loading settings.');
      toffeeLightingApi.getCapabilities().then(() => toffeeLightingApi.getLightingState())
        .then((state) => {
          if (active) setLightingState(state);
        })
        .catch((error: Error) => {
          console.error('Underglow: load failed.', error);
          if (active) setError(error.message);
        });
    }
    return () => { active = false; };
  }, [toffeeLightingApi, retry]);

  const updateLighting = async (
    command: Promise<void>,
    change: Partial<LightingState>,
  ) => {
    setLightingState((state) => ({ ...state!, ...change }));
    try {
      await command;
    } catch (error) {
      console.error('Underglow: update failed.', error);
      if (currentApi.current === toffeeLightingApi) setError((error as Error).message);
    }
  };

  if (!toffeeLightingApi) {
    return <div>Connect and select your board to configure underglow.</div>;
  }
  if (error) {
    return (
      <div role="alert">
        <p>Unable to configure underglow: {error}</p>
        <button onClick={() => setRetry((value) => value + 1)}>Retry</button>
      </div>
    );
  }
  if (!lightingState) {
    return <div>Loading Underglow Settings...</div>;
  }

  return (
    <>
      <ControlRow>
        <Label>Effect</Label>
        <Detail>
          <AccentSelect
            aria-label="Underglow effect"
            options={EFFECT_OPTIONS}
            value={EFFECT_OPTIONS.find(opt => opt.value === lightingState.effect)}
            onChange={(value) => {
              const option = value as { value: number; label: string } | null;
              if (option) {
                void updateLighting(toffeeLightingApi.setAnimation(option.value), {
                  effect: option.value,
                });
              }
            }}
          />
        </Detail>
      </ControlRow>

      <ControlRow>
        <Label>Brightness</Label>
        <Detail>
          <GlowRange
            aria-label="Underglow brightness"
            min={0}
            max={255}
            value={lightingState.brightness}
            onChange={(brightness) => {
              void updateLighting(toffeeLightingApi.setBrightness(brightness), { brightness });
            }}
          />
        </Detail>
      </ControlRow>

      <ControlRow>
        <Label>Speed</Label>
        <Detail>
          <GlowRange
            aria-label="Underglow speed"
            min={0}
            max={255}
            value={lightingState.speed}
            onChange={(speed) => {
              void updateLighting(toffeeLightingApi.setSpeed(speed), { speed });
            }}
          />
        </Detail>
      </ControlRow>

      <ControlRow>
        <Label>Color</Label>
        <Detail>
          <ArrayColorPicker
            color={[lightingState.hue, lightingState.saturation]}
            setColor={(hue, saturation) => {
              void updateLighting(toffeeLightingApi.setColor(hue, saturation), { hue, saturation });
            }}
          />
        </Detail>
      </ControlRow>
      <p>Normal firmware saves changes after a one-second pause. Temporary test firmware does not save.</p>
    </>
  );
};
