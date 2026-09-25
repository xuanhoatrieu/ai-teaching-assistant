import React from 'react';
import { Audio } from 'remotion';
import type { Scene } from '../types';
import { MathFormula } from '../primitives/MathFormula';
import { CodeBlock } from '../primitives/CodeBlock';
import { ComparisonCard } from '../primitives/ComparisonCard';
import { StepRail } from '../primitives/StepRail';
import { DefinitionCard, StatCounter } from '../primitives/DefinitionCard';
import { KenBurnsImage } from '../primitives/KenBurnsImage';
import { QuizCard } from '../primitives/QuizCard';
import { ChunkedSubtitle } from '../primitives/ChunkedSubtitle';

interface Props {
  scene: Scene;
  aspectRatio?: '9:16' | '16:9';
}

export const SceneRenderer: React.FC<Props> = ({
  scene,
  aspectRatio = '9:16',
}) => {
  const isVertical = aspectRatio === '9:16';

  const renderVisual = () => {
    switch (scene.visualType) {
      case 'formula':
        return (
          <MathFormula
            formula={scene.visualProps?.formula || 'f(x) = x^2'}
            label={scene.visualProps?.label || scene.title}
            explanation={scene.visualProps?.explanation}
            aspectRatio={aspectRatio}
          />
        );
      case 'code':
        return (
          <CodeBlock
            code={scene.visualProps?.code || '// Code demonstration'}
            language={scene.visualProps?.language || 'python'}
            filename={scene.visualProps?.filename}
            activeLines={scene.visualProps?.activeLines || []}
            aspectRatio={aspectRatio}
          />
        );
      case 'comparison':
        return (
          <ComparisonCard
            title={scene.visualProps?.title || scene.title}
            itemA={scene.visualProps?.itemA || { title: 'Lựa chọn A', points: ['Điểm nổi bật 1', 'Điểm nổi bật 2'] }}
            itemB={scene.visualProps?.itemB || { title: 'Lựa chọn B', points: ['Điểm nổi bật 1', 'Điểm nổi bật 2'] }}
            verdict={scene.visualProps?.verdict}
            aspectRatio={aspectRatio}
          />
        );
      case 'step_rail':
        return (
          <StepRail
            steps={scene.visualProps?.steps || [
              { number: 1, label: 'Bước 1', desc: 'Khởi tạo' },
              { number: 2, label: 'Bước 2', desc: 'Xử lý' },
              { number: 3, label: 'Bước 3', desc: 'Kết quả' },
            ]}
            activeStep={scene.visualProps?.activeStep || 1}
            title={scene.visualProps?.title || scene.title}
            aspectRatio={aspectRatio}
          />
        );
      case 'definition':
        return (
          <DefinitionCard
            data={scene.visualProps || {
              term: scene.title || 'Thuật ngữ',
              definition: scene.narration,
              category: 'Khái niệm cốt lõi',
            }}
            aspectRatio={aspectRatio}
          />
        );
      case 'stat_counter':
        return (
          <StatCounter
            data={scene.visualProps || {
              number: 100,
              label: scene.title || 'Số liệu ấn tượng',
              suffix: '%',
            }}
            aspectRatio={aspectRatio}
          />
        );
      case 'image':
        return (
          <KenBurnsImage
            data={scene.visualProps || {
              caption: scene.title,
            }}
            aspectRatio={aspectRatio}
          />
        );
      case 'quiz':
        return (
          <QuizCard
            data={scene.visualProps || {
              question: scene.title,
              options: [
                { key: 'A', text: 'Lựa chọn A' },
                { key: 'B', text: 'Lựa chọn B' },
                { key: 'C', text: 'Lựa chọn C' },
                { key: 'D', text: 'Lựa chọn D' },
              ],
              correctKey: 'A',
              explanation: 'Giải thích học thuật chi tiết',
            }}
            aspectRatio={aspectRatio}
          />
        );
      default:
        // Default: Definition style card
        return (
          <DefinitionCard
            data={{
              term: scene.title,
              definition: scene.narration,
            }}
            aspectRatio={aspectRatio}
          />
        );
    }
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        paddingTop: isVertical ? '140px' : '90px',
        paddingBottom: isVertical ? '240px' : '100px',
        boxSizing: 'border-box',
      }}
    >
      {/* Audio track for this scene */}
      {scene.audioUrl && <Audio src={scene.audioUrl} />}

      {/* Main Visual Content */}
      <div style={{ width: '100%', zIndex: 10 }}>
        {renderVisual()}
      </div>

      {/* Synchronized Subtitles */}
      {scene.narration && (
        <ChunkedSubtitle
          text={scene.narration}
          totalDurationInFrames={scene.durationInFrames}
          aspectRatio={aspectRatio}
        />
      )}
    </div>
  );
};
