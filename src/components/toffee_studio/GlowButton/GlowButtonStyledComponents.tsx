import styled from 'styled-components';

interface GlowButtonProps {
  $buttonBackground: string;
  $buttonShadow: string;
  $buttonShineLeft: string;
  $buttonShineRight: string;
  $buttonGlowStart: string;
  $buttonGlowEnd: string;
  $square?: boolean;
  $basic?: boolean;
}

export const GlowButton = styled.div<GlowButtonProps>`
  --button-background: ${props => props.$buttonBackground};
  --button-color: #fff;
  --button-shadow: ${props => props.$buttonShadow};
  --button-shine-left: ${props => props.$buttonShineLeft};
  --button-shine-right: ${props => props.$buttonShineRight};
  --button-glow-start: ${props => props.$buttonGlowStart};
  --button-glow-end: ${props => props.$buttonGlowEnd};
  --button-padding: 1px;
  --button-radius: ${props => props.$square ? '8px' : '12px'};

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
  box-shadow: ${props => props.$basic ? 'none' : '0 8px 20px var(--button-shadow)'};
  
  /* Fix layout issues */
  box-sizing: border-box;
  
  /* Square specific styles */
  width: ${props => props.$square ? '100%' : 'auto'};
  height: ${props => props.$square ? '100%' : 'auto'};
  aspect-ratio: ${props => props.$square ? '1' : 'auto'};

  &:hover {
    --button-glow-opacity: ${props => props.$basic ? '0' : '1'};
    --button-glow-duration: 0.25s;
  }
`

interface GlowButtonInnerProps {
  $forceOn?: boolean;
  $buttonBrightenedBackground: string;
  $square?: boolean;
  $basic?: boolean;
}

export const GlowButtonInner = styled.div<GlowButtonInnerProps>`
  transition: all 200ms ease-out;
  z-index: 1;
  position: relative;
  padding: ${props => props.$square ? '0' : '10px 28px'};
  box-sizing: border-box;
  width: 100%;
  height: 100%; 
  border-radius: calc(var(--button-radius) - var(--button-padding));
  
  /* Background logic: Basic gets darker mix, otherwise standard or brightened on force */
  background-color: ${props => 
    props.$basic 
      ? 'color-mix(in srgb, var(--button-background), black 10%)' 
      : (props.$forceOn ? props.$buttonBrightenedBackground : "var(--button-background)")
  };
  
  overflow: hidden;
  -webkit-mask-image: -webkit-radial-gradient(white, black);

  /* Flex centering for square buttons */
  display: ${props => props.$square ? 'flex' : 'block'};
  align-items: center;
  justify-content: center;
  text-align: center;

  &::before {
    content: '';
    display: ${props => props.$basic ? 'none' : 'block'};
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

interface GlowButtonGradientProps {
  $square?: boolean;
  $basic?: boolean;
}

export const GlowButtonGradient = styled.div<GlowButtonGradientProps>`
  opacity: 0;
  display: ${props => props.$basic ? 'none' : 'block'};
  transition: all 200ms ease-out;
  position: absolute;
  inset: 0;
  border-radius: inherit;
  overflow: hidden;
  -webkit-mask-image: -webkit-radial-gradient(white, black);
  
  /* Only skew/rotate for rectangular buttons */
  transform: ${props => props.$square ? 'none' : 'scaleY(1.02) scaleX(1.05) rotate(-0.35deg)'};

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
