import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Player } from '@remotion/player';
import type { PlayerRef } from '@remotion/player';
import { AcademicComposition } from '../remotion/compositions/AcademicComposition';
import { remotionApi } from '../lib/remotionApi';
import type { RemotionVideoItem } from '../lib/remotionApi';
import type { Scene, VisualType } from '../remotion/types';
import { ModelSelector } from '../components/ModelSelector';
import { TTSSelector } from '../components/TTSSelector';
import './RemotionStudioPage.css';

export const RemotionStudioPage: React.FC = () => {
    const { subjectId, videoId } = useParams<{ subjectId: string; videoId: string }>();
    const navigate = useNavigate();
    const playerRef = useRef<PlayerRef>(null);

    // Main Video State
    const [video, setVideo] = useState<RemotionVideoItem | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isGeneratingScript, setIsGeneratingScript] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'scenes' | 'ai' | 'settings'>('scenes');
    const [selectedSceneIdx, setSelectedSceneIdx] = useState<number>(0);

    // TTS Configuration state aligned with Step 4
    const [ttsOptions, setTtsOptions] = useState<{
        voiceId?: string;
        multilingualMode?: string;
        vittsEngine?: string;
        vittsMode?: string;
        vittsDesignInstruct?: string;
        vittsNormalize?: boolean;
    }>({});
    const [isGeneratingAllAudio, setIsGeneratingAllAudio] = useState(false);
    const [generatingAllProgress, setGeneratingAllProgress] = useState<{ current: number; total: number } | null>(null);

    // Audio & Image generation loading states per scene
    const [generatingAudioIdx, setGeneratingAudioIdx] = useState<number | null>(null);
    const [generatingImageIdx, setGeneratingImageIdx] = useState<number | null>(null);

    // Render Progress State
    const [isRendering, setIsRendering] = useState(false);
    const [renderProgress, setRenderProgress] = useState<number>(0);
    const [renderStatus, setRenderStatus] = useState<string>('idle');
    const [renderUrl, setRenderUrl] = useState<string | null>(null);

    // Fetch Video Details
    const loadVideo = useCallback(async () => {
        if (!subjectId || !videoId) return;
        try {
            setIsLoading(true);
            const res = await remotionApi.get(subjectId, videoId);
            const data = res.data;
            setVideo(data);
            setRenderStatus(data.status);
            setRenderProgress(data.progress || 0);
            if (data.videoUrl) setRenderUrl(data.videoUrl);
            if (data.status === 'rendering') {
                setIsRendering(true);
            }
        } catch (err: any) {
            setError(err.response?.data?.message || 'Không thể tải thông tin video');
        } finally {
            setIsLoading(false);
        }
    }, [subjectId, videoId]);

    useEffect(() => {
        loadVideo();
    }, [loadVideo]);

    // Polling for Render Status
    useEffect(() => {
        let timer: any = null;
        if (isRendering && subjectId && videoId) {
            timer = setInterval(async () => {
                try {
                    const statusRes = await remotionApi.getStatus(subjectId, videoId);
                    const statusData = statusRes.data;
                    setRenderProgress(statusData.progress);
                    setRenderStatus(statusData.status);
                    if (statusData.status === 'completed') {
                        setIsRendering(false);
                        setRenderUrl(statusData.videoUrl || null);
                        clearInterval(timer);
                    } else if (statusData.status === 'failed') {
                        setIsRendering(false);
                        setError(statusData.errorMessage || 'Kết xuất video thất bại');
                        clearInterval(timer);
                    }
                } catch {
                    // silently retry polling
                }
            }, 2500);
        }
        return () => {
            if (timer) clearInterval(timer);
        };
    }, [isRendering, subjectId, videoId]);

    // Calculate scene frame offsets for timeline jump
    const scenes: Scene[] = video?.scenesJson || [];
    const sceneStartFrames = scenes.reduce((acc: number[], _scene: Scene, index: number) => {
        if (index === 0) return [0];
        const prev = acc[index - 1];
        const prevDuration = scenes[index - 1]?.durationInFrames || 90;
        return [...acc, prev + prevDuration];
    }, []);

    const totalDurationInFrames = scenes.reduce((acc: number, s: Scene) => acc + (s.durationInFrames || 90), 0) || 150;
    const totalDurationInSec = Math.round(totalDurationInFrames / (video?.fps || 30));

    const compositionWidth = video?.aspectRatio === '9:16' ? 1080 : 1920;
    const compositionHeight = video?.aspectRatio === '9:16' ? 1920 : 1080;

    // Jump to Scene in Player
    const handleJumpToScene = (index: number) => {
        setSelectedSceneIdx(index);
        const frame = sceneStartFrames[index] || 0;
        playerRef.current?.seekTo(frame);
    };

    // Toggle Aspect Ratio
    const handleToggleAspectRatio = () => {
        if (!video) return;
        const newRatio = video.aspectRatio === '9:16' ? '16:9' : '9:16';
        setVideo({ ...video, aspectRatio: newRatio });
    };

    // Save Video Changes
    const handleSaveVideo = async () => {
        if (!video || !subjectId || !videoId) return;
        try {
            setIsSaving(true);
            const res = await remotionApi.update(subjectId, videoId, {
                title: video.title,
                templateType: video.templateType,
                aspectRatio: video.aspectRatio,
                targetDuration: totalDurationInSec,
                scenes: video.scenesJson,
            });
            setVideo(res.data);
            alert('Đã lưu cấu hình video thành công!');
        } catch (err: any) {
            alert(err.response?.data?.message || 'Lỗi khi lưu video');
        } finally {
            setIsSaving(false);
        }
    };

    // Trigger MP4 Render
    const handleStartRender = async () => {
        if (!video || !subjectId || !videoId) return;
        try {
            await remotionApi.update(subjectId, videoId, {
                title: video.title,
                templateType: video.templateType,
                aspectRatio: video.aspectRatio,
                targetDuration: totalDurationInSec,
                scenes: video.scenesJson,
            });

            setIsRendering(true);
            setRenderProgress(5);
            setRenderStatus('rendering');
            await remotionApi.startRender(subjectId, videoId);
        } catch (err: any) {
            setIsRendering(false);
            alert(err.response?.data?.message || 'Không thể bắt đầu kết xuất MP4');
        }
    };

    // Update specific scene
    const updateScene = (idx: number, patch: Partial<Scene>) => {
        if (!video) return;
        const newScenes = [...video.scenesJson];
        newScenes[idx] = { ...newScenes[idx], ...patch };
        setVideo({ ...video, scenesJson: newScenes });
    };

    // Add Scene
    const handleAddScene = () => {
        if (!video) return;
        const newScene: Scene = {
            id: `scene-${Date.now()}`,
            sceneIndex: video.scenesJson.length + 1,
            sceneType: 'concept',
            title: 'Phân cảnh mới',
            narration: 'Nhập nội dung thuyết minh tại đây...',
            durationInFrames: 120,
            visualType: 'definition',
            visualProps: {
                term: 'Khái niệm mới',
                definition: 'Mô tả khái niệm chính...',
            },
        };
        const updated = [...video.scenesJson, newScene];
        setVideo({ ...video, scenesJson: updated });
        setSelectedSceneIdx(updated.length - 1);
    };

    // Delete Scene
    const handleDeleteScene = (idx: number) => {
        if (!video || video.scenesJson.length <= 1) {
            alert('Video cần có ít nhất 1 phân cảnh!');
            return;
        }
        const updated = video.scenesJson.filter((_: Scene, i: number) => i !== idx);
        setVideo({ ...video, scenesJson: updated });
        if (selectedSceneIdx >= updated.length) {
            setSelectedSceneIdx(updated.length - 1);
        }
    };

    // Move Scene
    const handleMoveScene = (idx: number, direction: 'up' | 'down') => {
        if (!video) return;
        const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (targetIdx < 0 || targetIdx >= video.scenesJson.length) return;
        const updated = [...video.scenesJson];
        const temp = updated[idx];
        updated[idx] = updated[targetIdx];
        updated[targetIdx] = temp;
        // reindex
        updated.forEach((s, i) => { s.sceneIndex = i + 1; });
        setVideo({ ...video, scenesJson: updated });
        setSelectedSceneIdx(targetIdx);
    };

    // Generate Audio (TTS) for Scene using selected TTS config
    const handleGenerateSceneAudio = async (idx: number) => {
        if (!video || !subjectId || !videoId) return;
        const scene = video.scenesJson[idx];
        if (!scene || !scene.narration) {
            alert('Vui lòng nhập thuyết minh cho phân cảnh này trước khi tạo giọng đọc!');
            return;
        }
        try {
            setGeneratingAudioIdx(idx);
            const res = await remotionApi.generateSceneAudio(subjectId, videoId, idx, ttsOptions);
            updateScene(idx, {
                audioUrl: res.data.audioUrl,
                audioDuration: res.data.audioDuration,
                durationInFrames: res.data.durationInFrames || scene.durationInFrames,
            });
        } catch (err: any) {
            alert(err.response?.data?.message || 'Không thể tạo giọng đọc cho phân cảnh này');
        } finally {
            setGeneratingAudioIdx(null);
        }
    };

    // Generate Audio for ALL Scenes in video
    const handleGenerateAllSceneAudios = async () => {
        if (!video || !subjectId || !videoId) return;
        const validScenes = video.scenesJson.filter(s => s.narration && s.narration.trim().length > 0);
        if (validScenes.length === 0) {
            alert('Không có phân cảnh nào có nội dung thuyết minh để tạo giọng đọc!');
            return;
        }

        try {
            setIsGeneratingAllAudio(true);
            setGeneratingAllProgress({ current: 0, total: validScenes.length });
            let doneCount = 0;
            for (let i = 0; i < video.scenesJson.length; i++) {
                const s = video.scenesJson[i];
                if (!s.narration || !s.narration.trim()) continue;
                doneCount++;
                setGeneratingAllProgress({ current: doneCount, total: validScenes.length });
                const res = await remotionApi.generateSceneAudio(subjectId, videoId, i, ttsOptions);
                updateScene(i, {
                    audioUrl: res.data.audioUrl,
                    audioDuration: res.data.audioDuration,
                    durationInFrames: res.data.durationInFrames || s.durationInFrames,
                });
            }
            alert('Đã tạo giọng đọc cho tất cả các phân cảnh thành công!');
        } catch (err: any) {
            alert(err.response?.data?.message || 'Có lỗi khi tạo giọng đọc hàng loạt');
        } finally {
            setIsGeneratingAllAudio(false);
            setGeneratingAllProgress(null);
        }
    };

    // Generate AI Image for Scene
    const handleGenerateSceneImage = async (idx: number) => {
        if (!video || !subjectId || !videoId) return;
        const scene = video.scenesJson[idx];
        const prompt = scene.narration || scene.title;
        try {
            setGeneratingImageIdx(idx);
            const res = await remotionApi.generateSceneImage(subjectId, videoId, idx, prompt);
            updateScene(idx, {
                visualType: 'image',
                visualProps: {
                    imageUrl: res.data.imageUrl,
                    caption: scene.title,
                },
            });
        } catch (err: any) {
            alert(err.response?.data?.message || 'Không thể tạo ảnh minh họa');
        } finally {
            setGeneratingImageIdx(null);
        }
    };

    // AI Generate Script for whole video
    const handleRegenerateScript = async () => {
        if (!subjectId || !videoId) return;
        if (!confirm('Tạo lại kịch bản sẽ ghi đè các phân cảnh hiện tại. Bạn có muốn tiếp tục?')) return;
        try {
            setIsGeneratingScript(true);
            const res = await remotionApi.generateScript(subjectId, videoId);
            setVideo(res.data);
            setSelectedSceneIdx(0);
            alert('Đã tạo kịch bản AI phân cảnh mới thành công!');
        } catch (err: any) {
            alert(err.response?.data?.message || 'Không thể tạo lại kịch bản AI');
        } finally {
            setIsGeneratingScript(false);
        }
    };

    if (isLoading) {
        return (
            <div className="remotion-studio-container" style={{ textAlign: 'center', paddingTop: '100px' }}>
                <p style={{ color: '#94a3b8', fontSize: '16px' }}>⏳ Đang tải Video Studio...</p>
            </div>
        );
    }

    if (!video) {
        return (
            <div className="remotion-studio-container" style={{ textAlign: 'center', paddingTop: '100px' }}>
                <p style={{ color: '#f87171' }}>{error || 'Không tìm thấy video'}</p>
                <button className="back-btn" onClick={() => navigate(`/subjects/${subjectId}`)}>
                    ← Quay lại môn học
                </button>
            </div>
        );
    }

    const currentScene = video.scenesJson[selectedSceneIdx] || video.scenesJson[0];

    return (
        <div className="remotion-studio-container">
            {/* ─── Top Studio Bar ─── */}
            <header className="studio-topbar">
                <div className="topbar-left">
                    <button className="back-btn" onClick={() => navigate(`/subjects/${subjectId}`)}>
                        ← Quay lại môn học
                    </button>
                    <div className="topbar-title-wrap">
                        <h1 className="studio-video-title">{video.title}</h1>
                        <div className="studio-badges-wrap">
                            <span className="studio-badge template">
                                🎨 {video.templateType}
                            </span>
                            <span className="studio-badge aspect">
                                {video.aspectRatio === '9:16' ? '📱 9:16 Shorts' : '🖥️ 16:9 Widescreen'}
                            </span>
                            <span className="studio-badge duration">
                                ⏱️ ~{totalDurationInSec}s ({totalDurationInFrames} frames)
                            </span>
                        </div>
                    </div>
                </div>

                <div className="topbar-right">
                    <button className="aspect-switcher-btn" onClick={handleToggleAspectRatio} title="Chuyển đổi tỉ lệ khung hình">
                        🔄 {video.aspectRatio === '9:16' ? 'Sang 16:9' : 'Sang 9:16 Shorts'}
                    </button>
                    <button className="save-studio-btn" onClick={handleSaveVideo} disabled={isSaving}>
                        💾 {isSaving ? 'Đang lưu...' : 'Lưu Video'}
                    </button>
                    <button
                        className="render-studio-btn"
                        onClick={handleStartRender}
                        disabled={isRendering}
                    >
                        🎬 {isRendering ? 'Đang xuất MP4...' : 'Xuất MP4'}
                    </button>
                </div>
            </header>

            {/* ─── Main Workspace Grid ─── */}
            <div className="studio-grid">
                {/* ─── Left Column: Live Player & Timeline ─── */}
                <div className="player-column">
                    <div className="player-viewport-card">
                        <div className={`player-wrapper ${video.aspectRatio === '9:16' ? 'portrait' : 'landscape'}`}>
                            <Player
                                ref={playerRef}
                                component={AcademicComposition}
                                inputProps={{
                                    title: video.title,
                                    templateType: video.templateType,
                                    aspectRatio: video.aspectRatio,
                                    fps: video.fps || 30,
                                    totalFrames: totalDurationInFrames,
                                    scenes: video.scenesJson,
                                }}
                                durationInFrames={Math.max(30, totalDurationInFrames)}
                                fps={video.fps || 30}
                                compositionWidth={compositionWidth}
                                compositionHeight={compositionHeight}
                                style={{
                                    width: '100%',
                                    aspectRatio: video.aspectRatio === '9:16' ? '9/16' : '16/9',
                                }}
                                controls
                                loop
                                className="player-inner-element"
                            />
                        </div>
                    </div>

                    {/* Render Progress Banner */}
                    {isRendering && (
                        <div className="render-progress-card">
                            <div className="render-progress-header">
                                <span className="render-status-txt">
                                    ⚙️ Đang kết xuất video qua Remotion Renderer Engine...
                                </span>
                                <span style={{ color: '#818cf8' }}>{renderProgress}%</span>
                            </div>
                            <div className="progress-bar-track">
                                <div
                                    className="progress-bar-fill animated"
                                    style={{ width: `${Math.max(renderProgress, 8)}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Render Success Card */}
                    {renderStatus === 'completed' && renderUrl && (
                        <div className="render-success-card">
                            <div>
                                <span style={{ color: '#34d399', fontWeight: 600 }}>🎉 Video đã xuất thành công!</span>
                                <p style={{ fontSize: '12px', color: '#94a3b8', margin: '4px 0 0' }}>
                                    File MP4 chất lượng cao sẵn sàng để phát hoặc tải về.
                                </p>
                            </div>
                            <a
                                href={renderUrl}
                                target="_blank"
                                rel="noreferrer"
                                download
                                className="download-mp4-btn"
                            >
                                📥 Tải Video MP4
                            </a>
                        </div>
                    )}

                    {/* Timeline Scrubber Strip */}
                    <div className="timeline-strip-card">
                        <div className="timeline-header">
                            <span>🎞️ Trục thời gian ({scenes.length} phân cảnh)</span>
                            <span>Nhấn để xem cảnh</span>
                        </div>
                        <div className="timeline-scenes-list">
                            {scenes.map((scene: Scene, idx: number) => (
                                <div
                                    key={scene.id || idx}
                                    className={`timeline-scene-thumb ${selectedSceneIdx === idx ? 'active' : ''}`}
                                    onClick={() => handleJumpToScene(idx)}
                                >
                                    <span className="timeline-scene-idx">Cảnh {idx + 1} ({scene.visualType})</span>
                                    <span className="timeline-scene-title">{scene.title || 'Không có tiêu đề'}</span>
                                    <div className="timeline-scene-meta">
                                        <span>⏱️ {Math.round((scene.durationInFrames || 90) / 30)}s</span>
                                        <span>{scene.audioUrl ? '🔊' : '🔇'}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* ─── Right Column: Studio Controls ─── */}
                <div className="controls-column">
                    <nav className="controls-tabs-nav">
                        <button
                            className={`controls-tab-btn ${activeTab === 'scenes' ? 'active' : ''}`}
                            onClick={() => setActiveTab('scenes')}
                        >
                            🎬 Phân cảnh ({scenes.length})
                        </button>
                        <button
                            className={`controls-tab-btn ${activeTab === 'ai' ? 'active' : ''}`}
                            onClick={() => setActiveTab('ai')}
                        >
                            🤖 AI & Kịch bản
                        </button>
                        <button
                            className={`controls-tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
                            onClick={() => setActiveTab('settings')}
                        >
                            ⚙️ Cài đặt Video
                        </button>
                    </nav>

                    {/* TAB 1: SCENES LIST & ACTIVE SCENE EDITOR */}
                    {activeTab === 'scenes' && (
                        <div className="scenes-container">
                            {/* Scene selector pills */}
                            <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
                                {scenes.map((_: Scene, i: number) => (
                                    <button
                                        key={i}
                                        onClick={() => handleJumpToScene(i)}
                                        style={{
                                            padding: '6px 12px',
                                            borderRadius: '8px',
                                            border: selectedSceneIdx === i ? '1px solid #6366f1' : '1px solid rgba(148, 163, 184, 0.15)',
                                            background: selectedSceneIdx === i ? 'rgba(99, 102, 241, 0.2)' : 'rgba(30, 41, 59, 0.6)',
                                            color: selectedSceneIdx === i ? '#a5b4fc' : '#94a3b8',
                                            fontSize: '12px',
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                            whiteSpace: 'nowrap',
                                        }}
                                    >
                                        Cảnh {i + 1}
                                    </button>
                                ))}
                            </div>

                            {/* Active Scene Card */}
                            {currentScene && (
                                <div className="scene-card-item selected">
                                    <div className="scene-card-header">
                                        <div className="scene-card-title-group">
                                            <span className="scene-order-badge">{selectedSceneIdx + 1}</span>
                                            <select
                                                className="scene-layout-select"
                                                value={currentScene.visualType}
                                                onChange={(e) => updateScene(selectedSceneIdx, { visualType: e.target.value as VisualType })}
                                            >
                                                <option value="definition">💡 Định nghĩa (Definition)</option>
                                                <option value="formula">📐 Công thức toán (KaTeX)</option>
                                                <option value="code">💻 Khối mã lệnh (Code)</option>
                                                <option value="comparison">⚖️ So sánh A vs B</option>
                                                <option value="step_rail">🛤️ Quy trình bước (Step Rail)</option>
                                                <option value="quiz">❓ Câu hỏi tương tác (Quiz)</option>
                                                <option value="image">🖼️ Ảnh minh họa (Image)</option>
                                                <option value="stat_counter">📊 Số liệu trực quan</option>
                                            </select>
                                        </div>

                                        <div className="scene-card-actions">
                                            <button
                                                className="icon-action-btn"
                                                onClick={() => handleMoveScene(selectedSceneIdx, 'up')}
                                                disabled={selectedSceneIdx === 0}
                                                title="Lên trên"
                                            >
                                                ⬆️
                                            </button>
                                            <button
                                                className="icon-action-btn"
                                                onClick={() => handleMoveScene(selectedSceneIdx, 'down')}
                                                disabled={selectedSceneIdx === scenes.length - 1}
                                                title="Xuống dưới"
                                            >
                                                ⬇️
                                            </button>
                                            <button
                                                className="icon-action-btn delete"
                                                onClick={() => handleDeleteScene(selectedSceneIdx)}
                                                title="Xóa phân cảnh"
                                            >
                                                🗑️
                                            </button>
                                        </div>
                                    </div>

                                    {/* Title Field */}
                                    <div className="scene-field-group">
                                        <label className="scene-field-label">Tiêu đề phân cảnh</label>
                                        <input
                                            type="text"
                                            className="scene-input"
                                            value={currentScene.title}
                                            onChange={(e) => updateScene(selectedSceneIdx, { title: e.target.value })}
                                            placeholder="Ví dụ: Định lý Pythagoras"
                                        />
                                    </div>

                                    {/* Narration Field */}
                                    <div className="scene-field-group">
                                        <label className="scene-field-label">
                                            <span>Thuyết minh (Narration)</span>
                                            <span style={{ color: '#64748b' }}>Tự sinh phụ đề nhảy động</span>
                                        </label>
                                        <textarea
                                            className="scene-textarea"
                                            value={currentScene.narration}
                                            onChange={(e) => updateScene(selectedSceneIdx, { narration: e.target.value })}
                                            placeholder="Lời giảng thoại cho người học..."
                                        />
                                    </div>

                                    {/* Media Quick Tools (TTS & Image) */}
                                    <div className="scene-media-toolbar">
                                        <button
                                            className="media-action-btn"
                                            onClick={() => handleGenerateSceneAudio(selectedSceneIdx)}
                                            disabled={generatingAudioIdx === selectedSceneIdx}
                                        >
                                            🎙️ {generatingAudioIdx === selectedSceneIdx ? 'Đang đọc...' : 'Tạo Giọng Đọc'}
                                        </button>

                                        <button
                                            className="media-action-btn"
                                            onClick={() => handleGenerateSceneImage(selectedSceneIdx)}
                                            disabled={generatingImageIdx === selectedSceneIdx}
                                        >
                                            🖼️ {generatingImageIdx === selectedSceneIdx ? 'Đang vẽ...' : 'Tạo Ảnh AI'}
                                        </button>

                                        {currentScene.audioUrl && (
                                            <div className="audio-preview-inline">
                                                <span>✓ Có audio</span>
                                                <audio controls src={currentScene.audioUrl} style={{ height: '24px', width: '140px' }} />
                                            </div>
                                        )}

                                        {currentScene.visualType === 'image' && currentScene.visualProps?.imageUrl && (
                                            <img
                                                src={currentScene.visualProps.imageUrl}
                                                alt="Scene preview"
                                                className="image-preview-thumbnail"
                                                title="Ảnh minh họa cảnh"
                                            />
                                        )}
                                    </div>

                                    {/* Layout-Specific Visual Editors */}
                                    {currentScene.visualType === 'formula' && (
                                        <div className="visual-props-card">
                                            <label className="scene-field-label">Công thức LaTeX (KaTeX)</label>
                                            <input
                                                type="text"
                                                className="scene-input"
                                                value={currentScene.visualProps?.formula || ''}
                                                onChange={(e) =>
                                                    updateScene(selectedSceneIdx, {
                                                        visualProps: { ...currentScene.visualProps, formula: e.target.value },
                                                    })
                                                }
                                                placeholder="e.g. a^2 + b^2 = c^2"
                                            />
                                            <input
                                                type="text"
                                                className="scene-input"
                                                value={currentScene.visualProps?.explanation || ''}
                                                onChange={(e) =>
                                                    updateScene(selectedSceneIdx, {
                                                        visualProps: { ...currentScene.visualProps, explanation: e.target.value },
                                                    })
                                                }
                                                placeholder="Giải thích công thức"
                                            />
                                        </div>
                                    )}

                                    {currentScene.visualType === 'code' && (
                                        <div className="visual-props-card">
                                            <label className="scene-field-label">Ngôn ngữ lập trình</label>
                                            <input
                                                type="text"
                                                className="scene-input"
                                                value={currentScene.visualProps?.language || 'python'}
                                                onChange={(e) =>
                                                    updateScene(selectedSceneIdx, {
                                                        visualProps: { ...currentScene.visualProps, language: e.target.value },
                                                    })
                                                }
                                                placeholder="python, typescript, cpp..."
                                            />
                                            <label className="scene-field-label" style={{ marginTop: '6px' }}>Đoạn mã code</label>
                                            <textarea
                                                className="scene-textarea"
                                                style={{ fontFamily: 'monospace', fontSize: '12px' }}
                                                value={currentScene.visualProps?.code || ''}
                                                onChange={(e) =>
                                                    updateScene(selectedSceneIdx, {
                                                        visualProps: { ...currentScene.visualProps, code: e.target.value },
                                                    })
                                                }
                                                placeholder="def solve():&#10;    return 42"
                                            />
                                        </div>
                                    )}

                                    {currentScene.visualType === 'comparison' && (
                                        <div className="visual-props-card">
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                                <div>
                                                    <label className="scene-field-label">Tiêu chí A</label>
                                                    <input
                                                        type="text"
                                                        className="scene-input"
                                                        value={currentScene.visualProps?.itemA?.title || ''}
                                                        onChange={(e) =>
                                                            updateScene(selectedSceneIdx, {
                                                                visualProps: {
                                                                    ...currentScene.visualProps,
                                                                    itemA: {
                                                                        ...currentScene.visualProps?.itemA,
                                                                        title: e.target.value,
                                                                        points: currentScene.visualProps?.itemA?.points || [],
                                                                    },
                                                                    itemB: currentScene.visualProps?.itemB || { title: '', points: [] },
                                                                },
                                                            })
                                                        }
                                                        placeholder="Mặt A (e.g. SQL)"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="scene-field-label">Tiêu chí B</label>
                                                    <input
                                                        type="text"
                                                        className="scene-input"
                                                        value={currentScene.visualProps?.itemB?.title || ''}
                                                        onChange={(e) =>
                                                            updateScene(selectedSceneIdx, {
                                                                visualProps: {
                                                                    ...currentScene.visualProps,
                                                                    itemA: currentScene.visualProps?.itemA || { title: '', points: [] },
                                                                    itemB: {
                                                                        ...currentScene.visualProps?.itemB,
                                                                        title: e.target.value,
                                                                        points: currentScene.visualProps?.itemB?.points || [],
                                                                    },
                                                                },
                                                            })
                                                        }
                                                        placeholder="Mặt B (e.g. NoSQL)"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {currentScene.visualType === 'quiz' && (
                                        <div className="visual-props-card">
                                            <label className="scene-field-label">Câu hỏi trắc nghiệm</label>
                                            <input
                                                type="text"
                                                className="scene-input"
                                                value={currentScene.visualProps?.question || ''}
                                                onChange={(e) =>
                                                    updateScene(selectedSceneIdx, {
                                                        visualProps: {
                                                            ...currentScene.visualProps,
                                                            question: e.target.value,
                                                            options: currentScene.visualProps?.options || [
                                                                { key: 'A', text: 'Lựa chọn A' },
                                                                { key: 'B', text: 'Lựa chọn B' },
                                                            ],
                                                            correctKey: currentScene.visualProps?.correctKey || 'A',
                                                            explanation: currentScene.visualProps?.explanation || '',
                                                        },
                                                    })
                                                }
                                                placeholder="Nhập câu hỏi kiểm tra nhanh..."
                                            />
                                        </div>
                                    )}

                                    {/* Duration in frames */}
                                    <div className="scene-field-group">
                                        <label className="scene-field-label">
                                            <span>Thời lượng (Frames @ 30 FPS)</span>
                                            <span>~{(currentScene.durationInFrames / 30).toFixed(1)} giây</span>
                                        </label>
                                        <input
                                            type="number"
                                            step={15}
                                            min={30}
                                            className="scene-input"
                                            value={currentScene.durationInFrames}
                                            onChange={(e) => updateScene(selectedSceneIdx, { durationInFrames: parseInt(e.target.value) || 90 })}
                                        />
                                    </div>
                                </div>
                            )}

                            <button className="add-scene-btn" onClick={handleAddScene}>
                                + Thêm phân cảnh mới
                            </button>
                        </div>
                    )}

                    {/* TAB 2: AI & MODELS */}
                    {activeTab === 'ai' && (
                        <div className="ai-settings-card">
                            <h3 style={{ margin: 0, fontSize: '15px', color: '#f8fafc' }}>
                                🤖 Cấu hình AI Model cho Video
                            </h3>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                                <div>
                                    <ModelSelector taskType="VIDEO_SCRIPT" label="Kịch bản & Phân cảnh Video" />
                                </div>
                                <div>
                                    <ModelSelector taskType="VIDEO_CODE" label="Hiệu ứng Visual & Code Video" />
                                </div>
                            </div>

                            <button
                                className="save-studio-btn"
                                style={{ background: 'linear-gradient(135deg, #4f46e5, #06b6d4)', justifyContent: 'center' }}
                                onClick={handleRegenerateScript}
                                disabled={isGeneratingScript}
                            >
                                ⚡ {isGeneratingScript ? 'Đang soạn kịch bản AI...' : 'Tạo lại toàn bộ kịch bản bằng AI'}
                            </button>

                            <div style={{ margin: '16px 0 6px', borderTop: '1px solid rgba(148, 163, 184, 0.15)', paddingTop: '16px' }}>
                                <h3 style={{ margin: '0 0 10px', fontSize: '15px', color: '#f8fafc' }}>
                                    🎙️ Chọn Máy chủ, Model & Giọng đọc TTS
                                </h3>
                                <p style={{ fontSize: '12px', color: '#94a3b8', margin: '0 0 14px' }}>
                                    Tùy chọn nhà cung cấp (Gemini, CLIProxy, Vbee, ViTTS), máy chủ và giọng đọc giống hệt Bước 4.
                                </p>
                                <TTSSelector onChange={(config) => {
                                    setTtsOptions({
                                        voiceId: config.voice,
                                        multilingualMode: config.multilingualMode,
                                        vittsEngine: config.vittsEngine,
                                        vittsMode: config.vittsMode,
                                        vittsDesignInstruct: config.vittsDesignInstruct,
                                        vittsNormalize: config.vittsNormalize,
                                    });
                                }} />
                            </div>

                            <div style={{ marginTop: '16px' }}>
                                <button
                                    className="save-studio-btn"
                                    style={{
                                        background: 'linear-gradient(135deg, #10b981, #06b6d4)',
                                        width: '100%',
                                        justifyContent: 'center',
                                        padding: '12px',
                                        fontSize: '13px',
                                    }}
                                    onClick={handleGenerateAllSceneAudios}
                                    disabled={isGeneratingAllAudio}
                                >
                                    🎙️ {isGeneratingAllAudio
                                        ? `Đang tạo giọng đọc (${generatingAllProgress?.current}/${generatingAllProgress?.total})...`
                                        : 'Tạo Giọng Đọc Cho Tất Cả Phân Cảnh'}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* TAB 3: SETTINGS */}
                    {activeTab === 'settings' && (
                        <div className="settings-section-card">
                            <h3 style={{ margin: 0, fontSize: '15px', color: '#f8fafc' }}>
                                📐 Mẫu Template Học thuật
                            </h3>
                            <select
                                className="scene-input"
                                value={video.templateType}
                                onChange={(e) => setVideo({ ...video, templateType: e.target.value as any })}
                            >
                                <option value="explainer">🧠 Giải thích khái niệm (Concept Explainer)</option>
                                <option value="comparison">⚖️ So sánh đa chiều (Comparison A vs B)</option>
                                <option value="pipeline">🛤️ Quy trình / Pipeline (Step-by-step)</option>
                                <option value="quiz">❓ Câu hỏi tương tác (Quick Quiz)</option>
                            </select>

                            <h3 style={{ margin: '14px 0 0', fontSize: '15px', color: '#f8fafc' }}>
                                📱 Tỉ lệ khung hình (Aspect Ratio)
                            </h3>
                            <select
                                className="scene-input"
                                value={video.aspectRatio}
                                onChange={(e) => setVideo({ ...video, aspectRatio: e.target.value as '9:16' | '16:9' })}
                            >
                                <option value="9:16">📱 9:16 Shorts / Reels (Dọc)</option>
                                <option value="16:9">🖥️ 16:9 Widescreen / Desktop (Ngang)</option>
                            </select>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
export default RemotionStudioPage;
