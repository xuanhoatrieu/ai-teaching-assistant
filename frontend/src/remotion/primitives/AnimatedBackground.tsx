import React from 'react';
import { AbsoluteFill, useCurrentFrame, interpolate } from 'remotion';

interface Props {
  color?: string;
  accentColor?: string;
}

export const AnimatedBackground: React.FC<Props> = ({
  color = '#0b0f19',
  accentColor = '#6366f1',
}) => {
  const frame = useCurrentFrame();

  // Gentle pulse for background ambient glow
  const orb1Scale = interpolate(Math.sin(frame / 45), [-1, 1], [0.85, 1.25]);
  const orb2Scale = interpolate(Math.cos(frame / 60), [-1, 1], [0.9, 1.3]);
  const orb1Y = interpolate(Math.sin(frame / 80), [-1, 1], [-40, 40]);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: color,
        overflow: 'hidden',
      }}
    >
      {/* Ambient Orb 1 */}
      <div
        style={{
          position: 'absolute',
          top: '-10%',
          left: '20%',
          width: '600px',
          height: '600px',
          borderRadius: '50%',
          background: `radial-gradient(circle, ${accentColor}33 0%, transparent 70%)`,
          filter: 'blur(80px)',
          transform: `translateY(${orb1Y}px) scale(${orb1Scale})`,
          pointerEvents: 'none',
        }}
      />

      {/* Ambient Orb 2 */}
      <div
        style={{
          position: 'absolute',
          bottom: '-10%',
          right: '10%',
          width: '500px',
          height: '500px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(14, 165, 233, 0.2) 0%, transparent 70%)',
          filter: 'blur(90px)',
          transform: `scale(${orb2Scale})`,
          pointerEvents: 'none',
        }}
      />

      {/* Subtle Grid Overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          opacity: 0.7,
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
};
