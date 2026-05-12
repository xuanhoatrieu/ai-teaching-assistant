import React, { useState } from 'react';
import type { VideoConfig } from '../lib/videoGenApi';

interface ConfigPanelProps {
  onGenerate: (config: VideoConfig) => void;
  isGenerating: boolean;
}

const CONFIG_OPTIONS = {
  format: [
    { value: 'horizontal', label: '16:9 (YouTube)' },
    { value: 'vertical', label: '9:16 (TikTok)' },
  ],
  resolution: [
    { value: '480p', label: '480p' },
    { value: '720p', label: '720p' },
    { value: '1080p', label: '1080p' },
    { value: '4k', label: '4K' },
  ],
  narrationLang: [
    { value: 'vi', label: 'Tiếng Việt' },
    { value: 'en', label: 'English' },
  ],
  subtitleLang: [
    { value: 'vi', label: 'Tiếng Việt' },
    { value: 'en', label: 'English' },
    { value: 'both', label: 'VI + EN' },
    { value: 'none', label: 'Không có' },
  ],
  narrationSpeed: [
    { value: 0.8, label: '0.8x' },
    { value: 1.0, label: '1.0x' },
    { value: 1.2, label: '1.2x' },
    { value: 1.5, label: '1.5x' },
  ],
  style: [
    { value: 'auto', label: 'Auto' },
    { value: 'manim', label: 'Manim' },
    { value: 'static', label: 'Static' },
    { value: 'hybrid', label: 'Hybrid' },
  ],
};

export const ConfigPanel: React.FC<ConfigPanelProps> = ({ onGenerate, isGenerating }) => {
  const [config, setConfig] = useState<VideoConfig>({
    format: 'horizontal',
    resolution: '1080p',
    narrationLang: 'vi',
    subtitleLang: 'vi',
    narrationSpeed: 1.0,
    style: 'auto',
  });

  const updateConfig = (key: keyof VideoConfig, value: any) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="config-panel">
      <h3 className="panel-title">⚙️ Cấu hình Video</h3>
      <div className="config-grid">
        <div className="config-field">
          <label>Định dạng</label>
          <select
            value={config.format}
            onChange={(e) => updateConfig('format', e.target.value)}
          >
            {CONFIG_OPTIONS.format.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="config-field">
          <label>Chất lượng</label>
          <select
            value={config.resolution}
            onChange={(e) => updateConfig('resolution', e.target.value)}
          >
            {CONFIG_OPTIONS.resolution.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="config-field">
          <label>Ngôn ngữ đọc</label>
          <select
            value={config.narrationLang}
            onChange={(e) => updateConfig('narrationLang', e.target.value)}
          >
            {CONFIG_OPTIONS.narrationLang.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="config-field">
          <label>Phụ đề</label>
          <select
            value={config.subtitleLang}
            onChange={(e) => updateConfig('subtitleLang', e.target.value)}
          >
            {CONFIG_OPTIONS.subtitleLang.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="config-field">
          <label>Tốc độ</label>
          <select
            value={config.narrationSpeed}
            onChange={(e) => updateConfig('narrationSpeed', Number(e.target.value))}
          >
            {CONFIG_OPTIONS.narrationSpeed.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="config-field">
          <label>Phong cách</label>
          <select
            value={config.style}
            onChange={(e) => updateConfig('style', e.target.value)}
          >
            {CONFIG_OPTIONS.style.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      <button
        className="generate-btn"
        onClick={() => onGenerate(config)}
        disabled={isGenerating}
      >
        {isGenerating ? '⏳ Đang tạo...' : '🎬 Tạo Video'}
      </button>
    </div>
  );
};
