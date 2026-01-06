import React from 'react';
import { ToggleWrapper, ToggleKnob } from './GlowToggleStyledComponents';
import { useAppSelector } from 'src/store/hooks';
import { getSelectedTheme } from 'src/store/settingsSlice';

interface GlowToggleProps {
  value: boolean;
  onChange: (newValue: boolean) => void;
  className?: string;
  style?: React.CSSProperties;
}

const GlowToggle: React.FC<GlowToggleProps> = ({ value, onChange, className, style }) => {
  const theme = useAppSelector(getSelectedTheme);

  // Eclipse Halo Style Configuration
  
  // [5] = Glow Container background (Dark Blue/Purple) -> Used for Knob Fill
  const knobBg = theme?.glow?.[5] || '#1a1d2e';
  
  // Structural Border Color (#3B2F63). 
  // Used for the Knob Border (inactive) AND the Track to ensure visibility.
  // This fixes the issue where theme.glow[6] (#2c2f48) was too faded against black.
  const structureColor = '#3B2F63';
  
  // [0] = buttonShineLeft (Purple) -> Used for Halo/Active Border
  const glowColor = theme?.glow?.[0] || '#7b4dff';

  return (
    <ToggleWrapper
      className={className}
      style={style}
      $trackColor={structureColor}
      onClick={(e) => {
        e.preventDefault();
        onChange(!value);
      }}
    >
      <ToggleKnob 
        $active={value} 
        $knobBg={knobBg}
        $knobBorderInactive={structureColor}
        $glowColor={glowColor}
      />
    </ToggleWrapper>
  );
};

export default GlowToggle;
