import React, { useMemo } from 'react';
import { useCurrentFrame, interpolate } from 'remotion';

interface Props {
  text: string;
  totalDurationInFrames: number;
  aspectRatio?: '9:16' | '16:9';
}

export const ChunkedSubtitle: React.FC<Props> = ({
  text,
  totalDurationInFrames,
  aspectRatio = '9:16',
}) => {
  const frame = useCurrentFrame();

  // Split text into chunks of 5-7 words
  const chunks = useMemo(() => {
    if (!text || !text.trim()) return [];
    const words = text.trim().split(/\s+/);
    const result: string[] = [];
    let currentChunk: string[] = [];

    for (let i = 0; i < words.length; i++) {
      currentChunk.push(words[i]);
      // Break at punctuation or every 6 words
      const hasPunctuation = /[.,!?;:]$/.test(words[i]);
      if (currentChunk.length >= 6 || (hasPunctuation && currentChunk.length >= 3)) {
        result.push(currentChunk.join(' '));
        currentChunk = [];
      }
    }
    if (currentChunk.length > 0) {
      result.push(currentChunk.join(' '));
    }
    return result;
  }, [text]);

  if (chunks.length === 0) return null;

  // Determine current active chunk based on frame
  const framesPerChunk = totalDurationInFrames / chunks.length;
  const activeChunkIndex = Math.min(
    chunks.length - 1,
    Math.max(0, Math.floor(frame / framesPerChunk))
  );

  const currentText = chunks[activeChunkIndex] || '';

  // Snappy fade transition between chunks
  const chunkFrame = frame % framesPerChunk;
  const opacity = interpolate(chunkFrame, [0, 4], [0.4, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const isVertical = aspectRatio === '9:16';

  return (
    <div
      style={{
        position: 'absolute',
        bottom: isVertical ? '180px' : '50px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 50,
        width: isVertical ? '88%' : '75%',
        maxWidth: isVertical ? '900px' : '1200px',
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          opacity,
          background: 'rgba(9, 14, 26, 0.92)',
          border: '1.5px solid rgba(56, 189, 248, 0.45)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
          backdropFilter: 'blur(16px)',
          borderRadius: '9999px',
          padding: isVertical ? '16px 36px' : '12px 28px',
          textAlign: 'center',
        }}
      >
        <span
          style={{
            fontSize: isVertical ? '36px' : '26px',
            fontWeight: 900,
            lineHeight: 1.3,
            color: '#ffffff',
            letterSpacing: '0.02em',
            textShadow: '0 2px 8px rgba(0,0,0,0.8)',
          }}
        >
          {currentText}
        </span>
      </div>
    </div>
  );
};
