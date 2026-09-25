import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import type { QuizVisualProps } from '../types';

interface Props {
  data: QuizVisualProps;
  aspectRatio?: '9:16' | '16:9';
}

export const QuizCard: React.FC<Props> = ({
  data,
  aspectRatio = '9:16',
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const countdownFrames = (data.countdownSec || 5) * fps;
  const isRevealed = frame >= countdownFrames;

  // Countdown timer progress bar from 1 to 0
  const timerProgress = interpolate(frame, [0, countdownFrames], [1, 0], {
    extrapolateRight: 'clamp',
  });

  const scale = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 100 },
  });

  const isVertical = aspectRatio === '9:16';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '100%',
        maxWidth: isVertical ? '920px' : '1100px',
        margin: '0 auto',
        transform: `scale(${scale})`,
        padding: '16px',
        gap: '20px',
      }}
    >
      {/* Question Card */}
      <div
        style={{
          width: '100%',
          background: 'rgba(15, 23, 42, 0.95)',
          border: '2px solid rgba(245, 158, 11, 0.5)',
          borderRadius: '24px',
          padding: isVertical ? '28px 24px' : '24px 32px',
          boxShadow: '0 15px 40px rgba(0, 0, 0, 0.6)',
          backdropFilter: 'blur(16px)',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: isVertical ? '22px' : '16px', fontWeight: 800, color: '#f59e0b', marginBottom: '8px' }}>
          ❓ CÂU HỎI NHANH
        </div>
        <div style={{ fontSize: isVertical ? '30px' : '24px', fontWeight: 800, color: '#f8fafc', lineHeight: 1.4 }}>
          {data.question}
        </div>

        {/* Countdown Bar */}
        <div
          style={{
            marginTop: '16px',
            width: '100%',
            height: '8px',
            background: 'rgba(255,255,255,0.1)',
            borderRadius: '4px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${timerProgress * 100}%`,
              background: timerProgress > 0.3 ? '#f59e0b' : '#ef4444',
              borderRadius: '4px',
              transition: 'background 0.3s',
            }}
          />
        </div>
      </div>

      {/* Options List */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isVertical ? '1fr' : '1fr 1fr',
          gap: isVertical ? '12px' : '16px',
          width: '100%',
        }}
      >
        {data.options.map((opt) => {
          const isCorrect = opt.key.toUpperCase() === data.correctKey.toUpperCase();
          const highlightCorrect = isRevealed && isCorrect;

          return (
            <div
              key={opt.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                background: highlightCorrect
                  ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.3) 0%, rgba(15, 23, 42, 0.95) 100%)'
                  : 'rgba(15, 23, 42, 0.85)',
                border: highlightCorrect
                  ? '2.5px solid #10b981'
                  : '1.5px solid rgba(148, 163, 184, 0.25)',
                boxShadow: highlightCorrect ? '0 0 25px rgba(16, 185, 129, 0.4)' : 'none',
                borderRadius: '16px',
                padding: isVertical ? '18px 20px' : '16px 20px',
                backdropFilter: 'blur(12px)',
              }}
            >
              <div
                style={{
                  width: isVertical ? '40px' : '36px',
                  height: isVertical ? '40px' : '36px',
                  borderRadius: '50%',
                  background: highlightCorrect ? '#10b981' : 'rgba(255,255,255,0.1)',
                  color: highlightCorrect ? '#022c22' : '#f8fafc',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: isVertical ? '22px' : '18px',
                  fontWeight: 900,
                  flexShrink: 0,
                }}
              >
                {highlightCorrect ? '✓' : opt.key}
              </div>

              <div
                style={{
                  fontSize: isVertical ? '24px' : '19px',
                  fontWeight: highlightCorrect ? 800 : 600,
                  color: highlightCorrect ? '#34d399' : '#e2e8f0',
                }}
              >
                {opt.text}
              </div>
            </div>
          );
        })}
      </div>

      {/* Explanation Reveal */}
      {isRevealed && data.explanation && (
        <div
          style={{
            width: '100%',
            background: 'rgba(16, 185, 129, 0.15)',
            border: '1.5px solid rgba(52, 211, 153, 0.4)',
            borderRadius: '16px',
            padding: isVertical ? '18px 24px' : '14px 24px',
            color: '#a7f3d0',
            fontSize: isVertical ? '22px' : '17px',
            fontWeight: 600,
            lineHeight: 1.4,
          }}
        >
          💡 <strong>Giải thích:</strong> {data.explanation}
        </div>
      )}
    </div>
  );
};
