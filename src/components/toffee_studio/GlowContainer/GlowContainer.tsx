import { useEffect, useRef, useState } from 'react';
import { useAppSelector } from 'src/store/hooks';
import { getSelectedTheme } from 'src/store/settingsSlice';

interface GlowContainerProps {
  style?: React.CSSProperties;
  children: React.ReactNode;
  width?: string;
  height?: string;
}

const GlowContainer: React.FC<GlowContainerProps> = ({ style, children }) => {
  
  const theme = useAppSelector(getSelectedTheme);
  
  // Mapped to the index used in your Product Configurator
  // [4] = Border/Glow Color, [5] = Background Color
  const borderCol = theme?.glow?.[4] || '#3B2F63'; 
  const backgroundCol = theme?.glow?.[5] || '#020112';

  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setWidth(containerRef.current.offsetWidth);
        setHeight(containerRef.current.offsetHeight);
      }
    };
    // Initial sizing
    updateDimensions();
    
    // Resize observer is cleaner than window resize for specific elements, 
    // but sticking to your original logic for consistency:
    window.addEventListener("resize", updateDimensions);
    
    // Small timeout to catch layout shifts on initial render
    setTimeout(updateDimensions, 100);

    return () => window.removeEventListener("resize", updateDimensions); 
  }, []);

  return (
    <div 
      ref={containerRef}
      style={{
        ...style, // Apply positioning/sizing to the outer wrapper
        background: `linear-gradient(0deg, ${borderCol}, transparent)`,
        transition: "all 200ms ease-out",
        position: 'relative',
        // Remove border radius from outer if present in style to prevent double radius issues, 
        // though usually it's fine.
      }}
    >
      <div 
        className="glow-container"
        style={{
          ...style, // Apply styles (like borderRadius, padding) to inner
          // IMPORTANT: Override sizing to ensure it fills the parent wrapper
          // The transform then slightly shrinks it to reveal the 1px border
          width: '100%',
          height: '100%',
          margin: 0, // Ensure no margins on inner
          
          transition: "all 200ms ease-out",
          position: "relative",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          overflow: "hidden",
          // The scaling logic creates the border effect
          transform: width && height ? `scaleX(${((width-2)/width)*100 + "%"}) scaleY(${((height-2)/height)*100 + "%"})` : 'none',
        }}
      >
        {/* Inner Background Layer (Partial Height) */}
        <div style={{
          position: "absolute",
          zIndex: 0,
          width: "100%",
          height: "60%",
          backgroundColor: backgroundCol,
          transition: "all 200ms ease-out",
          opacity: 0.8
        }}/>

        {/* Bottom Glow Effect Layer */}
        <div style={{
          position: "absolute",
          zIndex: 0,
          width: "100%",
          height: "100%",
          display: "flex",
          justifyContent: "center",
          alignItems: "flex-end",
          overflow: "hidden"
        }}>
          <div style={{
            position: "absolute",
            zIndex: 0,
            width: "400%",
            height: "40%",
            backgroundImage: `radial-gradient(ellipse at bottom, ${borderCol}BB 0%, ${backgroundCol} 50%)`,
            transition: "all 200ms ease-out",
            opacity: 0.8
          }}/>
        </div>

        {/* Content Layer */}
        <div style={{
          position: "absolute",
          zIndex: 1,
          width: "100%",
          height: "100%"
        }}>
          {children}
        </div>
      </div>
    </div>
  );
};

export default GlowContainer;
