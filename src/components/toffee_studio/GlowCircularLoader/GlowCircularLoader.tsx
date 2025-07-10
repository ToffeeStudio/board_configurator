import React from 'react';
import { useAppSelector } from 'src/store/hooks';
import { getSelectedTheme } from 'src/store/settingsSlice';
import {
  LoaderWrapper,
  LoaderSpan,
  LoaderInnerCutout,
} from './GlowCircularLoaderStyledComponents';
import { Theme } from 'src/utils/themes';

interface GlowCircularLoaderProps {
  size?: string;
  thickness?: string;
  animationDuration?: string;
  blurLevels?: string[];
  colors?: [string, string];
  innerBackgroundColor?: string;
  sx?: React.CSSProperties;
}

const GlowCircularLoader: React.FC<GlowCircularLoaderProps> = ({
  size = '100px',
  thickness = '4px',
  animationDuration = '0.5s',
  blurLevels = ['5px', '10px', '25px', '50px'],
  colors,
  innerBackgroundColor,
  sx,
}) => {
  const theme = useAppSelector(getSelectedTheme) as Theme;

  const gradientColorStart = colors ? colors[0] : theme.glow[0];
  const gradientColorEnd = colors ? colors[1] : theme.glow[1];
  const finalInnerBgColor = innerBackgroundColor || 'black';

  return (
    <LoaderWrapper
      $size={size}
      $gradientColorStart={gradientColorStart}
      $gradientColorEnd={gradientColorEnd}
      $animationDuration={animationDuration}
      style={sx}
    >
      {blurLevels.map((blur, index) => (
        <LoaderSpan
          key={index}
          $gradientColorStart={gradientColorStart}
          $gradientColorEnd={gradientColorEnd}
          $blurAmount={blur}
        />
      ))}
      <LoaderInnerCutout
        $thickness={thickness}
        $innerBackgroundColor={finalInnerBgColor}
        $gradientColorStart={gradientColorStart}
        $gradientColorEnd={gradientColorEnd}
      />
    </LoaderWrapper>
  );
};

export default GlowCircularLoader;
