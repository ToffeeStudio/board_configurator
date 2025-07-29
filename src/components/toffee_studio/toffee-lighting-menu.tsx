import React, { useState, useEffect, useMemo } from 'react';
import { useAppSelector } from 'src/store/hooks';
import { getSelectedKeyboardAPI } from 'src/store/devicesSlice';
import { ToffeeLightingAPI, ToffeeHIDDevice } from 'src/utils/toffee_studio/hid';
import { AccentSelect } from 'src/components/inputs/accent-select';
import { AccentRange } from 'src/components/inputs/accent-range';
import { ArrayColorPicker } from 'src/components/inputs/color-picker';
import { ControlRow, Label, Detail } from 'src/components/panes/grid';

// Define the structure for the lighting state
interface LightingState {
  effect: number;
  speed: number;
  brightness: number;
  hue: number;
  saturation: number;
}

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
  // 1. Get the keyboard API from Redux to access the underlying HID device
  const keyboardAPI = useAppSelector(getSelectedKeyboardAPI);

  // 2. Initialize the ToffeeLightingAPI using a memo to prevent re-creation on every render
  const toffeeLightingApi = useMemo(() => {
    if (!keyboardAPI) {
      console.log("ToffeeLightingMenu: keyboardAPI is not available.");
      return null;
    }
    try {
      // Extract the raw WebHID device from the keyboardAPI wrapper
      const webHidDevice = (keyboardAPI.getHID() as any)._hidDevice._device;
      if (!webHidDevice) {
        console.error("ToffeeLightingMenu: Could not get the underlying WebHID device.");
        return null;
      }
      const toffeeDevice = new ToffeeHIDDevice(webHidDevice);
      // The API methods will handle opening the device as needed.
      return new ToffeeLightingAPI(toffeeDevice);
    } catch (e) {
      console.error("Failed to initialize ToffeeLightingAPI", e);
      return null;
    }
  }, [keyboardAPI]);

  // 3. Manage the lighting state locally within this component
  const [lightingState, setLightingState] = useState<LightingState | null>(null);

  // 4. Fetch the initial state from the device when the component mounts or the API becomes available
  useEffect(() => {
    const fetchInitialState = async () => {
      if (toffeeLightingApi) {
        try {
          console.log("Fetching initial lighting state...");
          const currentState = await toffeeLightingApi.getLightingState();
          setLightingState(currentState);
          console.log("Initial lighting state received:", currentState);
        } catch (error) {
          console.error("Failed to fetch initial lighting state:", error);
          setLightingState(null); // Set to null on error to show a message
        }
      }
    };

    fetchInitialState();
  }, [toffeeLightingApi]); // This effect re-runs if the keyboard connection changes

  // 5. Define event handlers for each UI control
  const handleEffectChange = (option: { value: number; label: string } | null) => {
    if (option && toffeeLightingApi && lightingState) {
      const effectId = option.value;
      toffeeLightingApi.setAnimation(effectId);
      setLightingState({ ...lightingState, effect: effectId });
    }
  };

  const handleBrightnessChange = (value: number) => {
    if (toffeeLightingApi && lightingState) {
      toffeeLightingApi.setBrightness(value);
      setLightingState({ ...lightingState, brightness: value });
    }
  };

  const handleSpeedChange = (value: number) => {
    if (toffeeLightingApi && lightingState) {
      toffeeLightingApi.setSpeed(value);
      setLightingState({ ...lightingState, speed: value });
    }
  };

  const handleColorChange = (hue: number, sat: number) => {
    if (toffeeLightingApi && lightingState) {
      toffeeLightingApi.setColor(hue, sat);
      setLightingState({ ...lightingState, hue, saturation: sat });
    }
  };

  // Render a loading state until the initial device state has been fetched
  if (!lightingState || !toffeeLightingApi) {
    return <div>Loading Underglow Settings... Please ensure your device is connected.</div>;
  }

  // 6. Render the UI using reusable components and the local state
  return (
    <>
      <ControlRow>
        <Label>Effect</Label>
        <Detail>
          <AccentSelect
            options={EFFECT_OPTIONS}
            value={EFFECT_OPTIONS.find(opt => opt.value === lightingState.effect)}
            onChange={handleEffectChange}
          />
        </Detail>
      </ControlRow>

      <ControlRow>
        <Label>Brightness</Label>
        <Detail>
          <AccentRange
            min={0}
            max={255}
            value={lightingState.brightness}
            onChange={handleBrightnessChange}
          />
        </Detail>
      </ControlRow>

      <ControlRow>
        <Label>Speed</Label>
        <Detail>
          <AccentRange
            min={0}
            max={255}
            value={lightingState.speed}
            onChange={handleSpeedChange}
          />
        </Detail>
      </ControlRow>

      <ControlRow>
        <Label>Color</Label>
        <Detail>
          <ArrayColorPicker
            color={[lightingState.hue, lightingState.saturation]}
            setColor={handleColorChange}
          />
        </Detail>
      </ControlRow>
    </>
  );
};
