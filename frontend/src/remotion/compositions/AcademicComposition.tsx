import React from 'react';
import { AbsoluteFill, Series } from 'remotion';
import type { RemotionVideoData } from '../types';
import { AnimatedBackground } from '../primitives/AnimatedBackground';
import { BrandHeader } from '../primitives/BrandHeader';
import { SceneRenderer } from './SceneRenderer';

export const AcademicComposition: React.FC<RemotionVideoData> = ({
  title,
  brandName = 'AI TEACHING ASSISTANT',
  subjectName,
  aspectRatio = '9:16',
  scenes = [],
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: '#090d16', overflow: 'hidden' }}>
      {/* Background with Ambient Glow */}
      <AnimatedBackground accentColor="#6366f1" />

      {/* Persistent Top Capsule HUD */}
      <BrandHeader
        brandName={brandName}
        category={subjectName}
        topicTitle={title}
        aspectRatio={aspectRatio}
      />

      {/* Sequential Scenes via Remotion Series */}
      {scenes.length > 0 ? (
        <Series>
          {scenes.map((scene) => (
            <Series.Sequence
              key={scene.id || `scene-${scene.sceneIndex}`}
              durationInFrames={Math.max(15, scene.durationInFrames)}
            >
              <SceneRenderer scene={scene} aspectRatio={aspectRatio} />
            </Series.Sequence>
          ))}
        </Series>
      ) : (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#94a3b8',
            fontSize: '24px',
            fontWeight: 600,
          }}
        >
          Chưa có phân cảnh nào
        </div>
      )}
    </AbsoluteFill>
  );
};
