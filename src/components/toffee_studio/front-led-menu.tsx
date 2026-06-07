import React, { useState, useMemo } from 'react';
import { useAppSelector } from 'src/store/hooks';
import { getSelectedKeyboardAPI } from 'src/store/devicesSlice';
import { ToffeeLightingAPI, ToffeeHIDDevice } from 'src/utils/toffee_studio/hid';
import { AccentSelect } from 'src/components/inputs/accent-select';
import GlowRange from './GlowRange/GlowRange';
import { ControlRow, Label, Detail } from 'src/components/panes/grid';

// Key -> front LED index map. Derived from the firmware's key_logical_map
// (matrix -> led_index) joined with the default keymap legends.
// Layout is a standard 65% minus the top-right key. Some keys share an LED.
const KEY_LED_OPTIONS: { value: number; label: string }[] = [
  // Row 1
  { label: 'Esc', value: 75 },
  { label: '1', value: 76 },
  { label: '2', value: 77 },
  { label: '3', value: 78 },
  { label: '4', value: 79 },
  { label: '5', value: 80 },
  { label: '6', value: 81 },
  { label: '7', value: 82 },
  { label: '8', value: 83 },
  { label: '9', value: 84 },
  { label: '0', value: 85 },
  { label: '- (minus)', value: 86 },
  { label: '= (equals)', value: 87 },
  { label: 'Backspace', value: 88 },
  { label: 'Fn (top-right)', value: 88 },
  // Row 2
  { label: 'Tab', value: 51 },
  { label: 'Q', value: 52 },
  { label: 'W', value: 53 },
  { label: 'E', value: 54 },
  { label: 'R', value: 55 },
  { label: 'T', value: 56 },
  { label: 'Y', value: 57 },
  { label: 'U', value: 58 },
  { label: 'I', value: 59 },
  { label: 'O', value: 60 },
  { label: 'P', value: 61 },
  { label: '[', value: 62 },
  { label: ']', value: 63 },
  { label: '\\ (backslash)', value: 64 },
  { label: 'Del', value: 65 },
  // Row 3
  { label: 'Caps Lock', value: 49 },
  { label: 'Caps indicator (right of Caps)', value: 47 },
  { label: 'A', value: 46 },
  { label: 'S', value: 45 },
  { label: 'D', value: 44 },
  { label: 'F', value: 43 },
  { label: 'G', value: 42 },
  { label: 'H', value: 41 },
  { label: 'J', value: 40 },
  { label: 'K', value: 39 },
  { label: 'L', value: 38 },
  { label: '; (semicolon)', value: 37 },
  { label: "' (quote)", value: 36 },
  { label: 'Enter', value: 35 },
  { label: 'PgUp', value: 34 },
  // Row 4
  { label: 'L.Shift (left half)', value: 18 },
  { label: 'L.Shift (right half)', value: 18 },
  { label: 'Z', value: 19 },
  { label: 'X', value: 20 },
  { label: 'C', value: 21 },
  { label: 'V', value: 22 },
  { label: 'B', value: 23 },
  { label: 'N', value: 24 },
  { label: 'M', value: 25 },
  { label: ', (comma)', value: 26 },
  { label: '. (period)', value: 27 },
  { label: '/ (slash)', value: 28 },
  { label: 'R.Shift', value: 29 },
  { label: 'Up', value: 30 },
  { label: 'PgDn', value: 31 },
  // Row 5
  { label: 'L.Ctrl', value: 17 },
  { label: 'L.GUI', value: 15 },
  { label: 'L.Alt', value: 13 },
  { label: 'Space', value: 10 },
  { label: 'R.GUI', value: 7 },
  { label: 'Fn', value: 6 },
  { label: 'Left', value: 4 },
  { label: 'Down', value: 2 },
  { label: 'Right', value: 0 },
];

export const FrontLedMenu: React.FC = () => {
  const keyboardAPI = useAppSelector(getSelectedKeyboardAPI);

  const toffeeLightingApi = useMemo(() => {
    if (!keyboardAPI) {
      return null;
    }
    try {
      const webHidDevice = (keyboardAPI.getHID() as any)._hidDevice._device;
      if (!webHidDevice) {
        return null;
      }
      return new ToffeeLightingAPI(new ToffeeHIDDevice(webHidDevice));
    } catch (e) {
      console.error('Failed to initialize ToffeeLightingAPI', e);
      return null;
    }
  }, [keyboardAPI]);

  const [selectedKey, setSelectedKey] = useState(KEY_LED_OPTIONS[0]);
  const [brightness, setBrightness] = useState(255);

  const handleKeyChange = (option: { value: number; label: string } | null) => {
    if (option) {
      setSelectedKey(option);
    }
  };

  const handleBrightnessChange = (value: number) => {
    setBrightness(value);
    if (toffeeLightingApi) {
      toffeeLightingApi.setLedBrightness(selectedKey.value, value);
    }
  };

  if (!toffeeLightingApi) {
    return <div>Connect your keyboard to control front LEDs.</div>;
  }

  return (
    <>
      <ControlRow>
        <Label>Key</Label>
        <Detail>
          <AccentSelect
            options={KEY_LED_OPTIONS}
            value={selectedKey}
            onChange={handleKeyChange}
          />
        </Detail>
      </ControlRow>

      <ControlRow>
        <Label>Brightness (0 = off)</Label>
        <Detail>
          <GlowRange
            min={0}
            max={255}
            value={brightness}
            onChange={handleBrightnessChange}
          />
        </Detail>
      </ControlRow>
    </>
  );
};
