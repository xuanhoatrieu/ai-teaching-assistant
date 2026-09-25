import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import type { ComparisonItem } from '../types';

interface Props {
  title?: string;
  itemA: ComparisonItem;
  itemB: ComparisonItem;
  verdict?: string;
  aspectRatio?: '9:16' | '16:9';
}

export const ComparisonCard: React.FC<Props> = ({
  title,
  itemA,
  itemB,
  verdict,
  aspectRatio = '9:16',
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Spring animation from left for Item A
  const slideA = spring({
    frame: frame - 5,
    fps,
    from: -60,
    to: 0,
    config: { damping: 12, stiffness: 100 },
  });
  const opacityA = interpolate(frame - 5, [0, 10], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Spring animation from right for Item B
  const slideB = spring({
    frame: frame - 12,
    fps,
    from: 60,
    to: 0,
    config: { damping: 12, stiffness: 100 },
  });
  const opacityB = interpolate(frame - 12, [0, 10], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const isVertical = aspectRatio === '9:16';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '100%',
        maxWidth: isVertical ? '960px' : '1300px',
        margin: '0 auto',
        padding: '16px',
        gap: '24px',
      }}
    >
      {title && (
        <div
          style={{
            fontSize: isVertical ? '36px' : '30px',
            fontWeight: 900,
            color: '#f8fafc',
            textAlign: 'center',
            letterSpacing: '0.04em',
            textShadow: '0 2px 12px rgba(0,0,0,0.5)',
          }}
        >
          ⚔️ {title}
        </div>
      )}

      {/* Comparison Split Cards Container */}
      <div
        style={{
          display: 'flex',
          flexDirection: isVertical ? 'column' : 'row',
          gap: isVertical ? '20px' : '32px',
          width: '100%',
        }}
      >
        {/* Card A */}
        <div
          style={{
            flex: 1,
            transform: isVertical ? `translateY(${slideA}px)` : `translateX(${slideA}px)`,
            opacity: opacityA,
            background: itemA.isWinner
              ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(15, 23, 42, 0.9) 100%)'
              : 'rgba(15, 23, 42, 0.88)',
            border: itemA.isWinner
              ? '2.5px solid #10b981'
              : '1.5px solid rgba(148, 163, 184, 0.3)',
            borderRadius: '24px',
            padding: isVertical ? '28px 24px' : '32px',
            boxShadow: '0 16px 40px rgba(0, 0, 0, 0.5)',
            backdropFilter: 'blur(16px)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: isVertical ? '36px' : '30px' }}>{itemA.icon || '🔵'}</span>
              <span style={{ fontSize: isVertical ? '32px' : '26px', fontWeight: 800, color: '#f8fafc' }}>
                {itemA.title}
              </span>
            </div>
            {itemA.isWinner && (
              <span style={{ background: '#10b981', color: '#022c22', fontWeight: 800, fontSize: isVertical ? '18px' : '14px', padding: '4px 12px', borderRadius: '9999px' }}>
                WINNER ⭐
              </span>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {itemA.points.map((pt, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ color: '#10b981', fontSize: isVertical ? '22px' : '18px', fontWeight: 800 }}>✓</span>
                <span style={{ fontSize: isVertical ? '24px' : '19px', color: '#cbd5e1', fontWeight: 600 }}>{pt}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Card B */}
        <div
          style={{
            flex: 1,
            transform: isVertical ? `translateY(${slideB}px)` : `translateX(${slideB}px)`,
            opacity: opacityB,
            background: itemB.isWinner
              ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(15, 23, 42, 0.9) 100%)'
              : 'rgba(15, 23, 42, 0.88)',
            border: itemB.isWinner
              ? '2.5px solid #10b981'
              : '1.5px solid rgba(148, 163, 184, 0.3)',
            borderRadius: '24px',
            padding: isVertical ? '28px 24px' : '32px',
            boxShadow: '0 16px 40px rgba(0, 0, 0, 0.5)',
            backdropFilter: 'blur(16px)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: isVertical ? '36px' : '30px' }}>{itemB.icon || '🟣'}</span>
              <span style={{ fontSize: isVertical ? '32px' : '26px', fontWeight: 800, color: '#f8fafc' }}>
                {itemB.title}
              </span>
            </div>
            {itemB.isWinner && (
              <span style={{ background: '#10b981', color: '#022c22', fontWeight: 800, fontSize: isVertical ? '18px' : '14px', padding: '4px 12px', borderRadius: '9999px' }}>
                WINNER ⭐
              </span>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {itemB.points.map((pt, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ color: '#38bdf8', fontSize: isVertical ? '22px' : '18px', fontWeight: 800 }}>✓</span>
                <span style={{ fontSize: isVertical ? '24px' : '19px', color: '#cbd5e1', fontWeight: 600 }}>{pt}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {verdict && (
        <div
          style={{
            background: 'rgba(99, 102, 241, 0.15)',
            border: '1px solid rgba(129, 140, 248, 0.4)',
            borderRadius: '16px',
            padding: isVertical ? '16px 28px' : '14px 32px',
            color: '#c7d2fe',
            fontSize: isVertical ? '24px' : '18px',
            fontWeight: 700,
            textAlign: 'center',
          }}
        >
          💡 {verdict}
        </div>
      )}
    </div>
  );
};
