// The Halo Stage background: the board's own lighting, softly. The underglow rises from below,
// front lighting washes the top and the badge glints top right. Display only.
import type {CSSProperties} from 'react';
import styled from 'styled-components';
import {useAppSelector} from 'src/store/hooks';
import {getToffeeLighting, LightingZone} from 'src/store/toffeeLightingSlice';
import {EffectMotion, zoneLook} from 'src/utils/toffee_studio/lighting-look';
import {motion} from './halo-style';

const STRENGTH = 0.45;
const BLOBS: {zone: LightingZone; scale: number; place: CSSProperties}[] = [
  {zone: 'rear', scale: 1, place: {left: '22%', right: '6%', bottom: '-22%', height: '62%'}},
  {zone: 'front', scale: 0.6, place: {left: '30%', right: '18%', top: '-30%', height: '46%'}},
  {zone: 'badge', scale: 0.7, place: {right: '-8%', top: '-12%', width: '26%', height: '34%'}},
];

const Layer = styled.div`
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  background: #050308;
`;

const Blob = styled.div`
  position: absolute;
  border-radius: 50%;
  filter: blur(110px);
  transition: opacity 0.7s ease;
`;

const Light = styled.span<{$motion: EffectMotion}>`
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  transition: background-color 0.7s ease;
  ${(props) => motion[props.$motion]}
  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

export function HaloAmbient() {
  const {zones} = useAppSelector(getToffeeLighting);
  return (
    <Layer aria-hidden="true" data-testid="halo-ambient">
      {BLOBS.map(({zone, scale, place}) => {
        const look = zoneLook(zone, zones?.[zone]);
        return (
          <Blob key={zone} data-zone={zone} style={{...place, opacity: look.level * STRENGTH * scale}}>
            <Light $motion={look.motion} style={{backgroundColor: look.colour}} />
          </Blob>
        );
      })}
    </Layer>
  );
}
