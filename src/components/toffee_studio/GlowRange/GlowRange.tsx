import React from 'react';
import { RangeInput } from './GlowRangeStyledComponents';
import { useAppSelector } from 'src/store/hooks';
import { getSelectedTheme } from 'src/store/settingsSlice';

interface GlowRangeProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  onChange: (value: number) => void;
}

const GlowRange: React.FC<GlowRangeProps> = ({ onChange, value, min = 0, max = 100, ...props }) => {
  const theme = useAppSelector(getSelectedTheme);

  // Theme mappings for Eclipse Halo style
  const trackColor = '#3B2F63';
  const thumbBg = theme?.glow?.[5] || '#1a1d2e';
  const thumbBorder = '#3B2F63';
  const glowColor = theme?.glow?.[0] || '#7b4dff';

  const curr = Number(value) || 0;
  const minVal = Number(min);
  const maxVal = Number(max);
  const percent = ((curr - minVal) * 100) / (maxVal - minVal);

  return (
    <div style={{ display: 'flex', alignItems: 'center', width: '200px' }}>
      <RangeInput
        {...props}
        min={min}
        max={max}
        value={value}
        $percent={percent}
        $trackColor={trackColor}
        $thumbBg={thumbBg}
        $thumbBorder={thumbBorder}
        $glowColor={glowColor}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
};

export default GlowRange;
