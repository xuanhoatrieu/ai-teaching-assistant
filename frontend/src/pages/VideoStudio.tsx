import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { videoGenApi, type VideoDetail, type SceneEdit } from '../lib/videoGenApi';
import { API_BASE_URL } from '../lib/api';
import { ModelSelector } from '../components/ModelSelector';
import { TTSSelector } from '../components/TTSSelector';
import './VideoStudio.css';

const WIZARD_STEPS = [
  { num: 1, icon: '📥', label: 'Đầu vào' },
  { num: 2, icon: '📝', label: 'Kịch bản' },
  { num: 3, icon: '🎭', label: 'Cảnh' },
  { num: 4, icon: '🎬', label: 'Render' },
  { num: 5, icon: '✅', label: 'Kết quả' },
];

const FORMAT_OPTIONS = [
  { value: 'horizontal', label: '📐 16:9 (Ngang)' },
  { value: 'vertical', label: '📐 9:16 (Dọc)' },
];

const RESOLUTION_OPTIONS = [
  { value: '480p', label: '📺 480p' },
  { value: '720p', label: '📺 720p' },
  { value: '1080p', label: '📺 1080p' },
  { value: '4k', label: '📺 4K' },
];

const LANG_OPTIONS = [
  { value: 'vi', label: '🌐 Tiếng Việt' },
  { value: 'en', label: '🌐 English' },
];

const STYLE_OPTIONS = [
  { value: 'auto', label: '🎨 Tự động (Auto)' },
  { value: 'manim', label: '🎨 Manim Animation' },
  { value: 'static', label: '🎨 Hình ảnh tĩnh' },
  { value: 'hybrid', label: '🎨 Kết hợp' },
];

function TextDisplayEditor({
  label,
  value,
  onChange,
  isCode = false,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
  isCode?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [tempValue, setTempValue] = useState(value);

  const handleSave = () => {
    onChange(tempValue);
    setIsEditing(false);
  };

  return (
    <div className="text-display-editor">
      <div className="text-display-header">
        <label>{label}</label>
        <button onClick={() => { setTempValue(value); setIsEditing(true); }} className="text-edit-btn">
          ✎ Sửa
        </button>
      </div>
      <div className={`text-display-content ${isCode ? 'code-content' : ''} ${!value ? 'empty-text' : ''}`}>
        {value || 'Chưa có nội dung'}
      </div>

      {isEditing && (
        <div className="text-edit-modal-overlay">
          <div className="text-edit-modal">
            <h3>Sửa {label}</h3>
            <textarea
              value={tempValue}
              onChange={(e) => setTempValue(e.target.value)}
              className={isCode ? 'code-textarea' : ''}
              autoFocus
            />
            <div className="text-edit-actions">
              <button onClick={() => setIsEditing(false)} className="secondary-btn">Hủy</button>
              <button onClick={handleSave} className="primary-btn">Lưu lại</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function VideoStudioPage() {
  const { subjectId, videoId } = useParams<{ subjectId: string; videoId: string }>();

  const [video, setVideo] = useState<VideoDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [generatingAudioFor, setGeneratingAudioFor] = useState<Set<number>>(new Set());
  const [audioCacheBuster, setAudioCacheBuster] = useState<number>(Date.now());
  const [isGeneratingAllAudio, setIsGeneratingAllAudio] = useState(false);

  // Step 1: Input + Config
  const [inputText, setInputText] = useState('');
  const [configFormat, setConfigFormat] = useState('horizontal');
  const [configResolution, setConfigResolution] = useState('1080p');
  const [configLang, setConfigLang] = useState('vi');
  const [configStyle, setConfigStyle] = useState('auto');

  // Step 2: Script editing
  const [scenes, setScenes] = useState<SceneEdit[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  const fetchVideo = useCallback(async () => {
    if (!subjectId || !videoId) return;
    try {
      const res = await videoGenApi.get(subjectId, videoId);
      setVideo(res.data);
      setInputText(res.data.inputText || '');
      setConfigFormat(res.data.format || 'horizontal');
      setConfigResolution(res.data.resolution || '1080p');
      setConfigLang(res.data.narrationLang || 'vi');
      setConfigStyle(res.data.style || 'auto');

      // Load scenes from editedScript or videoScript
      loadScenesFromVideo(res.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Không thể tải video');
    } finally {
      setIsLoading(false);
    }
  }, [subjectId, videoId]);

  const loadScenesFromVideo = (v: VideoDetail) => {
    const script = v.editedScript || v.videoScript;
    if (script && Array.isArray(script)) {
      setScenes(script.map((s: any, i: number) => ({
        index: s.index ?? i + 1,
        title: s.title || `Scene ${i + 1}`,
        approach: s.approach || 'static',
        narration_vi: s.narration_vi || s.narrationText || '',
        visual_desc: s.visual_desc || s.visualDesc || '',
        image_prompt: s.image_prompt || s.imagePrompt || '',
        manim_code: s.manim_code || s.manimCode || '',
      })));
    } else if (v.scenes?.length) {
      setScenes(v.scenes.map((s) => ({
        index: s.sceneIndex,
        title: s.title,
        approach: s.approach,
        narration_vi: s.narrationText || '',
        visual_desc: s.visualDesc || '',
        image_prompt: s.imagePrompt || '',
        manim_code: s.manimCode || '',
      })));
    }
  };

  useEffect(() => {
    fetchVideo();
  }, [fetchVideo]);

  // Polling for script generation + render progress + scene-by-scene
  useEffect(() => {
    if (!video || !subjectId || !videoId) return;

    const hasRenderingScenes = (video.scenes || []).some(s => s.status === 'rendering');
    const shouldPoll =
      video.scriptStatus === 'generating' ||
      ['pending', 'rendering', 'composing', 'uploading', 'tts'].includes(video.status) ||
      hasRenderingScenes;

    if (!shouldPoll) return;

    const interval = setInterval(async () => {
      try {
        const res = await videoGenApi.get(subjectId, videoId);
        setVideo(res.data);

        // Script generation finished
        if (res.data.scriptStatus === 'ready' && video.scriptStatus === 'generating') {
          setIsGenerating(false);
          loadScenesFromVideo(res.data);
        }

        // Check if all scene renders are complete AND video status is terminal
        const stillRendering = (res.data.scenes || []).some((s: any) => s.status === 'rendering');
        const videoTerminal = ['done', 'error', 'draft'].includes(res.data.status);
        if (!stillRendering && videoTerminal && res.data.scriptStatus !== 'generating') {
          clearInterval(interval);
        }
      } catch { /* ignore polling errors */ }
    }, 3000);

    return () => clearInterval(interval);
  }, [video?.status, video?.scriptStatus, video?.scenes, subjectId, videoId]);

  const currentStep = video?.wizardStep || 1;

  // ─── Step 1 Handlers ──────────────────
  const handleSaveInput = async () => {
    if (!subjectId || !videoId) return;
    setIsSaving(true);
    try {
      const res = await videoGenApi.update(subjectId, videoId, {
        inputText,
        format: configFormat,
        resolution: configResolution,
        narrationLang: configLang,
        style: configStyle,
        wizardStep: 2,
      });
      setVideo(res.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Lỗi lưu đầu vào');
    } finally {
      setIsSaving(false);
    }
  };

  // ─── Step 2 Handlers ──────────────────
  const handleGenerateScript = async () => {
    if (!subjectId || !videoId) return;
    setIsGenerating(true);
    setError('');
    try {
      await videoGenApi.generateScript(subjectId, videoId);
      // Refetch to get scriptStatus = 'generating' → polling will take over
      const res = await videoGenApi.get(subjectId, videoId);
      setVideo(res.data);
      
      // If backend was super fast, it might already be ready
      if (res.data.scriptStatus === 'ready') {
        setIsGenerating(false);
        loadScenesFromVideo(res.data);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Lỗi tạo kịch bản');
      setIsGenerating(false);
    }
  };

  const handleSaveScript = async () => {
    if (!subjectId || !videoId || scenes.length === 0) return;
    setIsSaving(true);
    try {
      await videoGenApi.saveScript(subjectId, videoId, scenes);
      const res = await videoGenApi.get(subjectId, videoId);
      setVideo(res.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Lỗi lưu kịch bản');
    } finally {
      setIsSaving(false);
    }
  };

  const updateScene = (idx: number, field: keyof SceneEdit, value: string) => {
    setScenes(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };

  const addScene = () => {
    setScenes(prev => [...prev, {
      index: prev.length + 1,
      title: `Scene ${prev.length + 1}`,
      approach: 'static',
      narration_vi: '',
      visual_desc: '',
      image_prompt: '',
    }]);
  };

  const removeScene = (idx: number) => {
    setScenes(prev => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, index: i + 1 })));
  };

  const moveScene = (idx: number, direction: 'up' | 'down') => {
    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= scenes.length) return;
    const newScenes = [...scenes];
    [newScenes[idx], newScenes[newIdx]] = [newScenes[newIdx], newScenes[idx]];
    setScenes(newScenes.map((s, i) => ({ ...s, index: i + 1 })));
  };

  // ─── Step 4 Handler ───────────────────
  const handleStartRender = async () => {
    if (!subjectId || !videoId) return;
    setError('');
    try {
      await videoGenApi.startRender(subjectId, videoId);
      const res = await videoGenApi.get(subjectId, videoId);
      setVideo(res.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Lỗi bắt đầu render');
    }
  };

  const handleGenerateSingleAudio = async (sceneIndex: number) => {
    if (!subjectId || !videoId) return;
    setGeneratingAudioFor(prev => new Set(prev).add(sceneIndex));
    setError('');
    try {
      await videoGenApi.generateAudioForScene(subjectId, videoId, sceneIndex);
      const res = await videoGenApi.get(subjectId, videoId);
      setVideo(res.data);
      if (currentStep === 2 || currentStep === 3) {
        loadScenesFromVideo(res.data);
      }
      setAudioCacheBuster(Date.now());
    } catch (err: any) {
      setError(err.response?.data?.message || 'Lỗi tạo audio');
    } finally {
      setGeneratingAudioFor(prev => {
        const next = new Set(prev);
        next.delete(sceneIndex);
        return next;
      });
    }
  };

  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const handleGenerateAllAudio = async () => {
    if (!subjectId || !videoId || !video?.scenes) return;
    setIsGeneratingAllAudio(true);
    setError('');
    try {
      // Find scenes that don't have audio or are in draft status
      const scenesToGenerate = video.scenes;
      let isFirst = true;

      for (const scene of scenesToGenerate) {
        setGeneratingAudioFor(prev => new Set(prev).add(scene.sceneIndex));
        try {
          await videoGenApi.generateAudioForScene(subjectId, videoId, scene.sceneIndex);
        } catch (err) {
          console.error(`Error generating audio for scene ${scene.sceneIndex}:`, err);
        } finally {
          setGeneratingAudioFor(prev => {
            const next = new Set(prev);
            next.delete(scene.sceneIndex);
            return next;
          });
        }
        
        if (isFirst) {
          await delay(2000);
          isFirst = false;
        } else {
          await delay(1000); // Prevent rate limits
        }
      }
      
      const res = await videoGenApi.get(subjectId, videoId);
      setVideo(res.data);
      if (currentStep === 2 || currentStep === 3) {
        loadScenesFromVideo(res.data);
      }
      setAudioCacheBuster(Date.now());
    } catch (err: any) {
      setError(err.response?.data?.message || 'Lỗi tạo audio hàng loạt');
    } finally {
      setIsGeneratingAllAudio(false);
    }
  };

  // ─── Navigate to step ─────────────────
  const goToStep = async (step: number) => {
    if (!subjectId || !videoId || step < 1 || step > 5) return;
    try {
      const res = await videoGenApi.update(subjectId, videoId, { wizardStep: step });
      setVideo(res.data);
      // Reload scenes if stepping into script or scenes step
      if (res.data && (step === 2 || step === 3)) {
        loadScenesFromVideo(res.data);
      }
    } catch {}
  };

  if (isLoading) return <div className="loading-state">Đang tải...</div>;
  if (!video) return <div className="error-state">{error || 'Video not found'}</div>;

  // Safe scenes array (prevent crash when video.scenes is undefined)
  const videoScenes = video.scenes || [];

  return (
    <div className="video-studio-page">
      {/* Breadcrumb */}
      <div className="breadcrumb">
        <Link to="/">Subjects</Link>
        <span>/</span>
        <Link to={`/subjects/${subjectId}`}>Môn học</Link>
        <span>/</span>
        <span>🎬 {video.title}</span>
      </div>

      {/* Stepper */}
      <div className="wizard-stepper">
        {WIZARD_STEPS.map((step) => (
          <button
            key={step.num}
            className={`wizard-step ${currentStep === step.num ? 'active' : ''} ${currentStep > step.num ? 'completed' : ''}`}
            onClick={() => goToStep(step.num)}
          >
            <span className="wizard-step-icon">
              {currentStep > step.num ? '✓' : step.icon}
            </span>
            <span className="wizard-step-label">{step.label}</span>
          </button>
        ))}
      </div>

      {error && <div className="error-banner">{error} <button onClick={() => setError('')}>✕</button></div>}

      {/* Step 1: Input + Config */}
      {currentStep === 1 && (
        <div className="studio-step">
          <div className="step-header">
            <h2>📥 Đầu vào & Cấu hình</h2>
            <p>Nhập nội dung và thiết lập thông số video</p>
          </div>

          <div className="step-content">
            {video.inputType === 'lesson' && video.lesson && (
              <div className="input-source-info">
                <span className="source-badge">📚 Từ bài giảng: {video.lesson.title}</span>
              </div>
            )}

            <div className="form-group">
              <label>Nội dung / Yêu cầu</label>
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Nhập nội dung bài giảng, outline, hoặc yêu cầu chi tiết cho video..."
                rows={12}
                className="studio-textarea"
              />
            </div>

            {/* Editable Config */}
            <div className="config-editor">
              <h3>⚙️ Cấu hình video</h3>
              <div className="config-grid">
                <div className="config-item">
                  <label>Tỉ lệ khung hình</label>
                  <select value={configFormat} onChange={(e) => setConfigFormat(e.target.value)}>
                    {FORMAT_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div className="config-item">
                  <label>Độ phân giải</label>
                  <select value={configResolution} onChange={(e) => setConfigResolution(e.target.value)}>
                    {RESOLUTION_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div className="config-item">
                  <label>Ngôn ngữ thuyết minh</label>
                  <select value={configLang} onChange={(e) => setConfigLang(e.target.value)}>
                    {LANG_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div className="config-item">
                  <label>Phong cách video</label>
                  <select value={configStyle} onChange={(e) => setConfigStyle(e.target.value)}>
                    {STYLE_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div className="step-actions">
            <span />
            <button
              className="primary-btn"
              onClick={handleSaveInput}
              disabled={isSaving || !inputText.trim()}
            >
              {isSaving ? 'Đang lưu...' : 'Lưu & Tiếp tục →'}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Script */}
      {currentStep === 2 && (
        <div className="studio-step">
          <div className="step-header">
            <h2>📝 Kịch bản</h2>
            <p>AI tạo kịch bản video — bạn có thể chỉnh sửa trước khi render</p>
          </div>

          {/* Model Selector for Script Generation */}
          <div className="step-model-selector">
            <ModelSelector
              taskType="SLIDES"
              label="🤖 Model tạo kịch bản video"
              compact
            />
          </div>

          {/* TTS Model & Voice Selection — loads saved config from Settings */}
          <div className="step-model-selector">
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 14, color: '#94a3b8', marginBottom: 8 }}>
                🎙️ Giọng đọc (TTS) — <em style={{ color: '#22c55e' }}>dùng giọng đã lưu từ Settings</em>
              </summary>
              <TTSSelector />
            </details>
          </div>

          {/* Script generation controls */}
          {(video.scriptStatus === 'none' || video.scriptStatus === 'generating' || isGenerating) && scenes.length === 0 && (
            <div className="script-generate-section">
              {(video.scriptStatus === 'generating' || isGenerating) ? (
                <div className="generating-indicator">
                  <div className="spinner"></div>
                  <p>Đang tạo kịch bản... AI đang phân tích nội dung</p>
                  <span className="generating-hint">Quá trình có thể mất 1-3 phút</span>
                </div>
              ) : (
                <button
                  className="primary-btn generate-btn"
                  onClick={handleGenerateScript}
                  disabled={isGenerating}
                >
                  🤖 Tạo kịch bản bằng AI
                </button>
              )}
            </div>
          )}

          {/* Script ready — action bar with Edit + Regenerate */}
          {scenes.length > 0 && !isGenerating && (
            <div className="script-action-bar">
              <div className="script-action-bar-info">
                <span className="script-status-badge ready">✅ Kịch bản sẵn sàng</span>
                <span className="script-scene-count">{scenes.length} cảnh</span>
              </div>
              <div className="script-action-bar-buttons">
                <button
                  className="secondary-btn"
                  onClick={handleGenerateAllAudio}
                  disabled={isGenerating || isGeneratingAllAudio}
                  title="Tạo file âm thanh (TTS) cho toàn bộ kịch bản"
                >
                  {isGeneratingAllAudio ? (
                    <>Đang tạo...</>
                  ) : videoScenes.some(s => s.audioUrl) ? '🔄 Tạo lại Audio tất cả' : '🔊 Tạo Audio'}
                </button>
                <button
                  className="secondary-btn"
                  onClick={handleGenerateScript}
                  disabled={isGenerating}
                  title="AI sẽ tạo lại kịch bản mới từ nội dung đầu vào"
                >
                  🔄 Tạo lại kịch bản
                </button>
              </div>
            </div>
          )}

          {/* Regenerating indicator when already has scenes */}
          {isGenerating && scenes.length > 0 && (
            <div className="script-generate-section regenerating">
              <div className="generating-indicator">
                <div className="spinner"></div>
                <p>Đang tạo lại kịch bản...</p>
                <span className="generating-hint">Kịch bản cũ sẽ được thay thế khi hoàn thành</span>
              </div>
            </div>
          )}

          {/* TTS Generating indicator */}
          {isGeneratingAllAudio && (
            <div className="script-generate-section regenerating">
              <div className="generating-indicator">
                <div className="spinner"></div>
                <p>Đang tạo Audio (TTS) cho toàn bộ kịch bản...</p>
              </div>
            </div>
          )}

          {/* Scene editor */}
          {scenes.length > 0 && (
            <div className="scenes-editor">
              {scenes.map((scene, idx) => (
                <div key={idx} className="scene-edit-card">
                  <div className="scene-edit-header">
                    <span className="scene-number">Scene {scene.index}</span>
                    <div className="scene-edit-controls">
                      <select
                        value={scene.approach}
                        onChange={(e) => updateScene(idx, 'approach', e.target.value)}
                        className="approach-select"
                      >
                        <option value="static">📷 Static</option>
                        <option value="manim">🎨 Manim</option>
                        <option value="imagen">🖼️ Imagen</option>
                        <option value="screen_record">💻 Screen Record</option>
                      </select>
                      <button onClick={() => moveScene(idx, 'up')} disabled={idx === 0} title="Lên">⬆️</button>
                      <button onClick={() => moveScene(idx, 'down')} disabled={idx === scenes.length - 1} title="Xuống">⬇️</button>
                      <button onClick={() => removeScene(idx)} className="scene-delete-btn" title="Xóa">🗑️</button>
                    </div>
                  </div>

                  <div className="scene-edit-body">
                    <div className="form-group">
                      <label>Tiêu đề</label>
                      <input
                        type="text"
                        value={scene.title}
                        onChange={(e) => updateScene(idx, 'title', e.target.value)}
                      />
                    </div>

                    <div className="form-group">
                      <TextDisplayEditor
                        label="Lời thuyết minh (narration)"
                        value={scene.narration_vi || ''}
                        onChange={(val) => updateScene(idx, 'narration_vi', val)}
                      />
                      {(() => {
                        const dbScene = videoScenes.find(s => s.sceneIndex === scene.index);
                        const hasAudio = !!dbScene?.audioUrl;
                        
                        return (
                          <div className="scene-audio-inline" style={{ marginTop: 6 }}>
                            {hasAudio && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <audio
                                  controls
                                  src={`${API_BASE_URL}${dbScene.audioUrl}?token=${localStorage.getItem('accessToken')}&t=${audioCacheBuster}`}
                                  style={{ height: 32, flex: 1 }}
                                />
                                <button
                                  className="secondary-btn"
                                  onClick={() => handleGenerateSingleAudio(scene.index)}
                                  disabled={generatingAudioFor.has(scene.index)}
                                  style={{ padding: '4px 8px', fontSize: '12px' }}
                                >
                                  {generatingAudioFor.has(scene.index) ? 'Đang tạo...' : '🔄'}
                                </button>
                              </div>
                            )}
                            {!hasAudio && (
                              <button
                                className="secondary-btn"
                                onClick={() => handleGenerateSingleAudio(scene.index)}
                                disabled={generatingAudioFor.has(scene.index)}
                                style={{ padding: '4px 8px', fontSize: '12px', marginTop: '4px' }}
                              >
                                {generatingAudioFor.has(scene.index) ? 'Đang tạo...' : '🔊 Tạo Audio'}
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </div>

                    <div className="form-group">
                      <TextDisplayEditor
                        label="Mô tả hình ảnh / visual"
                        value={scene.visual_desc || ''}
                        onChange={(val) => updateScene(idx, 'visual_desc', val)}
                      />
                    </div>

                    {scene.approach === 'imagen' && (
                      <div className="form-group">
                        <TextDisplayEditor
                          label="Image Prompt"
                          value={scene.image_prompt || ''}
                          onChange={(val) => updateScene(idx, 'image_prompt', val)}
                        />
                      </div>
                    )}

                    {scene.approach === 'manim' && (
                      <div className="form-group">
                        <TextDisplayEditor
                          label="Manim Code"
                          value={scene.manim_code || ''}
                          onChange={(val) => updateScene(idx, 'manim_code', val)}
                          isCode={true}
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))}

              <button className="add-scene-btn" onClick={addScene}>
                + Thêm scene
              </button>
            </div>
          )}

          <div className="step-actions">
            <button className="secondary-btn" onClick={() => goToStep(1)}>
              ← Quay lại
            </button>
            {scenes.length > 0 && (
              <button
                className="primary-btn"
                onClick={handleSaveScript}
                disabled={isSaving}
              >
                {isSaving ? 'Đang lưu...' : 'Chốt kịch bản →'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Step 3: Scene-by-Scene Render & Review */}
      {currentStep === 3 && (
        <div className="studio-step">
          <div className="step-header">
            <h2>🎭 Render & Duyệt từng Scene</h2>
            <p>Render preview từng scene → Duyệt kết quả → Gộp thành video hoàn chỉnh</p>
            <div className="step-header-stats">
              <span className="stat-badge">📊 {videoScenes.length} scenes</span>
              <span className="stat-badge done">✅ {videoScenes.filter(s => s.approved).length} đã duyệt</span>
              <span className="stat-badge rendered">🎬 {videoScenes.filter(s => s.clipUrl).length} đã render</span>
            </div>
          </div>

          <div className="scenes-render-list">
            {videoScenes.length > 0 ? (
              videoScenes.map((scene) => {
                const isRendering = scene.status === 'rendering';
                const hasClip = !!scene.clipUrl;
                const isApproved = !!scene.approved;
                const hasError = scene.status === 'error';

                return (
                  <div key={scene.sceneIndex} className={`scene-render-card ${isApproved ? 'approved' : ''} ${hasError ? 'has-error' : ''}`}>
                    {/* Scene Header */}
                    <div className="scene-render-header">
                      <div className="scene-render-title">
                        <span className="scene-number-badge">{scene.sceneIndex}</span>
                        <h4>{scene.title}</h4>
                        <span className={`approach-badge ${scene.approach}`}>{scene.approach}</span>
                      </div>
                      <div className="scene-render-status">
                        {isApproved && <span className="status-badge approved">✅ Đã duyệt</span>}
                        {isRendering && <span className="status-badge rendering">🔄 Đang render...</span>}
                        {hasError && <span className="status-badge error">❌ Lỗi</span>}
                        {!isApproved && !isRendering && !hasError && hasClip && <span className="status-badge preview">👁️ Cần duyệt</span>}
                        {!isApproved && !isRendering && !hasError && !hasClip && <span className="status-badge pending">⏳ Chưa render</span>}
                      </div>
                    </div>

                    {/* Scene Content — Vertical Stack */}
                    <div className="scene-render-body">
                      {/* Narration */}
                      {scene.narrationText && (
                        <div className="scene-narration-box">
                          <label>💬 Lời thuyết minh</label>
                          <p>{scene.narrationText}</p>
                          {scene.audioUrl && (
                            <audio
                              controls
                              src={`${API_BASE_URL}${scene.audioUrl}?token=${localStorage.getItem('accessToken')}&t=${audioCacheBuster}`}
                              style={{ width: '100%', height: 32, marginTop: 4 }}
                            />
                          )}
                        </div>
                      )}

                      {/* Visual Description — Editable */}
                      <div className="scene-visual-desc">
                        <TextDisplayEditor
                          label="🎨 Mô tả hình ảnh"
                          value={scene.visualDesc || ''}
                          onChange={async (val) => {
                            if (!subjectId || !videoId) return;
                            try {
                              await videoGenApi.updateSceneVisualDesc(subjectId, videoId, scene.sceneIndex, val);
                              fetchVideo();
                            } catch (err: any) {
                              setError(err.response?.data?.message || 'Lỗi lưu mô tả');
                            }
                          }}
                        />
                      </div>

                      {/* Error message */}
                      {scene.errorMessage && (
                        <div className="scene-error-msg">
                          <label>❌ Lỗi render</label>
                          <pre>{scene.errorMessage}</pre>
                        </div>
                      )}

                      {/* Manim Code (for manim approach) */}
                      {scene.approach === 'manim' && (
                        <div className="scene-code-section">
                          <TextDisplayEditor
                            label="🐍 Manim Code"
                            value={scene.manimCode || ''}
                            onChange={async (val) => {
                              if (!subjectId || !videoId) return;
                              try {
                                await videoGenApi.updateSceneCode(subjectId, videoId, scene.sceneIndex, val);
                                fetchVideo();
                              } catch (err: any) {
                                setError(err.response?.data?.message || 'Lỗi lưu code');
                              }
                            }}
                            isCode={true}
                          />
                        </div>
                      )}

                      {/* Video Preview */}
                      <div className="scene-render-preview">
                        {hasClip ? (
                          <div className="clip-preview-container">
                            <video
                              controls
                              src={`${API_BASE_URL}/subjects/${subjectId}/videos/${videoId}/scenes/${scene.sceneIndex}/stream/clip?token=${localStorage.getItem('accessToken')}&t=${audioCacheBuster}`}
                              className="clip-preview-player"
                            >
                              Video preview
                            </video>
                            {scene.duration && (
                              <span className="clip-duration">{Math.round(scene.duration)}s</span>
                            )}
                          </div>
                        ) : isRendering ? (
                          <div className="clip-placeholder rendering">
                            <div className="spinner"></div>
                            <span>Đang render scene...</span>
                          </div>
                        ) : (
                          <div className="clip-placeholder">
                            <span className="clip-placeholder-icon">🎬</span>
                            <span>Chưa có preview</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Scene Actions */}
                    <div className="scene-render-actions">
                      {/* Render / Re-render */}
                      <button
                        className="secondary-btn"
                        onClick={async () => {
                          if (!subjectId || !videoId) return;
                          setError('');
                          try {
                            await videoGenApi.renderScenePreview(subjectId, videoId, scene.sceneIndex);
                            fetchVideo();
                          } catch (err: any) {
                            setError(err.response?.data?.message || 'Lỗi render scene');
                          }
                        }}
                        disabled={isRendering}
                      >
                        {isRendering ? '🔄 Đang render...' : hasClip ? '🔄 Render lại' : '▶️ Render'}
                      </button>

                      {/* Regenerate Code (Manim only) */}
                      {scene.approach === 'manim' && (
                        <button
                          className="secondary-btn"
                          onClick={async () => {
                            if (!subjectId || !videoId) return;
                            setError('');
                            try {
                              await videoGenApi.regenerateSceneCode(subjectId, videoId, scene.sceneIndex);
                              fetchVideo();
                            } catch (err: any) {
                              setError(err.response?.data?.message || 'Lỗi tạo lại code');
                            }
                          }}
                          disabled={isRendering}
                        >
                          🤖 Tạo lại code
                        </button>
                      )}

                      {/* Generate Audio */}
                      <button
                        className="secondary-btn"
                        onClick={() => handleGenerateSingleAudio(scene.sceneIndex)}
                        disabled={generatingAudioFor.has(scene.sceneIndex)}
                        style={{ fontSize: '12px' }}
                      >
                        {generatingAudioFor.has(scene.sceneIndex) ? 'Đang tạo...' : scene.audioUrl ? '🔄 Audio' : '🔊 Tạo Audio'}
                      </button>

                      {/* Approve / Unapprove */}
                      {hasClip && (
                        <button
                          className={isApproved ? 'primary-btn approved-btn' : 'primary-btn'}
                          onClick={async () => {
                            if (!subjectId || !videoId) return;
                            try {
                              await videoGenApi.approveScene(subjectId, videoId, scene.sceneIndex, !isApproved);
                              fetchVideo();
                            } catch (err: any) {
                              setError(err.response?.data?.message || 'Lỗi duyệt scene');
                            }
                          }}
                        >
                          {isApproved ? '↩️ Bỏ duyệt' : '✅ Duyệt'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="empty-state">
                <span className="empty-icon">📝</span>
                <h3>Chưa có scene nào</h3>
                <p>Quay lại bước Kịch bản để tạo scenes</p>
                <button className="primary-btn" onClick={() => goToStep(2)}>
                  Đến bước Kịch bản
                </button>
              </div>
            )}
          </div>

          <div className="step-actions">
            <button className="secondary-btn" onClick={() => goToStep(2)}>
              ← Sửa kịch bản
            </button>
            <div className="step-actions-right">
              {videoScenes.length > 0 && (
                <>
                  {/* Render All unrendered scenes */}
                  {videoScenes.some(s => !s.clipUrl && s.status !== 'rendering') && (
                    <button
                      className="secondary-btn"
                      onClick={async () => {
                        if (!subjectId || !videoId) return;
                        setError('');
                        for (const scene of videoScenes) {
                          if (!scene.clipUrl && scene.status !== 'rendering') {
                            try {
                              await videoGenApi.renderScenePreview(subjectId, videoId, scene.sceneIndex);
                            } catch { /* ignore individual errors */ }
                            await delay(500);
                          }
                        }
                        fetchVideo();
                      }}
                    >
                      ▶️ Render tất cả
                    </button>
                  )}

                  {/* Compose Final Video */}
                  <button
                    className="primary-btn compose-btn"
                    onClick={async () => {
                      if (!subjectId || !videoId) return;
                      setError('');
                      try {
                        await videoGenApi.composeVideo(subjectId, videoId);
                        fetchVideo();
                      } catch (err: any) {
                        setError(err.response?.data?.message || 'Lỗi gộp video');
                      }
                    }}
                    disabled={videoScenes.some(s => !s.clipUrl)}
                    title={videoScenes.some(s => !s.clipUrl) ? 'Cần render tất cả scene trước' : 'Gộp tất cả scene thành video hoàn chỉnh'}
                  >
                    🎬 Hoàn thành Video
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Render Progress */}
      {currentStep === 4 && (
        <div className="studio-step">
          <div className="step-header">
            <h2>🎬 Đang Render — <span style={{ color: video.progress === 100 ? '#22c55e' : '#f59e0b' }}>{video.progress}%</span> {video.renderStep || 'Đang xử lý...'}</h2>
            <div className="progress-bar-container" style={{ marginTop: 8 }}>
              <div className="progress-bar" style={{ width: `${video.progress}%` }}></div>
            </div>
          </div>

          <div className="render-progress-section">
            {video.status === 'error' && (
              <div className="render-error">
                <p>❌ {video.errorMessage}</p>
                <button className="primary-btn" onClick={handleStartRender}>
                  🔄 Thử lại
                </button>
              </div>
            )}

            <div className="scene-progress-list">
              {videoScenes.map((scene) => (
                <div key={scene.sceneIndex} className={`scene-progress-item ${scene.status}`}>
                  <span className="scene-progress-icon">
                    {scene.status === 'done' ? '✅' :
                     scene.status === 'rendering' ? '🔄' :
                     scene.status === 'error' ? '❌' : '⏳'}
                  </span>
                  <span className="scene-progress-title">
                    Scene {scene.sceneIndex}: {scene.title}
                  </span>
                  {scene.duration && (
                    <span className="scene-progress-duration">{Math.round(scene.duration)}s</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Step 5: Output */}
      {currentStep === 5 && (
        <div className="studio-step">
          <div className="step-header">
            <h2>✅ Video hoàn thành</h2>
          </div>

          <div className="output-section">
            {video.videoUrl ? (
              <>
                <div className="video-player-container">
                  <video
                    controls
                    src={`${API_BASE_URL}/subjects/${subjectId}/videos/${videoId}/stream/video?token=${localStorage.getItem('accessToken')}`}
                    className="video-player"
                  >
                    Your browser does not support video.
                  </video>
                </div>

                <div className="video-stats">
                  <div className="stat-item">
                    <span className="stat-label">Thời lượng</span>
                    <span className="stat-value">
                      {video.duration ? `${Math.floor(video.duration / 60)}:${String(Math.floor(video.duration % 60)).padStart(2, '0')}` : '--'}
                    </span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Kích thước</span>
                    <span className="stat-value">
                      {video.fileSize ? `${(video.fileSize / (1024 * 1024)).toFixed(1)} MB` : '--'}
                    </span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Độ phân giải</span>
                    <span className="stat-value">{video.resolution}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Số cảnh</span>
                    <span className="stat-value">{video.totalScenes}</span>
                  </div>
                </div>

                <div className="output-actions">
                  <a
                    href={`${API_BASE_URL}/subjects/${subjectId}/videos/${videoId}/stream/video?token=${localStorage.getItem('accessToken')}`}
                    download
                    className="primary-btn"
                  >
                    ⬇️ Tải video
                  </a>
                  {video.subtitleUrl && (
                    <a
                      href={`${API_BASE_URL}/subjects/${subjectId}/videos/${videoId}/stream/subtitle?token=${localStorage.getItem('accessToken')}`}
                      download
                      className="secondary-btn"
                    >
                      ⬇️ Tải phụ đề
                    </a>
                  )}
                  <button className="secondary-btn" onClick={() => goToStep(2)}>
                    📝 Sửa kịch bản
                  </button>
                </div>
              </>
            ) : (
              <div className="empty-state">
                <span className="empty-icon">🎬</span>
                <h3>Chưa có video</h3>
                <p>Quay lại bước Render để tạo video</p>
                <button className="primary-btn" onClick={() => goToStep(4)}>
                  Đến bước Render
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
