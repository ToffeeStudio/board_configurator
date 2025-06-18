import React, { useEffect, useRef, useState } from 'react';

interface GlowContainerProps {
  borderThickness?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
  colors: string[]; // Expects colors[4] (border/glow) and colors[5] (bg)
}

const GlowContainer: React.FC<GlowContainerProps> = ({ borderThickness = "1px", style, children, colors }) => {

  // Basic validation for colors prop
  if (!colors || colors.length < 6) {
    console.error('GlowContainer requires an array of at least 6 colors.');
    // Provide default fallback colors
    colors = [
      '#ff00ff', '#00ffff', '#ff00ff', '#00ffff', // Not used directly here, but keeping length
      '#00ffff80', '#222233' // Border/Glow, Background
    ];
  }

  const borderCol = colors[4]; // Color for border and bottom glow
  const backgroundCol = colors[5]; // Color for inner background

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

    // Debounce resize handler
    let resizeTimeout: NodeJS.Timeout;
    const debouncedUpdate = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(updateDimensions, 100); // Adjust delay as needed
    };

    updateDimensions(); // Initial call
    window.addEventListener("resize", debouncedUpdate);
    return () => {
      clearTimeout(resizeTimeout);
      window.removeEventListener("resize", debouncedUpdate);
    }
  }, []);

  // Calculate scale, ensuring width/height are not zero to avoid NaN/Infinity
  const scaleX = width > 0 ? ((width - (parseFloat(borderThickness) * 2)) / width) : 1;
  const scaleY = height > 0 ? ((height - (parseFloat(borderThickness) * 2)) / height) : 1;

  return (
    <div
      ref={containerRef}
      style={{
        padding: borderThickness, // Use padding to create border effect
        background: `linear-gradient(0deg, ${borderCol}, transparent)`, // Apply gradient to the outer container
        borderRadius: style?.borderRadius, // Inherit borderRadius if provided
        transition: "background 200ms ease-out",
        ...style, // Spread user styles, allowing overrides but keeping essential ones
        position: style?.position ?? 'relative', // Ensure positioning context if not provided
      }}
    >
      <div
        className="glow-container-inner"
        style={{
          width: '100%',
          height: '100%',
          transition: "all 200ms ease-out",
          position: "relative",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          overflow: "hidden",
          // transform: `scaleX(${scaleX}) scaleY(${scaleY})`, // Apply scale here if needed, or rely on padding
          borderRadius: `calc(${style?.borderRadius || '0px'} - ${borderThickness})`, // Adjust inner radius
          background: backgroundCol, // Set background color directly
        }}
      >
        {/* Background Elements */}
        <div style={{
          position: "absolute",
          zIndex: 0,
          width: "100%",
          height: "100%", // Cover entire inner area
          // backgroundColor: backgroundCol, // Background applied to parent now
          // opacity: 0.8, // Opacity might not be needed if bg is solid
          transition: "all 200ms ease-out",
        }} />
        {/* Bottom Glow Element */}
        <div style={{
          position: "absolute",
          zIndex: 0,
          bottom: 0, // Anchor to bottom
          left: '50%', // Center horizontally
          transform: 'translateX(-50%)', // Adjust for centering
          width: "200%", // Wider for softer edge
          height: "60%", // Adjust height of glow
          backgroundImage: `radial-gradient(ellipse at bottom, ${borderCol} 0%, transparent 70%)`, // Use border color for glow, fade out
          transition: "all 200ms ease-out",
          opacity: 0.6, // Adjust glow opacity
          pointerEvents: 'none',
        }} />
        {/* Children Content */}
        <div style={{
          position: "relative", // Ensure children are above background elements
          zIndex: 1,
          width: "100%",
          height: "100%",
          display: 'flex', // If children need centering/flex properties
          justifyContent: 'center',
          alignItems: 'center'
        }}>
          {children}
        </div>
      </div>
    </div>
  );
};

export default GlowContainer;
