import React from 'react';
import { useState, useEffect, useRef } from 'react';
import { useLessonEditor } from '../../contexts/LessonEditorContext';
import { api, API_BASE_URL } from '../../lib/api';
import { TTSSelector } from '../TTSSelector';
import '../ModelSelector.css';
import './Step4GenerateAudio.css';

// Helper to get full audio URL from backend
const getFullAudioUrl = (audioUrl: string | null): string => {
    if (!audioUrl) return '';
    // If it's already a full URL, return as-is
    if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://')) {
        return audioUrl;
    }
    // Prepend backend URL
    return `${API_BASE_URL}${audioUrl}`;
};

interface SlideAudio {
    id: string;
    slideIndex: number;
    slideTitle: string;
    speakerNote: string;
    audioFileName: string | null;
    audioUrl: string | null;
    audioDuration: number | null;
    voiceId: string | null;
    status: 'PENDING' | 'GENERATING' | 'COMPLETED' | 'ERROR';
    errorMessage: string | null;
}

export function Step4GenerateAudio() {
    const { lessonId, lessonData } = useLessonEditor();
    const [slideAudios, setSlideAudios] = useState<SlideAudio[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isGeneratingAll, setIsGeneratingAll] = useState(false);
    const [generatingSlides, setGeneratingSlides] = useState<Set<number>>(new Set());
    const [editingSlide, setEditingSlide] = useState<number | null>(null);
    const [editedNote, setEditedNote] = useState('');
    const [currentlyPlaying, setCurrentlyPlaying] = useState<number | null>(null);
    const [playbackProgress, setPlaybackProgress] = useState<Record<number, number>>({});
    const [currentTime, setCurrentTime] = useState<Record<number, number>>({});
    const [multilingualMode, setMultilingualMode] = useState<string>('');
    const audioRefs = useRef<Record<number, HTMLAudioElement>>({});
    const shouldStopGenerating = useRef(false);

    useEffect(() => {
        if (lessonData?.id && lessonData?.slideScript) {
            loadSlideAudios();
        }
    }, [lessonData?.id, lessonData?.slideScript]);

    // Normalize status from backend (lowercase) to frontend (uppercase)
    const normalizeStatus = (status: string): 'PENDING' | 'GENERATING' | 'COMPLETED' | 'ERROR' => {
        const normalized = status?.toLowerCase() || 'pending';
        switch (normalized) {
            case 'done':
            case 'completed':
                return 'COMPLETED';
            case 'generating':
                return 'GENERATING';
            case 'error':
                return 'ERROR';
            default:
                return 'PENDING';
        }
    };

    const normalizeSlideAudios = (data: any[]): SlideAudio[] => {
        return data.map(item => ({
            ...item,
            status: normalizeStatus(item.status),
        }));
    };

    const loadSlideAudios = async () => {
        try {
            setIsLoading(true);
            const response = await api.get(`/lessons/${lessonId}/slide-audios`);

            if (response.data && response.data.length > 0) {
                setSlideAudios(normalizeSlideAudios(response.data));
            } else if (lessonData?.slideScript) {
                const initResponse = await api.post(`/lessons/${lessonId}/slide-audios/init`);
                setSlideAudios(normalizeSlideAudios(initResponse.data));
            }
        } catch (error) {
            console.error('Error loading slide audios:', error);
            if (lessonData?.slideScript) {
                try {
                    const initResponse = await api.post(`/lessons/${lessonId}/slide-audios/init`);
                    setSlideAudios(normalizeSlideAudios(initResponse.data));
                } catch (initError) {
                    console.error('Error initializing slide audios:', initError);
                }
            }
        } finally {
            setIsLoading(false);
        }
    };

    const generateSingleAudio = async (slideIndex: number) => {
        try {
            setGeneratingSlides(prev => new Set(prev).add(slideIndex));
            setSlideAudios(prev => prev.map(sa =>
                sa.slideIndex === slideIndex ? { ...sa, status: 'GENERATING' as const } : sa
            ));

            const response = await api.post(`/lessons/${lessonId}/slide-audios/${slideIndex}/generate`, {
                multilingualMode: multilingualMode || undefined,
            });
            const normalizedData = { ...response.data, status: normalizeStatus(response.data.status) };
            setSlideAudios(prev => prev.map(sa =>
                sa.slideIndex === slideIndex ? normalizedData : sa
            ));

            if (response.data.audioUrl) {
                playAudio(slideIndex, response.data.audioUrl);
            }
        } catch (error: unknown) {
            console.error('Error generating audio:', error);
            const message = error instanceof Error ? error.message : 'Lỗi không xác định';
            setSlideAudios(prev => prev.map(sa =>
                sa.slideIndex === slideIndex ? { ...sa, status: 'ERROR' as const, errorMessage: message } : sa
            ));
        } finally {
            setGeneratingSlides(prev => {
                const next = new Set(prev);
                next.delete(slideIndex);
                return next;
            });
        }
    };

    // Delay helper function
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    const generateAllAudios = async () => {
        try {
            setIsGeneratingAll(true);
            shouldStopGenerating.current = false;

            // Get slides that need audio generation (no audio or need regeneration)
            const slidesToGenerate = slideAudios.filter(sa =>
                sa.status !== 'COMPLETED' || !sa.audioUrl
            );

            let isFirstSlide = true;

            // Process each slide one by one
            for (const slideAudio of slidesToGenerate) {
                // Check if user requested to stop
                if (shouldStopGenerating.current) {
                    console.log('Generation stopped by user');
                    break;
                }

                const slideIndex = slideAudio.slideIndex;

                // Set this specific slide to GENERATING
                setSlideAudios(prev => prev.map(sa =>
                    sa.slideIndex === slideIndex
                        ? { ...sa, status: 'GENERATING' as const }
                        : sa
                ));

                try {
                    // Generate audio for this slide
                    const response = await api.post(`/lessons/${lessonId}/slide-audios/${slideIndex}/generate`, {
                        multilingualMode: multilingualMode || undefined,
                    });
                    const normalizedData = { ...response.data, status: normalizeStatus(response.data.status) };

                    // Update this slide immediately with result
                    setSlideAudios(prev => prev.map(sa =>
                        sa.slideIndex === slideIndex ? normalizedData : sa
                    ));
                } catch (slideError) {
                    console.error(`Error generating audio for slide ${slideIndex}:`, slideError);
                    // Mark as error and continue with next slide
                    setSlideAudios(prev => prev.map(sa =>
                        sa.slideIndex === slideIndex
                            ? { ...sa, status: 'ERROR' as const, errorMessage: 'Lỗi tạo audio' }
                            : sa
                    ));
                }

                // Add delay between requests to prevent ViTTS server overload
                // First slide needs longer delay for GPU model to load into VRAM
                // Subsequent slides need shorter delay for GPU to process
                if (isFirstSlide) {
                    console.log('First slide generated, waiting 8s for model warm-up...');
                    await delay(8000); // 8 seconds for first slide (GPU model loading)
                    isFirstSlide = false;
                } else {
                    console.log('Waiting 2.5s before next slide...');
                    await delay(2500); // 2.5 seconds between subsequent slides
                }
            }
        } catch (error) {
            console.error('Error in generateAllAudios:', error);
        } finally {
            setIsGeneratingAll(false);
            shouldStopGenerating.current = false;
        }
    };

    const stopGenerating = () => {
        shouldStopGenerating.current = true;
    };

    const startEdit = (slideIndex: number, currentNote: string) => {
        setEditingSlide(slideIndex);
        setEditedNote(currentNote);
    };

    const cancelEdit = () => {
        setEditingSlide(null);
        setEditedNote('');
    };

    const saveEdit = async (slideIndex: number) => {
        try {
            const response = await api.put(`/lessons/${lessonId}/slide-audios/${slideIndex}/speaker-note`, {
                speakerNote: editedNote
            });
            const normalizedData = { ...response.data, status: normalizeStatus(response.data.status) };
            setSlideAudios(prev => prev.map(sa =>
                sa.slideIndex === slideIndex ? normalizedData : sa
            ));
            setEditingSlide(null);
            setEditedNote('');
        } catch (error) {
            console.error('Error updating speaker note:', error);
        }
    };

    const playAudio = (slideIndex: number, audioUrl: string) => {
        // Stop currently playing
        if (currentlyPlaying !== null && audioRefs.current[currentlyPlaying]) {
            audioRefs.current[currentlyPlaying].pause();
            audioRefs.current[currentlyPlaying].currentTime = 0;
        }

        if (!audioRefs.current[slideIndex]) {
            audioRefs.current[slideIndex] = new Audio();
        }

        const audio = audioRefs.current[slideIndex];
        // Use full backend URL for audio
        audio.src = getFullAudioUrl(audioUrl);

        // Track playback progress
        audio.ontimeupdate = () => {
            if (audio.duration > 0) {
                const progress = (audio.currentTime / audio.duration) * 100;
                setPlaybackProgress(prev => ({ ...prev, [slideIndex]: progress }));
                setCurrentTime(prev => ({ ...prev, [slideIndex]: audio.currentTime }));
            }
        };

        audio.onended = () => {
            setCurrentlyPlaying(null);
            setPlaybackProgress(prev => ({ ...prev, [slideIndex]: 0 }));
            setCurrentTime(prev => ({ ...prev, [slideIndex]: 0 }));
        };
        audio.onerror = (e) => {
            console.error('Audio playback error:', e);
            setCurrentlyPlaying(null);
            setPlaybackProgress(prev => ({ ...prev, [slideIndex]: 0 }));
        };
        audio.play().catch(err => {
            console.error('Failed to play audio:', err);
            setCurrentlyPlaying(null);
        });
        setCurrentlyPlaying(slideIndex);
    };

    const stopAudio = (slideIndex: number) => {
        if (audioRefs.current[slideIndex]) {
            audioRefs.current[slideIndex].pause();
            audioRefs.current[slideIndex].currentTime = 0;
        }
        setCurrentlyPlaying(null);
    };

    const downloadAllAudios = async () => {
        try {
            const response = await api.get(`/lessons/${lessonId}/slide-audios/download-all`, {
                responseType: 'blob'
            });

            const blob = new Blob([response.data], { type: 'application/zip' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${lessonData?.title || 'Bài học'}_Audio.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Error downloading all audios:', error);
            alert('Lỗi khi tải audio');
        }
    };

    // Format duration - backend returns seconds, not ms
    const formatDuration = (durationInSeconds: number | null) => {
        if (!durationInSeconds || durationInSeconds <= 0) return '--:--';
        const totalSeconds = Math.floor(durationInSeconds);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    // Delete audio for a slide
    const deleteAudio = async (slideIndex: number) => {
        if (!confirm(`Xóa audio cho slide ${slideIndex + 1}?`)) return;

        try {
            // Stop if currently playing
            if (currentlyPlaying === slideIndex) {
                stopAudio(slideIndex);
            }

            // Call API to delete audio
            const response = await api.delete(`/lessons/${lessonId}/slide-audios/${slideIndex}`);
            const normalizedData = { ...response.data, status: normalizeStatus(response.data.status) };

            // Update UI with response
            setSlideAudios(prev => prev.map(sa =>
                sa.slideIndex === slideIndex ? normalizedData : sa
            ));

            // Clear progress for this slide
            setPlaybackProgress(prev => ({ ...prev, [slideIndex]: 0 }));
            setCurrentTime(prev => ({ ...prev, [slideIndex]: 0 }));
        } catch (error) {
            console.error('Error deleting audio:', error);
            alert('Lỗi khi xóa audio');
        }
    };

    const completedCount = slideAudios.filter(sa => sa.status === 'COMPLETED').length;
    const hasAnyAudio = completedCount > 0;

    if (isLoading) {
        return (
            <div className="step4-audio">
                <div className="loading-state">
                    <div className="loading-spinner"></div>
                    <p>Đang tải lời giảng từ kịch bản...</p>
                </div>
            </div>
        );
    }

    if (slideAudios.length === 0 && !lessonData?.slideScript) {
        return (
            <div className="step4-audio">
                <div className="empty-state">
                    <span className="empty-icon">🔊</span>
                    <h3>Chưa có lời giảng</h3>
                    <p>Bạn cần hoàn thành kịch bản slide (Bước 3) trước khi tạo lời giảng audio.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="step4-audio">
            {/* Header */}
            <div className="audio-header">
                <div className="header-left">
                    <h2>🔊 Bước 4: Tạo Lời Giảng (Audio)</h2>
                    <p className="audio-stats">
                        📊 <strong>{completedCount}</strong> / {slideAudios.length} slides đã có audio
                    </p>
                </div>
                <button
                    className="btn-generate-all"
                    onClick={generateAllAudios}
                    disabled={isGeneratingAll}
                >
                    {isGeneratingAll ? (
                        <><span className="spinner"></span> Đang tạo...</>
                    ) : (
                        '🎙️ Tạo Audio Tất Cả'
                    )}
                </button>
                {isGeneratingAll && (
                    <button
                        className="btn-stop"
                        onClick={stopGenerating}
                        title="Dừng tạo audio"
                    >
                        ⏹️ Dừng lại
                    </button>
                )}
            </div>

            {/* TTS Configuration */}
            <TTSSelector onChange={(config) => {
                if (config.multilingualMode !== undefined) {
                    setMultilingualMode(config.multilingualMode || '');
                }
            }} />

            {/* Speaker Notes Table */}
            <div className="speaker-notes-table">
                <table>
                    <thead>
                        <tr>
                            <th className="col-slide">#</th>
                            <th className="col-note">Lời Giảng (Speaker Note)</th>
                            <th className="col-actions">Thao tác</th>
                        </tr>
                    </thead>
                    <tbody>
                        {slideAudios.map((slide) => (
                            <React.Fragment key={slide.id}>
                                <tr className={`slide-row status-${slide.status.toLowerCase()}`}>
                                    <td className="col-slide">
                                        <span className="slide-number">{slide.slideIndex + 1}</span>
                                    </td>
                                    <td className="col-note">
                                        {editingSlide === slide.slideIndex ? (
                                            <div className="edit-mode">
                                                <textarea
                                                    value={editedNote}
                                                    onChange={(e) => setEditedNote(e.target.value)}
                                                    rows={4}
                                                    autoFocus
                                                />
                                                <div className="edit-buttons">
                                                    <button className="btn-save" onClick={() => saveEdit(slide.slideIndex)}>
                                                        💾 Lưu
                                                    </button>
                                                    <button className="btn-cancel" onClick={cancelEdit}>
                                                        Hủy
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="note-content">
                                                <p>{slide.speakerNote}</p>
                                            </div>
                                        )}
                                    </td>
                                    <td className="col-actions">
                                        {editingSlide !== slide.slideIndex && (
                                            <div className="action-buttons">
                                                <button
                                                    className="btn-edit"
                                                    onClick={() => startEdit(slide.slideIndex, slide.speakerNote)}
                                                    title="Chỉnh sửa lời giảng"
                                                >
                                                    ✏️ Edit
                                                </button>
                                                <button
                                                    className="btn-generate"
                                                    onClick={() => generateSingleAudio(slide.slideIndex)}
                                                    disabled={generatingSlides.has(slide.slideIndex) || slide.status === 'GENERATING'}
                                                    title="Tạo/Tạo lại audio"
                                                >
                                                    {generatingSlides.has(slide.slideIndex) || slide.status === 'GENERATING' ? (
                                                        <><span className="spinner-small"></span> Đang tạo</>
                                                    ) : slide.status === 'COMPLETED' ? (
                                                        '🔄 Tạo lại'
                                                    ) : (
                                                        '🎙️ Tạo Audio'
                                                    )}
                                                </button>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                                {/* Playback Row */}
                                {slide.status === 'COMPLETED' && slide.audioUrl && (
                                    <tr key={`${slide.id}-playback`} className="playback-row">
                                        <td></td>
                                        <td colSpan={2}>
                                            <div className="playback-section">
                                                {/* Progress bar - full width */}
                                                <div className="progress-bar-container">
                                                    <div
                                                        className="progress-bar"
                                                        style={{ width: `${playbackProgress[slide.slideIndex] || 0}%` }}
                                                    />
                                                </div>
                                                <div className="playback-controls">
                                                    {currentlyPlaying === slide.slideIndex ? (
                                                        <button className="btn-stop" onClick={() => stopAudio(slide.slideIndex)}>
                                                            ⏹️ Dừng
                                                        </button>
                                                    ) : (
                                                        <button className="btn-play" onClick={() => playAudio(slide.slideIndex, slide.audioUrl!)}>
                                                            ▶️ Phát
                                                        </button>
                                                    )}
                                                    <span className="time-display">
                                                        {formatDuration(currentTime[slide.slideIndex] || 0)} / {formatDuration(slide.audioDuration)}
                                                    </span>
                                                    <span className="filename">📁 {slide.audioFileName || `slide${slide.slideIndex + 1}.wav`}</span>
                                                    <a
                                                        href={getFullAudioUrl(slide.audioUrl)}
                                                        download={slide.audioFileName || `slide${slide.slideIndex + 1}.wav`}
                                                        className="btn-download"
                                                        title="Tải xuống"
                                                    >
                                                        📥
                                                    </a>
                                                    <button
                                                        className="btn-delete-small"
                                                        onClick={() => deleteAudio(slide.slideIndex)}
                                                        title="Xóa audio"
                                                    >
                                                        🗑️
                                                    </button>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                                {/* Error Row */}
                                {slide.status === 'ERROR' && slide.errorMessage && (
                                    <tr key={`${slide.id}-error`} className="error-row">
                                        <td></td>
                                        <td colSpan={2}>
                                            <div className="error-message">⚠️ {slide.errorMessage}</div>
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Download All Button */}
            {hasAnyAudio && (
                <div className="bottom-actions">
                    <button className="btn-download-all" onClick={downloadAllAudios}>
                        📥 Tải Tất Cả Audio (ZIP)
                    </button>
                </div>
            )}
        </div>
    );
}
