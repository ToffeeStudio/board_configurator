import styled, { css } from 'styled-components';

interface ToggleWrapperProps {
  $trackColor: string;
}

export const ToggleWrapper = styled.label<ToggleWrapperProps>`
  position: relative;
  display: inline-block;
  width: 48px;
  height: 24px;
  cursor: pointer;
  
  /* The track is just a thin line */
  &::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 0;
    width: 100%;
    height: 4px;
    background: ${props => props.$trackColor};
    border-radius: 4px;
    transform: translateY(-50%);
  }
`;

interface ToggleKnobProps {
  $active: boolean;
  $knobBg: string;
  $knobBorderInactive: string;
  $glowColor: string;
}

export const ToggleKnob = styled.span<ToggleKnobProps>`
  position: absolute;
  top: 0;
  left: 0;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: ${props => props.$knobBg};
  border: 1.5px solid ${props => props.$knobBorderInactive};
  box-sizing: border-box;
  
  /* Simple ease-out to remove bounce */
  transition: all 0.2s ease-out; 
  box-shadow: 0 0 0 rgba(0,0,0,0);

  ${props => props.$active && css`
    transform: translateX(24px);
    background: ${props.$knobBg}; /* Stays dark fill */
    
    /* Matches GlowingMenu core/glow mix */
    border-color: color-mix(in srgb, #ffffff 30%, ${props.$glowColor});
    
    /* Subtle halo */
    box-shadow: 0 0 10px ${props.$glowColor}; 
  `}
`;
