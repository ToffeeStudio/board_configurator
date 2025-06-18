import styled from 'styled-components';

import type { TooltipPosition } from './GlowTooltip';

interface TooltipBoxProps {
  position: TooltipPosition;
  width?: string;
}

export const TooltipWrapper = styled.div`
  position: relative;
  display: inline-block;
`;

export const TooltipBox = styled.div<TooltipBoxProps>`
  width: ${({ width }) => width || 'auto'};
  position: absolute;
  ${({ position }) => {
    switch (position) {
      case 'bottom':
        return `
          top: 125%;
          left: 50%;
          transform: translateX(-50%);
        `;
      case 'left':
        return `
          top: 50%;
          right: 105%; // Position to the left of the element
          transform: translateY(-50%);
        `;
      case 'right':
        return `
          top: 50%;
          left: 105%; // Position to the right of the element
          transform: translateY(-50%);
        `;
      case 'top':
      default:
        return `
          bottom: 125%; // Position above the element
          left: 50%;
          transform: translateX(-50%);
        `;
    }
  }}
  color: #fff;
  z-index: 10;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.2s, visibility 0.2s;




  ${TooltipWrapper}:hover & {
    opacity: 1;
    visibility: visible;
  }
`;
