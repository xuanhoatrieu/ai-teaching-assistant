import React, { useRef } from 'react';
import { videoGenApi } from '../lib/videoGenApi';

interface VideoPreviewProps {
  videoUrl?: string;
  subtitleUrl?: string;
  lessonId: string;
  duration?: number;
  fileSize?: number;
}

export const VideoPreview: React.FC<VideoPreviewProps> = ({
  videoUrl,
  subtitleUrl,
  lessonId,
  duration,
  fileSize,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  if (!videoUrl) {
    return (
      <div className="video-preview video-placeholder">
        <div className="placeholder-icon">🎬</div>
        <p>Video sẽ hiển thị ở đây sau khi tạo xong</p>
      </div>
    );
  }

  const formatDuration = (sec?: number) => {
    if (!sec) return '--:--';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return '-- MB';
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <div className="video-preview">
      <h3 className="panel-title">▶️ Xem Video</h3>

      <div className="video-container">
        <video
          ref={videoRef}
          src={videoUrl}
          controls
          preload="metadata"
          className="video-player"
        >
          {subtitleUrl && (
            <track kind="subtitles" src={subtitleUrl} label="Subtitles" default />
          )}
        </video>
      </div>

      <div className="video-meta">
        <span>⏱️ {formatDuration(duration)}</span>
        <span>📦 {formatSize(fileSize)}</span>
      </div>

      <div className="video-actions">
        <a
          href={videoGenApi.getDownloadUrl(lessonId)}
          className="btn btn-primary"
          download
        >
          ⬇️ Download MP4
        </a>
        {subtitleUrl && (
          <a
            href={videoGenApi.getSubtitleUrl(lessonId)}
            className="btn btn-outline"
            download
          >
            📝 Download SRT
          </a>
        )}
      </div>
    </div>
  );
};
