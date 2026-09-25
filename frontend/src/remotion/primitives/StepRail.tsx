import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import type { StepItem } from '../types';

interface Props {
  steps: StepItem[];
  activeStep: number;
  title?: string;
  aspectRatio?: '9:16' | '16:9';
}

export const StepRail: React.FC<Props> = ({
  steps = [],
  activeStep = 1,
  title,
  aspectRatio = '9:16',
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const isVertical = aspectRatio === '9:16';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '100%',
        maxWidth: isVertical ? '920px' : '1200px',
        margin: '0 auto',
        padding: '16px',
        gap: '24px',
      }}
    >
      {title && (
        <div
          style={{
            fontSize: isVertical ? '36px' : '28px',
            fontWeight: 900,
            color: '#f8fafc',
            textAlign: 'center',
            letterSpacing: '0.04em',
          }}
        >
          🔄 {title}
        </div>
      )}

      {/* Steps Container */}
      <div
        style={{
          display: 'flex',
          flexDirection: isVertical ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: isVertical ? '16px' : '20px',
          width: '100%',
        }}
      >
        {steps.map((step, idx) => {
          const isActive = step.number === activeStep;
          const isCompleted = step.number < activeStep;

          // Staggered entrance for each step
          const stepSlide = spring({
            frame: frame - idx * 4,
            fps,
            from: 30,
            to: 0,
            config: { damping: 14, stiffness: 100 },
          });
          const stepOpacity = interpolate(frame - idx * 4, [0, 8], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });

          return (
            <React.Fragment key={step.number}>
              {/* Step Node */}
              <div
                style={{
                  transform: `translateY(${stepSlide}px)`,
                  opacity: stepOpacity,
                  flex: isVertical ? 'none' : 1,
                  width: isVertical ? '100%' : 'auto',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  background: isActive
                    ? 'linear-gradient(135deg, rgba(56, 189, 248, 0.25) 0%, rgba(15, 23, 42, 0.95) 100%)'
                    : isCompleted
                    ? 'rgba(15, 23, 42, 0.85)'
                    : 'rgba(15, 23, 42, 0.5)',
                  border: isActive
                    ? '2.5px solid #38bdf8'
                    : isCompleted
                    ? '1.5px solid #10b981'
                    : '1.5px solid rgba(148, 163, 184, 0.2)',
                  borderRadius: '20px',
                  padding: isVertical ? '20px 24px' : '24px 20px',
                  boxShadow: isActive ? '0 10px 30px rgba(56, 189, 248, 0.3)' : '0 8px 24px rgba(0,0,0,0.4)',
                  backdropFilter: 'blur(12px)',
                }}
              >
                {/* Step Number Badge */}
                <div
                  style={{
                    width: isVertical ? '50px' : '44px',
                    height: isVertical ? '50px' : '44px',
                    borderRadius: '50%',
                    background: isActive ? '#38bdf8' : isCompleted ? '#10b981' : 'rgba(255,255,255,0.1)',
                    color: isActive ? '#030712' : '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: isVertical ? '24px' : '20px',
                    fontWeight: 900,
                    flexShrink: 0,
                  }}
                >
                  {isCompleted ? '✓' : step.number}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div
                    style={{
                      fontSize: isVertical ? '26px' : '20px',
                      fontWeight: 800,
                      color: isActive ? '#38bdf8' : '#f1f5f9',
                    }}
                  >
                    {step.label}
                  </div>
                  {step.desc && (
                    <div
                      style={{
                        fontSize: isVertical ? '20px' : '15px',
                        color: '#94a3b8',
                        fontWeight: 500,
                      }}
                    >
                      {step.desc}
                    </div>
                  )}
                </div>
              </div>

              {/* Connecting Arrow between steps */}
              {!isVertical && idx < steps.length - 1 && (
                <div style={{ fontSize: '24px', color: isCompleted ? '#10b981' : 'rgba(255,255,255,0.3)' }}>
                  ➜
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
