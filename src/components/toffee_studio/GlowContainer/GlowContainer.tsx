import React from 'react';

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

  // Separate padding from the rest of the style props to handle it independently
  const { padding, ...restOfStyle } = style || {};

  return (
    <div
      style={{
        ...style,
        background: `linear-gradient(0deg, ${borderCol}, transparent)`,
        transition: "all 200ms ease-out",
        padding: borderThickness, // Use padding for the border
      }}
    >
      <div
        className="glow-container-inner"
        style={{
          transition: "all 200ms ease-out",
          position: "relative",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          overflow: "hidden",
          width: '100%',
          height: '100%',
          background: backgroundCol,
          borderRadius: `calc(${style?.borderRadius || '0px'} - ${borderThickness})`, // Adjust inner radius
        }}
      >
        <div style={{
          position: "absolute",
          zIndex: 0,
          width: "100%",
          height: "60%",
          backgroundColor: backgroundCol,
          transition: "all 200ms ease-out",
          opacity: 0.8
        }}/>
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
        <div style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          height: "100%",
          padding: padding,
        }}>
          {children}
        </div>
      </div>
    </div>
  );
};

export default GlowContainer;
