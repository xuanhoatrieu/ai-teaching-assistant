import { api } from './api';
import type { Scene } from '../remotion/types';

export interface RemotionVideoItem {
  id: string;
  subjectId: string;
  lessonId?: string | null;
  lesson?: { id: string; title: string };
  title: string;
  inputType: 'slide' | 'ai_topic' | 'manual';
  sourceSlideIdx?: number | null;
  templateType: 'explainer' | 'comparison' | 'pipeline' | 'quiz';
  aspectRatio: '9:16' | '16:9';
  targetDuration?: number | null;
  fps: number;
  totalFrames: number;
  scriptContent?: string | null;
  scenesJson: Scene[];
  status: 'draft' | 'rendering' | 'completed' | 'failed';
  progress: number;
  videoUrl?: string | null;
  thumbnailUrl?: string | null;
  fileSize?: number | null;
  durationSeconds?: number | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SuggestedTopic {
  id: string;
  title: string;
  targetDurationSec: number;
  recommendedTemplate: 'explainer' | 'comparison' | 'pipeline' | 'quiz';
  hookQuestion: string;
  coreConcept: string;
  sourceSlideIndex?: number;
}

export const remotionApi = {
  // List all Remotion videos for a subject
  list: (subjectId: string) =>
    api.get<RemotionVideoItem[]>(`/subjects/${subjectId}/remotion`),

  // Get a single video detail
  get: (subjectId: string, videoId: string) =>
    api.get<RemotionVideoItem>(`/subjects/${subjectId}/remotion/${videoId}`),

  // Create video
  create: (
    subjectId: string,
    data: {
      title: string;
      lessonId?: string;
      inputType?: 'slide' | 'ai_topic' | 'manual';
      sourceSlideIdx?: number;
      templateType?: string;
      aspectRatio?: string;
      targetDuration?: number;
      scriptContent?: string;
      scenes?: Scene[];
    },
  ) => api.post<RemotionVideoItem>(`/subjects/${subjectId}/remotion`, data),

  // Update video details or scenes
  update: (
    subjectId: string,
    videoId: string,
    data: {
      title?: string;
      templateType?: string;
      aspectRatio?: string;
      targetDuration?: number;
      scenes?: Scene[];
    },
  ) => api.put<RemotionVideoItem>(`/subjects/${subjectId}/remotion/${videoId}`, data),

  // Delete video
  delete: (subjectId: string, videoId: string) =>
    api.delete(`/subjects/${subjectId}/remotion/${videoId}`),

  // AI suggest topics from lesson
  suggestTopics: (subjectId: string, lessonId: string) =>
    api.post<SuggestedTopic[]>(`/subjects/${subjectId}/remotion/suggest-topics`, {
      lessonId,
    }),

  // AI generate structured script
  generateScript: (subjectId: string, videoId: string, prompt?: string) =>
    api.post<RemotionVideoItem>(`/subjects/${subjectId}/remotion/${videoId}/script`, {
      prompt,
    }),

  // Generate TTS audio for a scene (supports Step 4 TTS options)
  generateSceneAudio: (
    subjectId: string,
    videoId: string,
    sceneIndex: number,
    options?: {
      voiceId?: string;
      multilingualMode?: string;
      vittsEngine?: string;
      vittsMode?: string;
      vittsDesignInstruct?: string;
      vittsNormalize?: boolean;
    },
  ) =>
    api.post<{
      success: boolean;
      audioUrl: string;
      audioDuration: number;
      durationInFrames: number;
      video: RemotionVideoItem;
    }>(`/subjects/${subjectId}/remotion/${videoId}/scene-audio`, {
      sceneIndex,
      ...options,
    }),

  // Generate AI image for a scene
  generateSceneImage: (
    subjectId: string,
    videoId: string,
    sceneIndex: number,
    prompt?: string,
  ) =>
    api.post<{
      success: boolean;
      imageUrl: string;
      video: RemotionVideoItem;
    }>(`/subjects/${subjectId}/remotion/${videoId}/scene-image`, {
      sceneIndex,
      prompt,
    }),

  // Start MP4 render
  startRender: (subjectId: string, videoId: string) =>
    api.post<{ success: boolean; message: string }>(
      `/subjects/${subjectId}/remotion/${videoId}/render`,
    ),

  // Get render status
  getStatus: (subjectId: string, videoId: string) =>
    api.get<{
      id: string;
      status: string;
      progress: number;
      videoUrl?: string;
      durationSeconds?: number;
      fileSize?: number;
      errorMessage?: string;
    }>(`/subjects/${subjectId}/remotion/${videoId}/status`),
};
