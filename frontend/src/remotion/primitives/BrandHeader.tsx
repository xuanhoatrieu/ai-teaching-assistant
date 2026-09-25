import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';

interface Props {
  brandName?: string;
  category?: string;
  topicTitle?: string;
  aspectRatio?: '9:16' | '16:9';
}

export const BrandHeader: React.FC<Props> = ({
  brandName = 'AI TEACHING ASSISTANT',
  category,
  topicTitle,
  aspectRatio = '9:16',
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const translateY = interpolate(frame, [0, 15], [-20, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const isVertical = aspectRatio === '9:16';

  return (
    <div
      style={{
        position: 'absolute',
        top: isVertical ? '120px' : '40px',
        left: '50%',
        transform: `translateX(-50%) translateY(${translateY}px)`,
        opacity,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
        zIndex: 40,
        width: '90%',
        maxWidth: isVertical ? '900px' : '1400px',
      }}
    >
      {/* Brand Capsule */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          background: 'rgba(15, 23, 42, 0.85)',
          border: '1px solid rgba(99, 102, 241, 0.35)',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
          backdropFilter: 'blur(12px)',
          borderRadius: '9999px',
          padding: isVertical ? '10px 24px' : '8px 20px',
        }}
      >
        <span style={{ fontSize: isVertical ? '24px' : '18px' }}>🎓</span>
        <span
          style={{
            fontSize: isVertical ? '22px' : '16px',
            fontWeight: 800,
            letterSpacing: '0.08em',
            color: '#e2e8f0',
            textTransform: 'uppercase',
          }}
        >
          {brandName}
        </span>
        {category && (
          <>
            <span style={{ color: 'rgba(255,255,255,0.2)' }}>•</span>
            <span
              style={{
                fontSize: isVertical ? '20px' : '15px',
                fontWeight: 600,
                color: '#38bdf8',
              }}
            >
              {category}
            </span>
          </>
        )}
      </div>

      {/* Topic Title (optional secondary line) */}
      {topicTitle && (
        <div
          style={{
            fontSize: isVertical ? '26px' : '20px',
            fontWeight: 700,
            color: '#94a3b8',
            textAlign: 'center',
            textShadow: '0 2px 10px rgba(0,0,0,0.5)',
          }}
        >
          {topicTitle}
        </div>
      )}
    </div>
  );
};
