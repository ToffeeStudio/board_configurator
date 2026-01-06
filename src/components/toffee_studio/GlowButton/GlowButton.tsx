import './GlowButton.css';
import { useState, useEffect } from 'react';
import { gsap } from 'gsap';
import chroma from 'chroma-js';
import { GlowButton, GlowButtonInner, GlowButtonGradient } from './GlowButtonStyledComponents'
import { useAppSelector } from 'src/store/hooks';
import { getSelectedTheme } from 'src/store/settingsSlice';

const brightenColor = (hex: any, percent: any) => {
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

const generateGlowButtons = () => {
  document.querySelectorAll('.glow-button').forEach((button) => {
    button.addEventListener('pointermove', (e: any) => {
      const rect = button.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      gsap.to(button, {
        '--pointer-x': `${x}px`,
        '--pointer-y': `${y}px`,
        duration: 0.6,
      });

      gsap.to(button, {
        '--button-glow': chroma
          .mix(
            getComputedStyle(button).getPropertyValue('--button-glow-start').trim(),
            getComputedStyle(button).getPropertyValue('--button-glow-end').trim(),
            x / rect.width
          )
          .hex(),
        duration: 0.2,
      });
    });
  });
};


export default ({onClick, children, forceOn, sx, square, basic}: any) => {

  const theme = useAppSelector(getSelectedTheme);

  const [ hovered, setHovered ] = useState(false);
  useEffect(() => {
    if (!basic) {
      generateGlowButtons();
      window.addEventListener('resize', generateGlowButtons);
      return () => {
        window.removeEventListener('resize', generateGlowButtons);
      };
    }
  }, [basic]);

  // Border Logic:
  // Basic Mode: Always solid border. Dim (4D) by default, Opaque (FF) on hover.
  // Glow Mode: Transparent (00) when glowing (so gradient shows), Opaque (FF) when static.
  const borderColor = theme.glow?.[4] || '#fff';
  const borderStyle = basic 
    ? `1px solid ${borderColor}${hovered ? 'FF' : '6D'}`
    : (forceOn || hovered) ? `1px solid ${borderColor}00` : `1px solid ${borderColor}FF`;

  return (
    <GlowButton
      className="glow-button"
      style={{
        border: borderStyle,
      }}
      onClick={onClick}
      onMouseEnter={()=>setHovered(true)}
      onMouseLeave={()=>setHovered(false)}
      $buttonShineLeft={theme.glow[0]}
      $buttonShineRight={theme.glow[1]}
      $buttonGlowStart={theme.glow[2]}
      $buttonGlowEnd={theme.glow[3]}
      $buttonBackground={theme.glow[6]}
      $buttonShadow={theme.glow[7]}
      $square={square}
      $basic={basic}
    >
      <GlowButtonInner
        className="inner"
        $forceOn={forceOn}
        $buttonBrightenedBackground={brightenColor(theme.glow[6], 35)}
        $square={square}
        $basic={basic}
        style={sx}
      >
        {children}
      </GlowButtonInner>
      <GlowButtonGradient
        className="gradient"
        $square={square}
        $basic={basic}
        style={{
          opacity: (hovered || forceOn) ? 100 : 0
        }} 
      />
    </GlowButton>
  );
};
