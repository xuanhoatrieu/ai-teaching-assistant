import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import type { DefinitionProps, StatCounterProps } from '../types';

interface DefinitionCardComponentProps {
  data: DefinitionProps;
  aspectRatio?: '9:16' | '16:9';
}

export const DefinitionCard: React.FC<DefinitionCardComponentProps> = ({
  data,
  aspectRatio = '9:16',
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 95 },
  });

  const isVertical = aspectRatio === '9:16';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '100%',
        maxWidth: isVertical ? '900px' : '1100px',
        margin: '0 auto',
        transform: `scale(${scale})`,
        padding: '16px',
      }}
    >
      <div
        style={{
          width: '100%',
          background: 'rgba(15, 23, 42, 0.92)',
          border: '2px solid rgba(168, 85, 247, 0.4)',
          borderRadius: '28px',
          padding: isVertical ? '40px 32px' : '36px 44px',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6), 0 0 40px rgba(168, 85, 247, 0.15)',
          backdropFilter: 'blur(16px)',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: isVertical ? '48px' : '40px' }}>{data.icon || '📖'}</span>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {data.category && (
              <span
                style={{
                  fontSize: isVertical ? '20px' : '15px',
                  fontWeight: 800,
                  color: '#c084fc',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                }}
              >
                {data.category}
              </span>
            )}
            <span
              style={{
                fontSize: isVertical ? '38px' : '30px',
                fontWeight: 900,
                color: '#f8fafc',
                letterSpacing: '0.02em',
              }}
            >
              {data.term}
            </span>
          </div>
        </div>

        {/* Definition Text */}
        <div
          style={{
            fontSize: isVertical ? '28px' : '22px',
            color: '#e2e8f0',
            fontWeight: 600,
            lineHeight: 1.6,
            background: 'rgba(255, 255, 255, 0.04)',
            padding: '20px 24px',
            borderRadius: '16px',
            borderLeft: '4px solid #a855f7',
          }}
        >
          {data.definition}
        </div>

        {/* Key Points */}
        {data.keyPoints && data.keyPoints.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {data.keyPoints.map((point, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ color: '#a855f7', fontSize: isVertical ? '24px' : '20px', fontWeight: 800 }}>•</span>
                <span style={{ fontSize: isVertical ? '24px' : '19px', color: '#cbd5e1', fontWeight: 500 }}>
                  {point}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

interface StatCounterComponentProps {
  data: StatCounterProps;
  aspectRatio?: '9:16' | '16:9';
}

export const StatCounter: React.FC<StatCounterComponentProps> = ({
  data,
  aspectRatio = '9:16',
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Count up animation over 30 frames
  const countProgress = interpolate(frame, [0, 30], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const currentValue = Math.round(data.number * countProgress);

  const scale = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 90 },
  });

  const isVertical = aspectRatio === '9:16';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        transform: `scale(${scale})`,
        padding: '24px',
        textAlign: 'center',
        gap: '12px',
      }}
    >
      <div
        style={{
          fontSize: isVertical ? '88px' : '72px',
          fontWeight: 900,
          color: '#38bdf8',
          lineHeight: 1,
          textShadow: '0 0 40px rgba(56, 189, 248, 0.4)',
          letterSpacing: '-0.02em',
        }}
      >
        {data.prefix || ''}{currentValue.toLocaleString()}{data.suffix || ''}
      </div>

      <div
        style={{
          fontSize: isVertical ? '32px' : '26px',
          fontWeight: 800,
          color: '#f8fafc',
          maxWidth: '80%',
        }}
      >
        {data.label}
      </div>

      {data.subtext && (
        <div
          style={{
            fontSize: isVertical ? '22px' : '18px',
            color: '#94a3b8',
            fontWeight: 500,
          }}
        >
          {data.subtext}
        </div>
      )}
    </div>
  );
};
