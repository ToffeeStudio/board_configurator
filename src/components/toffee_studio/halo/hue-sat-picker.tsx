// Hue/saturation picker for the board's 0–255 hue and saturation. On the wheel, the angle is hue
// (red at the top, clockwise like QMK) and the distance from the centre is saturation; brightness has
// its own slider. Swatches below are shortcuts.
import {CSSProperties, KeyboardEvent, PointerEvent, useRef} from 'react';
import chroma from 'chroma-js';
import styled from 'styled-components';
import {zoneHex} from 'src/utils/toffee_studio/lighting-look';
import {focusRing} from './halo-style';

const SWATCHES = [
  ['Violet', '#7b2dff'], ['Lavender', '#b48cff'], ['Magenta', '#ff3dbb'], ['Sunset', '#ff5a1f'],
  ['Amber', '#ffb020'], ['Mint', '#2bf5b0'], ['Cyan', '#19c8ff'], ['White', '#ffffff'],
].map(([name, hex]) => {
  const [h, s] = chroma(hex).hsv();
  return {name, hex, hue: Math.round(((h || 0) / 360) * 255), saturation: Math.round(s * 255)};
});

export const colourName = (hue: number, saturation: number) =>
  SWATCHES.find((swatch) => swatch.hue === hue && swatch.saturation === saturation)?.name ?? 'Custom';

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
`;

const Wheel = styled.div`
  position: relative;
  flex: none;
  width: 112px;
  height: 112px;
  border-radius: 50%;
  background: radial-gradient(closest-side, #fff, rgba(255, 255, 255, 0)),
    conic-gradient(#f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.18), 0 0 24px rgba(0, 0, 0, 0.45);
  cursor: crosshair;
  touch-action: none;
  ${focusRing}
`;

const Handle = styled.span`
  position: absolute;
  width: 18px;
  height: 18px;
  margin: -9px 0 0 -9px;
  border-radius: 50%;
  box-shadow: 0 0 0 2px #fff, 0 0 0 3.5px rgba(10, 6, 20, 0.85), 0 0 12px rgba(0, 0, 0, 0.5);
  pointer-events: none;
`;

const Swatches = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 36px);
  gap: 4px;
`;

const Swatch = styled.button<{$on: boolean}>`
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  display: grid;
  place-items: center;
  ${focusRing}
  span {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    box-shadow: ${(props) => (props.$on
      ? '0 0 0 2px #0a0614, 0 0 0 4px #fff, 0 0 14px var(--swatch)'
      : 'inset 0 0 0 1px rgba(255, 255, 255, 0.25)')};
  }
`;

export function HueSatPicker({label, hue, saturation, onChange}: {
  label: string;
  hue: number;
  saturation: number;
  onChange: (hue: number, saturation: number) => void;
}) {
  const wheel = useRef<HTMLDivElement>(null);
  const set = (nextHue: number, nextSaturation: number) => {
    if (nextHue !== hue || nextSaturation !== saturation) onChange(nextHue, nextSaturation);
  };
  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const rect = wheel.current!.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;
    const turn = (Math.atan2(x, -y) / (2 * Math.PI) + 1) % 1;
    set(Math.round(turn * 255), Math.round(Math.min(1, Math.hypot(x, y) / (rect.width / 2)) * 255));
  };
  const step = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-4, 0], ArrowRight: [4, 0], ArrowUp: [0, 8], ArrowDown: [0, -8],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    set((hue + move[0] + 256) % 256, Math.max(0, Math.min(255, saturation + move[1])));
  };
  const angle = (hue / 255) * 2 * Math.PI;
  const radius = (saturation / 255) * 50;
  return (
    <Row>
      <Wheel
        ref={wheel}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={255}
        aria-valuenow={hue}
        aria-valuetext={`Hue ${hue}, saturation ${saturation}`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          pick(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) pick(event);
        }}
        onKeyDown={step}
      >
        <Handle
          style={{
            left: `${50 + Math.sin(angle) * radius}%`,
            top: `${50 - Math.cos(angle) * radius}%`,
            background: zoneHex(hue, saturation),
          }}
        />
      </Wheel>
      <Swatches>
        {SWATCHES.map((swatch) => (
          <Swatch
            key={swatch.name}
            type="button"
            title={swatch.name}
            aria-label={swatch.name}
            aria-pressed={swatch.hue === hue && swatch.saturation === saturation}
            $on={swatch.hue === hue && swatch.saturation === saturation}
            style={{'--swatch': swatch.hex} as CSSProperties}
            onClick={() => set(swatch.hue, swatch.saturation)}
          >
            <span style={{background: swatch.hex}} />
          </Swatch>
        ))}
      </Swatches>
    </Row>
  );
}
