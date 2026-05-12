import React from 'react';
import type { VideoScene } from '../lib/videoGenApi';

interface ProgressTrackerProps {
  progress: number;
  currentStep: string;
  scenes: VideoScene[];
  totalScenes: number;
  doneScenes: number;
}

const APPROACH_BADGES: Record<string, { label: string; color: string }> = {
  manim: { label: 'Manim', color: '#6366f1' },
  screen_record: { label: 'Playwright', color: '#f59e0b' },
  imagen: { label: 'AI Image', color: '#22c55e' },
  static: { label: 'Static', color: '#94a3b8' },
};

const STATUS_ICONS: Record<string, string> = {
  done: '✅',
  rendering: '🔄',
  tts: '🔊',
  pending: '⬜',
  error: '❌',
};

export const ProgressTracker: React.FC<ProgressTrackerProps> = ({
  progress,
  currentStep,
  scenes,
  totalScenes,
  doneScenes,
}) => {
  return (
    <div className="progress-panel">
      <h3 className="panel-title">📊 Tiến độ</h3>

      {/* Progress bar */}
      <div className="progress-header">
        <span className="progress-text">
          {currentStep || `${doneScenes}/${totalScenes} scenes`}
        </span>
        <span className="progress-percent">{progress}%</span>
      </div>
      <div className="progress-bar-track">
        <div
          className="progress-bar-fill"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Scene list */}
      <div className="scene-list">
        {scenes.map((scene) => {
          const badge = APPROACH_BADGES[scene.approach] || APPROACH_BADGES.static;
          const icon = STATUS_ICONS[scene.status] || '⬜';

          return (
            <div
              key={scene.sceneIndex}
              className={`scene-item scene-${scene.status}`}
            >
              <span className="scene-icon">{icon}</span>
              <span className="scene-index">Scene {scene.sceneIndex + 1}:</span>
              <span className="scene-title">{scene.title}</span>
              <span
                className="scene-badge"
                style={{
                  backgroundColor: `${badge.color}20`,
                  color: badge.color,
                  border: `1px solid ${badge.color}40`,
                }}
              >
                {badge.label}
              </span>
              {scene.duration && (
                <span className="scene-duration">{scene.duration.toFixed(1)}s</span>
              )}
              {scene.status === 'rendering' && (
                <span className="scene-spinner" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
