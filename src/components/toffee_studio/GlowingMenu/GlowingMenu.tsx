import React, { useState, useEffect, useRef } from 'react';
import styled, { css } from 'styled-components';
import { useAppSelector } from 'src/store/hooks';
import { getSelectedTheme } from 'src/store/settingsSlice';

interface MenuProps {
  items: string[];
  onChange?: (index: number) => void;
  selectedIndex?: number;
  fontSize?: string;
  position?: 'top' | 'bottom';
  hideBaseLine?: boolean; // Hides the static full-width grey line
  hideIndicator?: boolean; // <-- NEW PROP: Hides the moving glowing line
}

export const GlowingMenu: React.FC<MenuProps> = ({ 
  items, 
  onChange, 
  selectedIndex, 
  fontSize,
  position = 'bottom',
  hideBaseLine = false,
  hideIndicator = false // Default to showing it
}) => {
  const theme = useAppSelector(getSelectedTheme);
  
  const [internalIndex, setInternalIndex] = useState(0);
  const activeIndex = selectedIndex !== undefined ? selectedIndex : internalIndex;

  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  const glowColor = theme?.glow?.[0] || '#7b4dff'; 
  const coreColor = '#ffffff';

  useEffect(() => {
    const currentItem = itemRefs.current[activeIndex];
    if (currentItem) {
      setIndicatorStyle({
        left: currentItem.offsetLeft,
        width: currentItem.clientWidth,
      });
    }
  }, [activeIndex, items]);

  const handleItemClick = (index: number) => {
    setInternalIndex(index);
    if (onChange) onChange(index);
  };

  return (
    <MenuWrapper $position={position}>
      <MenuList $position={position}>
        {items.map((item, index) => (
          <MenuItem
            key={item}
            ref={(el) => (itemRefs.current[index] = el)}
            $isActive={index === activeIndex}
            $fontSize={fontSize}
            onClick={() => handleItemClick(index)}
          >
            {item}
          </MenuItem>
        ))}
        
        {/* Only render the moving glow line if hideIndicator is FALSE */}
        {!hideIndicator && (
          <GlowLineContainer 
            $position={position}
            style={{ 
              left: `${indicatorStyle.left}px`, 
              width: `${indicatorStyle.width}px` 
            }}
          >
            <GlowLine $coreColor={coreColor} $glowColor={glowColor} />
            <GlowSpill $glowColor={glowColor} />
          </GlowLineContainer>
        )}
      </MenuList>
      
      {!hideBaseLine && <BaseLine $position={position} />}
    </MenuWrapper>
  );
};

// Styles

const MenuWrapper = styled.div<{ $position: 'top' | 'bottom' }>`
  position: relative;
  display: inline-block; 
  margin: 0 auto;
`;

const MenuList = styled.div<{ $position: 'top' | 'bottom' }>`
  display: flex;
  position: relative;
  gap: 30px;
  padding-bottom: ${props => props.$position === 'bottom' ? '12px' : '6px'};
  padding-top: ${props => props.$position === 'top' ? '12px' : '6px'};
`;

const MenuItem = styled.div<{ $isActive: boolean; $fontSize?: string }>`
  font-size: ${props => props.$fontSize || '18px'};
  font-weight: 500;
  cursor: pointer;
  transition: color 0.3s ease;
  user-select: none;
  color: ${props => props.$isActive ? '#FFFFFF' : 'rgba(255, 255, 255, 0.5)'};
  
  &:hover {
    color: #FFFFFF;
  }
`;

const BaseLine = styled.div<{ $position: 'top' | 'bottom' }>`
  position: absolute;
  ${props => props.$position === 'top' ? 'top: 0;' : 'bottom: 0;'}
  left: 0;
  width: 100%;
  height: 1px;
  background: rgba(255, 255, 255, 0.15);
`;

const GlowLineContainer = styled.div<{ $position: 'top' | 'bottom' }>`
  position: absolute;
  ${props => props.$position === 'top' ? 'top: 0;' : 'bottom: 0;'}
  height: 1px;
  transition: all 0.4s cubic-bezier(0.25, 1, 0.5, 1);
  pointer-events: none;
  display: flex;
  justify-content: center;
  z-index: 10;
`;

const GlowLine = styled.div<{ $coreColor: string, $glowColor: string }>`
  width: 100%;
  height: 100%;
  background-color: color-mix(in srgb, ${props => props.$coreColor} 30%, ${props => props.$glowColor});
  border-radius: 2px;
  box-shadow: 
    0 0 4px color-mix(in srgb, ${props => props.$coreColor} 50%, ${props => props.$glowColor}),
    0 0 10px ${props => props.$glowColor};
  z-index: 2;
`;

const GlowSpill = styled.div<{ $glowColor: string }>`
  position: absolute;
  top: 0;
  width: 150%;
  height: 50px;
  background: radial-gradient(
    ellipse at top, 
    ${props => props.$glowColor} 0%, 
    rgba(0,0,0,0) 70%
  );
  opacity: 0.3;
  z-index: 1;
  filter: blur(3px);
`;
