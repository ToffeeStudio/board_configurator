// Toffee Module lighting, shared by the Lighting page controls and the Halo ambient background.
// The board is the source of truth: state is read once a board is ready and again when the Lighting
// page opens; edits update this store at once and send one command each.
import {createSlice, PayloadAction} from '@reduxjs/toolkit';
import type {AppThunk, RootState} from './index';
import {getSelectedKeyboardAPI} from './devicesSlice';
import type {KeyboardAPI} from 'src/utils/keyboard-api';
import {
  LightingCapabilities, LightingState, ToffeeHIDDevice, ToffeeLightingAPI,
} from 'src/utils/toffee_studio/hid';

export type LightingZone = 'rear' | 'front' | 'badge';
// Per-Key LED is a Debug-only tab beside the three zones.
export type LightingTab = LightingZone | 'per-key';
export type LightingZones = Record<LightingZone, LightingState>;

type ToffeeLightingSliceState = {
  tab: LightingTab;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  capabilities: LightingCapabilities | null;
  zones: LightingZones | null;
};

const initialState: ToffeeLightingSliceState = {
  tab: 'rear', status: 'idle', error: null, capabilities: null, zones: null,
};

const toffeeLightingSlice = createSlice({
  name: 'toffeeLighting',
  initialState,
  reducers: {
    selectLightingTab: (state, action: PayloadAction<LightingTab>) => {
      state.tab = action.payload;
    },
    // A new or missing board: forget the previous board's lighting.
    resetToffeeLighting: (state) => ({...initialState, tab: state.tab}),
    // Keeps the previous zones so the ambient background doesn't flash while reloading.
    loadStarted: (state) => {
      state.status = 'loading';
      state.error = null;
    },
    loaded: (state, action: PayloadAction<{capabilities: LightingCapabilities; zones: LightingZones}>) => {
      state.status = 'ready';
      state.capabilities = action.payload.capabilities;
      state.zones = action.payload.zones;
    },
    failed: (state, action: PayloadAction<string>) => {
      state.status = 'error';
      state.error = action.payload;
    },
    zoneChanged: (state, action: PayloadAction<{zone: LightingZone; value: LightingState}>) => {
      state.zones![action.payload.zone] = action.payload.value;
    },
  },
});

export const {selectLightingTab, resetToffeeLighting} = toffeeLightingSlice.actions;
const {loadStarted, loaded, failed, zoneChanged} = toffeeLightingSlice.actions;
export default toffeeLightingSlice.reducer;

export const getToffeeLighting = (state: RootState) => state.toffeeLighting;

export const toffeeLightingApi = (keyboard: KeyboardAPI) =>
  new ToffeeLightingAPI(new ToffeeHIDDevice(keyboard.getHID()._hidDevice!._device));

// Badge state in the same shape as the other zones: effect 0 means off.
async function readBadge(api: ToffeeLightingAPI, capabilities: LightingCapabilities): Promise<LightingState> {
  if (capabilities.version === 3) {
    const badge = await api.getBadgeAnimationState();
    return {effect: badge.enabled ? badge.effect : 0, speed: badge.speed,
      brightness: badge.brightness, hue: badge.hue, saturation: badge.saturation};
  }
  const badge = await api.getBadgeState();
  return {effect: Number(badge.enabled), speed: 0, brightness: badge.brightness,
    hue: badge.hue, saturation: badge.saturation};
}

export const loadToffeeLighting = (keyboard: KeyboardAPI): AppThunk => async (dispatch, getState) => {
  dispatch(loadStarted());
  const api = toffeeLightingApi(keyboard);
  try {
    const capabilities = await api.getCapabilities();
    const zones = {
      rear: await api.getLightingState(),
      front: await api.getFrontState(),
      badge: await readBadge(api, capabilities),
    };
    if (getSelectedKeyboardAPI(getState()) === keyboard) dispatch(loaded({capabilities, zones}));
  } catch (error) {
    console.error('Lighting: load failed.', error);
    if (getSelectedKeyboardAPI(getState()) === keyboard) dispatch(failed((error as Error).message));
  }
};

// The underglow takes one command per setting; front and badge take their whole state.
function writeZone(api: ToffeeLightingAPI, capabilities: LightingCapabilities, zone: LightingZone,
  change: Partial<LightingState>, value: LightingState): Promise<void> {
  if (zone === 'rear') {
    if (change.effect !== undefined) return api.setAnimation(value.effect);
    if (change.speed !== undefined) return api.setSpeed(value.speed);
    if (change.brightness !== undefined) return api.setBrightness(value.brightness);
    return api.setColor(value.hue, value.saturation);
  }
  if (zone === 'front') return api.setFrontState(value);
  const badge = {enabled: value.effect !== 0, brightness: value.brightness,
    hue: value.hue, saturation: value.saturation};
  return capabilities.version === 3
    ? api.setBadgeAnimationState({...badge, effect: value.effect, speed: value.speed})
    : api.setBadgeState(badge);
}

export const updateLightingZone = (keyboard: KeyboardAPI, zone: LightingZone,
  change: Partial<LightingState>): AppThunk => (dispatch, getState) => {
  const {capabilities, zones} = getToffeeLighting(getState());
  const value = {...zones![zone], ...change};
  dispatch(zoneChanged({zone, value}));
  writeZone(toffeeLightingApi(keyboard), capabilities!, zone, change, value).catch((error: Error) => {
    console.error(`Lighting: ${zone} update failed.`, error);
    if (getSelectedKeyboardAPI(getState()) === keyboard) dispatch(failed(error.message));
  });
};
