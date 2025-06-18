import React from 'react';
import { TooltipWrapper, TooltipBox } from './GlowTooltipStyledComponents';
import GlowContainer from '../GlowContainer/GlowContainer';
import { useAppSelector } from 'src/store/hooks';
import { getSelectedTheme } from 'src/store/settingsSlice';

export type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

interface GlowTooltipProps {
  children: React.ReactNode;
  title: string;
  position?: TooltipPosition;
  width?: string;
}

const GlowTooltip: React.FC<GlowTooltipProps> = ({ children, title, position = 'top', width }) => {
  const theme = useAppSelector(getSelectedTheme);

  // If the theme is not yet loaded, we can't render the glow. 
  // Render the children without a tooltip to prevent a crash.
  if (!theme) {
    return <>{children}</>;
  }

  // GlowContainer expects a 6-element array, with [4] for border and [5] for background.
  const tooltipColors = [
    theme.glow[0] || '#ff00ff', // Fallback color
    theme.glow[1] || '#00ffff', // Fallback color
    theme.glow[2] || '#ff00ff', // Fallback color
    theme.glow[3] || '#00ffff', // Fallback color
    theme.glow[4] || '#00ffff80', // Border/Glow color
    theme.glow[5] || '#1a1d2e'  // Background color
  ];

  return (
    <TooltipWrapper>
      {children}
      <TooltipBox position={position} width={width}>
        <GlowContainer colors={tooltipColors} style={{ padding: '8px 12px', borderRadius: '6px' }}>
          {title}
        </GlowContainer>
      </TooltipBox>
    </TooltipWrapper>
  );
};

export default GlowTooltip;
