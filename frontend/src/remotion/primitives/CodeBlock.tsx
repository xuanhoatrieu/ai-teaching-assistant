import React, { useMemo } from 'react';
import { useCurrentFrame, useVideoConfig, spring } from 'remotion';

interface Props {
  code: string;
  language?: string;
  filename?: string;
  activeLines?: number[];
  aspectRatio?: '9:16' | '16:9';
}

export const CodeBlock: React.FC<Props> = ({
  code,
  language = 'python',
  filename,
  activeLines = [],
  aspectRatio = '9:16',
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({
    frame,
    fps,
    config: {
      damping: 14,
      stiffness: 100,
    },
  });

  const lines = useMemo(() => {
    return (code || '').split('\n');
  }, [code]);

  const isVertical = aspectRatio === '9:16';

  return (
    <div
      style={{
        width: '100%',
        maxWidth: isVertical ? '920px' : '1200px',
        margin: '0 auto',
        transform: `scale(${scale})`,
        padding: '16px',
      }}
    >
      <div
        style={{
          background: 'rgba(15, 20, 31, 0.95)',
          border: '1.5px solid rgba(56, 189, 248, 0.3)',
          borderRadius: '24px',
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.6), 0 0 30px rgba(56, 189, 248, 0.1)',
          overflow: 'hidden',
          backdropFilter: 'blur(16px)',
        }}
      >
        {/* Mac OS Window Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 24px',
            background: 'rgba(30, 41, 59, 0.6)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ width: '14px', height: '14px', borderRadius: '50%', background: '#ef4444' }} />
            <div style={{ width: '14px', height: '14px', borderRadius: '50%', background: '#f59e0b' }} />
            <div style={{ width: '14px', height: '14px', borderRadius: '50%', background: '#10b981' }} />
          </div>

          <div
            style={{
              fontSize: isVertical ? '20px' : '15px',
              fontFamily: 'monospace',
              color: '#94a3b8',
              fontWeight: 600,
            }}
          >
            {filename || `example.${language === 'python' ? 'py' : language === 'typescript' ? 'ts' : 'js'}`}
          </div>

          <div
            style={{
              fontSize: isVertical ? '18px' : '14px',
              color: '#38bdf8',
              fontWeight: 700,
              textTransform: 'uppercase',
            }}
          >
            {language}
          </div>
        </div>

        {/* Code Content */}
        <div
          style={{
            padding: isVertical ? '28px 24px' : '24px 32px',
            fontFamily: 'Consolas, Monaco, "Courier New", monospace',
            fontSize: isVertical ? '26px' : '20px',
            lineHeight: 1.6,
            color: '#f1f5f9',
            overflowX: 'hidden',
          }}
        >
          {lines.map((line, idx) => {
            const lineNum = idx + 1;
            const isActive = activeLines.includes(lineNum);

            return (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  background: isActive ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                  borderLeft: isActive ? '4px solid #38bdf8' : '4px solid transparent',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  transition: 'all 0.2s',
                }}
              >
                <span
                  style={{
                    width: isVertical ? '48px' : '40px',
                    color: isActive ? '#38bdf8' : '#475569',
                    userSelect: 'none',
                    textAlign: 'right',
                    marginRight: '20px',
                    fontWeight: 600,
                  }}
                >
                  {lineNum}
                </span>
                <span
                  style={{
                    color: isActive ? '#38bdf8' : '#e2e8f0',
                    fontWeight: isActive ? 700 : 500,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {line || ' '}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
