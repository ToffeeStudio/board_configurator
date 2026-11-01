// Halo Stage lighting controls: zone tabs for the page header, and one glass control bar with the
// zone's effect chips, brightness and speed sliders and a hue/saturation picker.
import {CSSProperties, useEffect} from 'react';
import styled from 'styled-components';
import {useAppDispatch, useAppSelector} from 'src/store/hooks';
import {getSelectedKeyboardAPI} from 'src/store/devicesSlice';
import {
  getToffeeLighting, LightingTab, LightingZone, loadToffeeLighting, selectLightingTab, updateLightingZone,
} from 'src/store/toffeeLightingSlice';
import {DEBUG_ENABLED} from 'src/config/debug';
import type {KeyboardAPI} from 'src/utils/keyboard-api';
import {BADGE_EFFECTS, FRONT_EFFECTS, REAR_EFFECTS} from 'src/utils/toffee_studio/lighting-effects';
import {zoneLook} from 'src/utils/toffee_studio/lighting-look';
import {FrontLedMenu} from '../front-led-menu';
import {colourName, HueSatPicker} from './hue-sat-picker';
import {eyebrow, focusRing, glass, glowEdge, HALO} from './halo-style';

const TABS: {id: LightingTab; label: string; debugOnly?: boolean}[] = [
  {id: 'rear', label: 'Underglow'},
  {id: 'front', label: 'Front Lighting'},
  {id: 'per-key', label: 'Per-Key LED', debugOnly: true},
  {id: 'badge', label: 'Badge'},
];
// Accessible names keep the original menus' wording ("Underglow brightness", "Front effect", ...).
const NAMES: Record<LightingZone, string> = {rear: 'Underglow', front: 'Front', badge: 'Badge'};

const Tabs = styled.nav`
  display: flex;
  gap: 24px;
`;

const Tab = styled.button<{$on: boolean}>`
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 44px;
  padding: 8px 4px 12px;
  border: 0;
  background: none;
  color: ${(props) => (props.$on ? '#fff' : 'rgba(255, 255, 255, 0.55)')};
  font-size: 16px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.3s;
  ${focusRing}
  &:hover {
    color: #fff;
  }
  &::after {
    content: '';
    display: ${(props) => (props.$on ? 'block' : 'none')};
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 2px;
    border-radius: 2px;
    background: color-mix(in srgb, #fff 35%, var(--zone));
    box-shadow: 0 0 10px var(--zone), 0 0 3px var(--zone);
  }
`;

const Dot = styled.span`
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--zone);
  box-shadow: 0 0 8px var(--zone);
`;

/** Zone tabs; they sit in the page header on the Lighting page. */
export function LightingZoneTabs() {
  const dispatch = useAppDispatch();
  const {tab, zones} = useAppSelector(getToffeeLighting);
  return (
    <Tabs aria-label="Lighting zones">
      {TABS.filter((item) => DEBUG_ENABLED || !item.debugOnly).map((item) => {
        const zone = item.id === 'per-key' ? 'front' : item.id;
        return (
          <Tab
            key={item.id}
            type="button"
            $on={item.id === tab}
            aria-current={item.id === tab ? 'page' : undefined}
            style={{'--zone': zoneLook(zone, zones?.[zone]).colour} as CSSProperties}
            onClick={() => dispatch(selectLightingTab(item.id))}
          >
            <Dot />
            {item.label}
          </Tab>
        );
      })}
    </Tabs>
  );
}

const Bar = styled.section`
  ${glass}
  border-radius: 20px;
  padding: 16px 22px;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 14px 32px;
  color: ${HALO.text};
  /* The global 24px paragraph is too loud here (the Debug Per-Key LED menu uses plain <p>). */
  p {
    margin: 0;
    font-size: 13px;
    color: ${HALO.muted};
  }
`;

const Column = styled.div<{$grow: string}>`
  flex: ${(props) => props.$grow};
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const Eyebrow = styled.span`
  ${eyebrow}
  display: flex;
  justify-content: space-between;
  gap: 12px;
  output {
    color: #e8e2ff;
    letter-spacing: 0;
    font-variant-numeric: tabular-nums;
  }
`;

const Chips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  max-height: 128px;
  overflow-y: auto;
  padding: 2px;
`;

const Chip = styled.button<{$on: boolean}>`
  min-height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid rgba(190, 160, 255, 0.18);
  background: rgba(255, 255, 255, 0.03);
  color: #cfc6ea;
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  ${focusRing}
  &:hover {
    border-color: rgba(190, 160, 255, 0.4);
    color: #fff;
  }
  ${(props) => props.$on && glowEdge}
`;

const Range = styled.input`
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 26px;
  margin: 0;
  background: transparent;
  cursor: pointer;
  ${focusRing}
  &::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 4px;
    background: linear-gradient(90deg, var(--zone) 0, var(--zone) var(--pct), ${HALO.line} var(--pct));
  }
  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 20px;
    height: 20px;
    margin-top: -8px;
    border-radius: 50%;
    background: #020112;
    border: 1.5px solid color-mix(in srgb, #fff 35%, var(--zone));
    box-shadow: 0 0 12px var(--zone);
  }
  &::-moz-range-track {
    height: 4px;
    border-radius: 4px;
    background: ${HALO.line};
  }
  &::-moz-range-progress {
    height: 4px;
    border-radius: 4px;
    background: var(--zone);
  }
  &::-moz-range-thumb {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #020112;
    border: 1.5px solid var(--zone);
  }
`;

const Note = styled.p`
  flex-basis: 100%;
`;

const Message = styled.div`
  font-size: 15px;
  button {
    margin-left: 12px;
  }
`;

function Slider({label, name, value, colour, onChange}: {
  label: string; name: string; value: number; colour: string; onChange: (value: number) => void;
}) {
  return (
    <label style={{display: 'flex', flexDirection: 'column', gap: 4}}>
      <Eyebrow>{label}<output>{value} / 255</output></Eyebrow>
      <Range
        type="range"
        aria-label={name}
        min={0}
        max={255}
        value={value}
        style={{'--zone': colour, '--pct': `${(value / 255) * 100}%`} as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function ZoneControls({keyboard, zone}: {keyboard: KeyboardAPI; zone: LightingZone}) {
  const dispatch = useAppDispatch();
  const {capabilities, zones} = useAppSelector(getToffeeLighting);
  const state = zones![zone];
  const name = NAMES[zone];
  const colour = zoneLook(zone, state).colour;
  const animated = zone !== 'badge' || capabilities!.version === 3;
  const effects = zone === 'rear' ? REAR_EFFECTS
    : zone === 'front' ? FRONT_EFFECTS.slice(0, capabilities!.frontEffects) : BADGE_EFFECTS;
  const update = (change: Parameters<typeof updateLightingZone>[2]) =>
    dispatch(updateLightingZone(keyboard, zone, change));
  return (
    <Bar aria-label={`${TABS.find((item) => item.id === zone)!.label} settings`}>
      <Column $grow="2 1 340px">
        {animated ? (
          <>
            <Eyebrow>{name} effect<output>{effects[state.effect].label}</output></Eyebrow>
            <Chips role="group" aria-label={`${name} effect`}>
              {effects.map((effect) => (
                <Chip
                  key={effect.value}
                  type="button"
                  $on={effect.value === state.effect}
                  aria-pressed={effect.value === state.effect}
                  onClick={() => update({effect: effect.value})}
                >
                  {effect.label}
                </Chip>
              ))}
            </Chips>
          </>
        ) : (
          <label style={{display: 'flex', alignItems: 'center', gap: 10, fontSize: 15}}>
            <input
              type="checkbox"
              aria-label="Badge lighting enabled"
              checked={state.effect === 1}
              onChange={(event) => update({effect: Number(event.target.checked)})}
            />
            Badge on
          </label>
        )}
      </Column>
      <Column $grow="1 1 220px">
        <Slider label="Brightness" name={`${name} brightness`} value={state.brightness} colour={colour}
          onChange={(brightness) => update({brightness})} />
        {animated && (
          <Slider label="Speed" name={`${name} speed`} value={state.speed} colour={colour}
            onChange={(speed) => update({speed})} />
        )}
      </Column>
      <Column $grow="0 1 auto">
        <Eyebrow>Colour<output>{colourName(state.hue, state.saturation)}</output></Eyebrow>
        <HueSatPicker label={`${name} colour`} hue={state.hue} saturation={state.saturation}
          onChange={(hue, saturation) => update({hue, saturation})} />
      </Column>
      <Note>
        Normal firmware saves changes after a one-second pause. Temporary test firmware does not save.
        {zone === 'badge' && ' The badge is independent of front and rear lighting.'}
        {capabilities!.version === 2 && ' Update firmware to unlock reactive front effects and badge animations.'}
      </Note>
    </Bar>
  );
}

/** The Lighting page's control bar for the selected tab. */
export function HaloLightingControls() {
  const dispatch = useAppDispatch();
  const keyboard = useAppSelector(getSelectedKeyboardAPI);
  const {tab, status, error} = useAppSelector(getToffeeLighting);
  // Read the board again whenever the page opens; other pages can change front lighting.
  useEffect(() => {
    if (keyboard) dispatch(loadToffeeLighting(keyboard));
  }, [keyboard, dispatch]);

  if (!keyboard) return <Bar><Message>Connect and select your board to configure lighting.</Message></Bar>;
  if (tab === 'per-key') {
    return <Bar aria-label="Per-Key LED settings"><Column $grow="1 1 auto"><FrontLedMenu /></Column></Bar>;
  }
  if (status === 'error') {
    return (
      <Bar>
        <Message role="alert">
          Unable to configure lighting: {error}
          <button type="button" onClick={() => dispatch(loadToffeeLighting(keyboard))}>Retry</button>
        </Message>
      </Bar>
    );
  }
  if (status !== 'ready') return <Bar><Message>Loading lighting…</Message></Bar>;
  return <ZoneControls keyboard={keyboard} zone={tab} />;
}
