import styled from 'styled-components';

const brightenColor = (hex: string, percent: number) => {
  // Convert hex to RGB
  let r = parseInt(hex.substring(1, 3), 16);
  let g = parseInt(hex.substring(3, 5), 16);
  let b = parseInt(hex.substring(5, 7), 16);

  // Increase brightness by the given percentage
  r = Math.min(255, Math.floor(r * (1 + percent / 100)));
  g = Math.min(255, Math.floor(g * (1 + percent / 100)));
  b = Math.min(255, Math.floor(b * (1 + percent / 100)));

  // Convert RGB back to hex
  const newHex = `#${((1 << 24) + (r << 16) + (g << 8) + b)
    .toString(16)
    .slice(1)
    .toUpperCase()}`;

  return newHex;
}

interface GlowButtonProps {
  buttonBackground: string;
  buttonShadow: string;
  buttonShineLeft: string;
  buttonShineRight: string;
  buttonGlowStart: string;
  buttonGlowEnd: string;
}

export const GlowButton = styled.div<GlowButtonProps>`
  --button-background: ${props => props.buttonBackground};
  --button-color: #fff;
  --button-shadow: ${props => props.buttonShadow};
  --button-shine-left: ${props => props.buttonShineLeft};
  --button-shine-right: ${props => props.buttonShineRight};
  --button-glow-start: ${props => props.buttonGlowStart};
  --button-glow-end: ${props => props.buttonGlowEnd};
  --button-padding: 1px;
  --button-radius: 12px;

  transition: all 200ms ease-out;
  overflow: hidden;
  appearance: none;
  outline: none;
  border: none;
  font-family: inherit;
  font-size: 16px;
  font-weight: 500;
  border-radius: var(--button-radius);
  padding: var(--button-padding);
  position: relative;
  line-height: 24px;
  cursor: pointer;
  color: var(--button-color);
  margin: 0;
  background: none;
  z-index: 1;
  box-shadow: 0 8px 20px var(--button-shadow);

  &:hover {
  --button-glow-opacity: 1;
  --button-glow-duration: 0.25s;
  }
`

interface GlowButtonInnerProps {
  forceOn?: boolean;
  buttonBrightenedBackground: string;
}

export const GlowButtonInner = styled.div<GlowButtonInnerProps>`
  transition: all 200ms ease-out;
  z-index: 1;
  position: relative;
  padding: 10px 28px;
  box-sizing: border-box;
  width: 100%;
  border-radius: calc(var(--button-radius) - var(--button-padding));
  background-color: ${props=>props.forceOn ? props.buttonBrightenedBackground : "var(--button-background)"};
  overflow: hidden;
  -webkit-mask-image: -webkit-radial-gradient(white, black);

  &::before {
    content: '';
    position: absolute;
    left: -16px;
    top: -16px;
    transform: translate(var(--pointer-x, 0px), var(--pointer-y, 0px)) translateZ(0);
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background-color: var(--button-glow, transparent);
    opacity: var(--button-glow-opacity, 0);
    transition: opacity var(--button-glow-duration, 0.5s);
    filter: blur(20px);
  }
`

export const GlowButtonGradient = styled.div`
  opacity: 0;
  transition: all 200ms ease-out;
  position: absolute;
  inset: 0;
  border-radius: inherit;
  overflow: hidden;
  -webkit-mask-image: -webkit-radial-gradient(white, black);
  transform: scaleY(1.02) scaleX(1.05) rotate(-0.35deg);
  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    transform: scale(1.14) translateY(-15%) rotate(0deg) translateZ(0);
    padding-bottom: 100%;
    border-radius: 50%;
    background: linear-gradient(90deg, var(--button-shine-left), var(--button-shine-right));
    animation: rotate linear 2s infinite;
  }
`
