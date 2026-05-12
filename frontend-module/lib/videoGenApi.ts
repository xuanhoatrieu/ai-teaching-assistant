import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export interface VideoConfig {
  format?: 'horizontal' | 'vertical';
  resolution?: '480p' | '720p' | '1080p' | '4k';
  narrationLang?: 'vi' | 'en';
  subtitleLang?: 'vi' | 'en' | 'both' | 'none';
  narrationSpeed?: number;
  style?: 'auto' | 'manim' | 'static' | 'hybrid';
}

export interface VideoScene {
  sceneIndex: number;
  title: string;
  approach: 'manim' | 'screen_record' | 'imagen' | 'static';
  status: 'pending' | 'rendering' | 'tts' | 'done' | 'error';
  duration?: number;
  errorMessage?: string;
}

export interface VideoStatus {
  id: string;
  status: string;
  progress: number;
  currentStep?: string;
  totalScenes: number;
  doneScenes: number;
  videoUrl?: string;
  subtitleUrl?: string;
  thumbnailUrl?: string;
  duration?: number;
  fileSize?: number;
  config: VideoConfig;
  scenes: VideoScene[];
  createdAt: string;
}

export interface VideoHistory {
  id: string;
  lessonId: string;
  format: string;
  resolution: string;
  narrationLang: string;
  status: string;
  duration?: number;
  fileSize?: number;
  videoUrl?: string;
  createdAt: string;
  lesson: { title: string };
}

export const videoGenApi = {
  generate: (lessonId: string, config: VideoConfig) =>
    axios.post(`${API_BASE}/lessons/${lessonId}/video/generate`, config),

  getLatest: (lessonId: string) =>
    axios.get<VideoStatus>(`${API_BASE}/lessons/${lessonId}/video`),

  getStatus: (lessonId: string) =>
    axios.get<VideoStatus>(`${API_BASE}/lessons/${lessonId}/video/status`),

  getScenes: (lessonId: string) =>
    axios.get<VideoScene[]>(`${API_BASE}/lessons/${lessonId}/video/scenes`),

  getDownloadUrl: (lessonId: string) =>
    `${API_BASE}/lessons/${lessonId}/video/download`,

  getSubtitleUrl: (lessonId: string) =>
    `${API_BASE}/lessons/${lessonId}/video/subtitle`,

  deleteVideo: (lessonId: string, videoId: string) =>
    axios.delete(`${API_BASE}/lessons/${lessonId}/video/${videoId}`),

  getHistory: () =>
    axios.get<VideoHistory[]>(`${API_BASE}/video-gen/history`),

  retryScene: (sceneId: string) =>
    axios.post(`${API_BASE}/video-gen/retry/${sceneId}`),
};
