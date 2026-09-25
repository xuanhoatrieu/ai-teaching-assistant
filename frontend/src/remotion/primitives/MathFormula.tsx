import React, { useMemo } from 'react';
import { useCurrentFrame, useVideoConfig, spring } from 'remotion';
import katex from 'katex';
import 'katex/dist/katex.min.css';

interface Props {
  formula: string;
  label?: string;
  explanation?: string;
  aspectRatio?: '9:16' | '16:9';
}

export const MathFormula: React.FC<Props> = ({
  formula,
  label,
  explanation,
  aspectRatio = '9:16',
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({
    frame,
    fps,
    config: {
      damping: 12,
      stiffness: 90,
      mass: 0.8,
    },
  });

  const html = useMemo(() => {
    try {
      return katex.renderToString(formula || 'E = mc^2', {
        displayMode: true,
        throwOnError: false,
      });
    } catch (e) {
      return formula;
    }
  }, [formula]);

  const isVertical = aspectRatio === '9:16';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        maxWidth: isVertical ? '920px' : '1100px',
        margin: '0 auto',
        transform: `scale(${scale})`,
        padding: '20px',
      }}
    >
      {/* Formula Box */}
      <div
        style={{
          width: '100%',
          background: 'rgba(15, 23, 42, 0.88)',
          border: '2px solid rgba(129, 140, 248, 0.4)',
          borderRadius: '28px',
          padding: isVertical ? '48px 32px' : '40px 48px',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.5), 0 0 40px rgba(99, 102, 241, 0.15)',
          backdropFilter: 'blur(16px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
        }}
      >
        {label && (
          <div
            style={{
              fontSize: isVertical ? '24px' : '18px',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              color: '#818cf8',
              marginBottom: '20px',
            }}
          >
            📐 {label}
          </div>
        )}

        {/* Rendered KaTeX SVG */}
        <div
          style={{
            fontSize: isVertical ? '44px' : '36px',
            color: '#f8fafc',
            lineHeight: 1.4,
            overflowX: 'auto',
            width: '100%',
            padding: '10px 0',
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />

        {explanation && (
          <div
            style={{
              marginTop: '24px',
              fontSize: isVertical ? '26px' : '20px',
              color: '#94a3b8',
              fontWeight: 600,
              lineHeight: 1.5,
              maxWidth: '85%',
            }}
          >
            {explanation}
          </div>
        )}
      </div>
    </div>
  );
};
