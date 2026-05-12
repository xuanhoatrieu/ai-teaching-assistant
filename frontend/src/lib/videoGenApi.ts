import { api, API_BASE_URL } from './api';


// ─── Types ──────────────────────────────────────────

export interface VideoConfig {
  format?: 'horizontal' | 'vertical';
  resolution?: '480p' | '720p' | '1080p' | '4k';
  narrationLang?: 'vi' | 'en';
  subtitleLang?: 'vi' | 'en' | 'both' | 'none';
  narrationSpeed?: number;
  style?: 'auto' | 'manim' | 'static' | 'hybrid';
}

export interface VideoScene {
  id?: string;
  sceneIndex: number;
  title: string;
  approach: 'manim' | 'screen_record' | 'imagen' | 'static';
  status: 'pending' | 'rendering' | 'tts' | 'done' | 'error';
  narrationText?: string;
  subtitleText?: string;
  visualDesc?: string;
  imagePrompt?: string;
  manimCode?: string;
  audioUrl?: string;
  clipUrl?: string;
  duration?: number;
  errorMessage?: string;
  approved?: boolean;
}

export interface SceneEdit {
  index: number;
  title: string;
  approach: string;
  narration_vi?: string;
  narration_en?: string;
  visual_desc?: string;
  image_prompt?: string;
  manim_code?: string;
  duration_est?: number;
}

export interface VideoItem {
  id: string;
  title: string;
  inputType: string;
  format: string;
  resolution: string;
  status: string;
  wizardStep: number;
  progress: number;
  totalScenes: number;
  doneScenes: number;
  duration?: number;
  fileSize?: number;
  videoUrl?: string;
  thumbnailUrl?: string;
  createdAt: string;
  updatedAt: string;
  lesson?: { id: string; title: string } | null;
}

export interface VideoDetail extends VideoItem {
  subjectId: string;
  userId: string;
  inputText?: string;
  inputFilesJson?: any[];
  narrationLang: string;
  subtitleLang: string;
  narrationSpeed: number;
  style: string;
  videoScript?: any;
  editedScript?: any;
  scriptStatus: string;
  renderStep?: string;
  subtitleUrl?: string;
  errorMessage?: string;
  scenes: VideoScene[];
}

// ─── API Client (Subject-scoped) ────────────────────

export const videoGenApi = {
  // CRUD
  create: (subjectId: string, data: {
    title?: string;
    inputType?: string;
    lessonId?: string;
    inputText?: string;
    inputFiles?: Array<{ name: string; url: string; type: string }>;
  } & VideoConfig) =>
    api.post<VideoDetail>(`/subjects/${subjectId}/videos`, data),

  list: (subjectId: string) =>
    api.get<VideoItem[]>(`/subjects/${subjectId}/videos`),

  get: (subjectId: string, videoId: string) =>
    api.get<VideoDetail>(`/subjects/${subjectId}/videos/${videoId}`),

  update: (subjectId: string, videoId: string, data: Partial<VideoDetail> & { wizardStep?: number }) =>
    api.put<VideoDetail>(`/subjects/${subjectId}/videos/${videoId}`, data),

  delete: (subjectId: string, videoId: string) =>
    api.delete(`/subjects/${subjectId}/videos/${videoId}`),

  // Script (Step 2)
  generateScript: (subjectId: string, videoId: string) =>
    api.post(`/subjects/${subjectId}/videos/${videoId}/generate-script`),

  saveScript: (subjectId: string, videoId: string, scenes: SceneEdit[]) =>
    api.put(`/subjects/${subjectId}/videos/${videoId}/script`, { scenes }),

  generateAudioForScene: (subjectId: string, videoId: string, sceneIndex: number, options?: any) =>
    api.post(`/subjects/${subjectId}/videos/${videoId}/scenes/${sceneIndex}/generate-audio`, options),

  // Render (Step 4)
  startRender: (subjectId: string, videoId: string) =>
    api.post(`/subjects/${subjectId}/videos/${videoId}/render`),

  getStatus: (subjectId: string, videoId: string) =>
    api.get<VideoDetail>(`/subjects/${subjectId}/videos/${videoId}/status`),

  // Scene-by-Scene (Step 3)
  renderScenePreview: (subjectId: string, videoId: string, sceneIndex: number) =>
    api.post(`/subjects/${subjectId}/videos/${videoId}/scenes/${sceneIndex}/render-preview`),

  regenerateSceneCode: (subjectId: string, videoId: string, sceneIndex: number) =>
    api.post(`/subjects/${subjectId}/videos/${videoId}/scenes/${sceneIndex}/regenerate-code`),

  updateSceneCode: (subjectId: string, videoId: string, sceneIndex: number, code: string) =>
    api.put(`/subjects/${subjectId}/videos/${videoId}/scenes/${sceneIndex}/code`, { code }),

  updateSceneVisualDesc: (subjectId: string, videoId: string, sceneIndex: number, visualDesc: string) =>
    api.put(`/subjects/${subjectId}/videos/${videoId}/scenes/${sceneIndex}/visual-desc`, { visualDesc }),

  approveScene: (subjectId: string, videoId: string, sceneIndex: number, approved: boolean) =>
    api.put(`/subjects/${subjectId}/videos/${videoId}/scenes/${sceneIndex}/approve`, { approved }),

  composeVideo: (subjectId: string, videoId: string) =>
    api.post(`/subjects/${subjectId}/videos/${videoId}/compose`),

  // Global
  getHistory: () =>
    api.get<VideoItem[]>(`/video-gen/history`),

  retryScene: (sceneId: string) =>
    api.post(`/video-gen/retry/${sceneId}`),
};
