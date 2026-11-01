// Shared look for the Halo Stage UI (01 Halo Stage, 17 Oct prototypes): slightly frosted glass,
// violet-to-lavender edges and Montserrat on a near-black ground.
import {css, keyframes} from 'styled-components';

export const HALO = {
  text: '#f3efff',
  muted: '#a79fc4',
  label: '#8f86b0',
  line: '#3b2f63',
  lavender: '#c8a8ff',
};

export const glass = css`
  background: rgba(14, 9, 30, 0.5);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
  backdrop-filter: blur(20px) saturate(140%);
  border: 1px solid rgba(190, 160, 255, 0.13);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 24px 60px rgba(0, 0, 0, 0.35);
`;

// The selected state of sidebar items and effect chips.
export const glowEdge = css`
  color: #fff;
  border-color: transparent;
  background: linear-gradient(rgba(16, 7, 46, 0.94), rgba(16, 7, 46, 0.94)) padding-box,
    linear-gradient(90deg, rgba(120, 0, 245, 0.9), rgba(200, 148, 255, 0.9)) border-box;
  box-shadow: 0 0 22px rgba(120, 0, 245, 0.35);
`;

export const eyebrow = css`
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: ${HALO.label};
`;

export const focusRing = css`
  &:focus-visible {
    outline: 2px solid ${HALO.lavender};
    outline-offset: 2px;
  }
`;

const breathe = keyframes`0%, 100% {opacity: 1} 50% {opacity: 0.2}`;
const hueTurn = keyframes`to {filter: hue-rotate(360deg)}`;
const flicker = keyframes`
  0%, 100% {opacity: 1} 18% {opacity: 0.5} 34% {opacity: 0.95} 58% {opacity: 0.35} 78% {opacity: 0.85}
`;
// A hint of each effect's motion. It is not a per-LED simulation.
export const motion = {
  none: css``,
  breathe: css`animation: ${breathe} 3.4s ease-in-out infinite;`,
  cycle: css`animation: ${hueTurn} 9s linear infinite;`,
  flicker: css`animation: ${flicker} 2.2s ease-in-out infinite;`,
};
