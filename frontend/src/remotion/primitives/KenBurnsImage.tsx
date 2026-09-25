import React from 'react';
import { useCurrentFrame, interpolate, Img } from 'remotion';
import type { ImageVisualProps } from '../types';

interface Props {
  data: ImageVisualProps;
  aspectRatio?: '9:16' | '16:9';
}

export const KenBurnsImage: React.FC<Props> = ({
  data,
  aspectRatio = '9:16',
}) => {
  const frame = useCurrentFrame();

  const isZoomIn = data.zoomDirection !== 'out';
  const scale = interpolate(frame, [0, 300], isZoomIn ? [1, 1.15] : [1.15, 1], {
    extrapolateRight: 'clamp',
  });
  const translateY = interpolate(frame, [0, 300], [0, -20], {
    extrapolateRight: 'clamp',
  });

  const isVertical = aspectRatio === '9:16';

  if (!data.imageUrl) {
    return (
      <div
        style={{
          width: '80%',
          maxWidth: isVertical ? '850px' : '1000px',
          height: isVertical ? '480px' : '380px',
          margin: '0 auto',
          background: 'rgba(30, 41, 59, 0.7)',
          border: '2px dashed rgba(148, 163, 184, 0.3)',
          borderRadius: '24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#94a3b8',
          fontSize: '20px',
          gap: '12px',
        }}
      >
        <span style={{ fontSize: '48px' }}>🖼️</span>
        <span>{data.caption || 'Hình ảnh minh họa AI'}</span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '100%',
        maxWidth: isVertical ? '900px' : '1100px',
        margin: '0 auto',
        padding: '16px',
      }}
    >
      <div
        style={{
          width: '100%',
          height: isVertical ? '520px' : '440px',
          borderRadius: '28px',
          overflow: 'hidden',
          boxShadow: '0 25px 50px rgba(0, 0, 0, 0.6), 0 0 30px rgba(0,0,0,0.3)',
          border: '2px solid rgba(255, 255, 255, 0.15)',
          position: 'relative',
        }}
      >
        <Img
          src={data.imageUrl}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `scale(${scale}) translateY(${translateY}px)`,
          }}
        />

        {data.caption && (
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              padding: '16px 24px',
              background: 'linear-gradient(transparent, rgba(0, 0, 0, 0.85))',
              color: '#f8fafc',
              fontSize: isVertical ? '22px' : '17px',
              fontWeight: 600,
              textAlign: 'center',
            }}
          >
            {data.caption}
          </div>
        )}
      </div>
    </div>
  );
};
