import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import { videoGenApi, type VideoConfig, type VideoStatus, type VideoScene } from '../lib/videoGenApi';
import { ConfigPanel } from '../components/ConfigPanel';
import { ProgressTracker } from '../components/ProgressTracker';
import { VideoPreview } from '../components/VideoPreview';
import { VideoHistory } from '../components/VideoHistory';
import './VideoGeneratorPage.css';

const WS_URL = import.meta.env.VITE_WS_URL || `${window.location.protocol}//${window.location.hostname}:3003`;

export const VideoGeneratorPage: React.FC = () => {
  const { lessonId } = useParams<{ lessonId: string }>();
  const [status, setStatus] = useState<VideoStatus | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Load existing video status
  useEffect(() => {
    if (!lessonId) return;
    loadStatus();
  }, [lessonId]);

  const loadStatus = async () => {
    try {
      const { data } = await videoGenApi.getStatus(lessonId!);
      setStatus(data);
      if (['pending', 'script', 'rendering', 'composing'].includes(data.status)) {
        setIsGenerating(true);
        connectWebSocket(data.id);
      }
      if (data.videoUrl) setPreviewUrl(data.videoUrl);
    } catch {
      // No existing video
    }
  };

  // WebSocket for real-time progress
  const connectWebSocket = useCallback((jobId: string) => {
    const socket: Socket = io(`${WS_URL}/video-gen`, {
      transports: ['websocket'],
    });

    socket.on('connect', () => {
      socket.emit('subscribe-progress', { jobId });
    });

    socket.on('progress', (data: any) => {
      setStatus((prev) => ({
        ...prev!,
        status: data.status,
        progress: data.progress,
        currentStep: data.currentStep,
        doneScenes: prev ? prev.doneScenes + (data.sceneUpdates?.filter((s: any) => s.status === 'done').length || 0) : 0,
        scenes: updateScenes(prev?.scenes || [], data.sceneUpdates || []),
      }));
    });

    socket.on('done', (data: any) => {
      setIsGenerating(false);
      if (data.status === 'done') {
        setPreviewUrl(data.videoUrl);
        loadStatus(); // Refresh full status
      } else {
        setError(data.error || 'Video generation failed');
      }
      socket.disconnect();
    });

    return () => socket.disconnect();
  }, []);

  const updateScenes = (current: VideoScene[], updates: any[]): VideoScene[] => {
    const map = new Map(current.map((s) => [s.sceneIndex, s]));
    for (const u of updates) {
      if (u.sceneIndex !== undefined && map.has(u.sceneIndex)) {
        const existing = map.get(u.sceneIndex)!;
        map.set(u.sceneIndex, { ...existing, status: u.status, duration: u.duration });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.sceneIndex - b.sceneIndex);
  };

  // Generate video
  const handleGenerate = async (config: VideoConfig) => {
    if (!lessonId) return;
    setError(null);
    setIsGenerating(true);

    try {
      const { data } = await videoGenApi.generate(lessonId, config);
      setStatus({
        id: data.id,
        status: 'pending',
        progress: 0,
        totalScenes: 0,
        doneScenes: 0,
        scenes: [],
        config,
        createdAt: new Date().toISOString(),
      });
      connectWebSocket(data.id);
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to start video generation');
      setIsGenerating(false);
    }
  };

  return (
    <div className="video-generator-page">
      {/* Header */}
      <div className="page-header">
        <nav className="breadcrumb">
          <a href="/lessons">Lessons</a>
          <span>›</span>
          <a href={`/lessons/${lessonId}`}>Bài giảng</a>
          <span>›</span>
          <span className="current">Video Generator</span>
        </nav>
        <h1 className="page-title">📹 Tạo Video Bài Giảng</h1>
      </div>

      {/* Error */}
      {error && (
        <div className="error-banner">
          ❌ {error}
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* Config */}
      <ConfigPanel onGenerate={handleGenerate} isGenerating={isGenerating} />

      {/* Progress (show when generating) */}
      {status && ['pending', 'script', 'rendering', 'composing'].includes(status.status) && (
        <ProgressTracker
          progress={status.progress}
          currentStep={status.currentStep || ''}
          scenes={status.scenes}
          totalScenes={status.totalScenes}
          doneScenes={status.doneScenes}
        />
      )}

      {/* Video Preview */}
      <VideoPreview
        videoUrl={previewUrl || undefined}
        subtitleUrl={status?.subtitleUrl || undefined}
        lessonId={lessonId!}
        duration={status?.duration}
        fileSize={status?.fileSize}
      />

      {/* History */}
      <VideoHistory lessonId={lessonId!} onPlay={(url) => setPreviewUrl(url)} />
    </div>
  );
};
