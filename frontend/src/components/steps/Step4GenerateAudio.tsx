import { useState, useEffect, useRef } from 'react';
import { useLessonEditor } from '../../contexts/LessonEditorContext';
import { api, API_BASE_URL } from '../../lib/api';
import { TTSSelector } from '../TTSSelector';
import { ModelSelector } from '../ModelSelector';
import '../ModelSelector.css';
import './Step4GenerateAudio.css';

// Helper to get full audio URL from backend
const getFullAudioUrl = (audioUrl: string | null): string => {
    if (!audioUrl) return '';
    if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://')) {
        return audioUrl;
    }
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

interface SlideContent {
    id: string;
    slideIndex: number;
    slideType: string;
    title: string;
    content: string | null;
    visualIdea: string | null;
    speakerNote: string | null;
}

export function Step4GenerateAudio() {
    const { lessonId, lessonData, refreshLessonData } = useLessonEditor();
    const [slideAudios, setSlideAudios] = useState<SlideAudio[]>([]);
    const [slideContents, setSlideContents] = useState<SlideContent[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isGeneratingNotes, setIsGeneratingNotes] = useState(false);
    const [isGeneratingAll, setIsGeneratingAll] = useState(false);
    const [generatingSlides, setGeneratingSlides] = useState<Set<number>>(new Set());
    const [editingSlide, setEditingSlide] = useState<number | null>(null);
    const [editedNote, setEditedNote] = useState('');
    const [currentlyPlaying, setCurrentlyPlaying] = useState<number | null>(null);
    const [playbackProgress, setPlaybackProgress] = useState<Record<number, number>>({});
    const [currentTime, setCurrentTime] = useState<Record<number, number>>({});
    const [multilingualMode, setMultilingualMode] = useState<string>('');
    const [recordingSlide, setRecordingSlide] = useState<number | null>(null);
    const audioRefs = useRef<Record<number, HTMLAudioElement>>({});
    const shouldStopGenerating = useRef(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);

    useEffect(() => {
        if (lessonData?.id) {
            refreshLessonData();
            loadData();
        }
    }, [lessonData?.id]);

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

    const loadData = async () => {
        try {
            setIsLoading(true);
            // Load slide contents from Slide table
            const slidesRes = await api.get(`/lessons/${lessonId}/slides`);
            if (slidesRes.data && slidesRes.data.length > 0) {
                setSlideContents(slidesRes.data);
            }

            // Load existing SlideAudio records
            const audioRes = await api.get(`/lessons/${lessonId}/slide-audios`);
            if (audioRes.data && audioRes.data.length > 0) {
                setSlideAudios(normalizeSlideAudios(audioRes.data));
            } else if (lessonData?.slideScript) {
                // Initialize from slideScript if no audios exist yet
                try {
                    const initRes = await api.post(`/lessons/${lessonId}/slide-audios/init`);
                    setSlideAudios(normalizeSlideAudios(initRes.data));
                } catch (initErr) {
                    console.error('Error initializing slide audios:', initErr);
                }
            }
        } catch (error) {
            console.error('Error loading data:', error);
        } finally {
            setIsLoading(false);
        }
    };

    // ═══════════════════════════════════════════════════════════════
    // SPEAKER NOTES GENERATION (NEW)
    // ═══════════════════════════════════════════════════════════════
    const generateSpeakerNotes = async () => {
        try {
            setIsGeneratingNotes(true);
            const response = await api.post(`/lessons/${lessonId}/slide-audios/generate-speaker-notes`);
            setSlideAudios(normalizeSlideAudios(response.data));
            // Also reload slide contents to get updated speakerNote fields
            const slidesRes = await api.get(`/lessons/${lessonId}/slides`);
            if (slidesRes.data) setSlideContents(slidesRes.data);
        } catch (error) {
            console.error('Error generating speaker notes:', error);
            alert('Lỗi khi tạo lời giảng. Vui lòng thử lại.');
        } finally {
            setIsGeneratingNotes(false);
        }
    };

    // ═══════════════════════════════════════════════════════════════
    // RECORDING (NEW)
    // ═══════════════════════════════════════════════════════════════
    const startRecording = async (slideIndex: number) => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            mediaRecorderRef.current = mediaRecorder;
            chunksRef.current = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };

            mediaRecorder.onstop = async () => {
                stream.getTracks().forEach(t => t.stop());
                const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
                await uploadRecording(slideIndex, blob);
                setRecordingSlide(null);
            };

            mediaRecorder.start();
            setRecordingSlide(slideIndex);
        } catch (err) {
            console.error('Error starting recording:', err);
            alert('Không thể truy cập microphone. Vui lòng kiểm tra quyền.');
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop();
        }
    };

    const uploadRecording = async (slideIndex: number, blob: Blob) => {
        try {
            const formData = new FormData();
            formData.append('audio', blob, `recording_slide_${slideIndex}.webm`);
            const response = await api.post(
                `/lessons/${lessonId}/slide-audios/${slideIndex}/upload-recording`,
                formData,
                { headers: { 'Content-Type': 'multipart/form-data' } },
            );
            const normalizedData = { ...response.data, status: normalizeStatus(response.data.status) };
            setSlideAudios(prev => prev.map(sa =>
                sa.slideIndex === slideIndex ? normalizedData : sa
            ));
        } catch (error) {
            console.error('Error uploading recording:', error);
            alert('Lỗi khi upload audio ghi âm.');
        }
    };

    // ═══════════════════════════════════════════════════════════════
    // EXISTING FUNCTIONALITY (KEPT)
    // ═══════════════════════════════════════════════════════════════
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

    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    const generateAllAudios = async () => {
        try {
            setIsGeneratingAll(true);
            shouldStopGenerating.current = false;
            const slidesToGenerate = slideAudios.filter(sa =>
                sa.status !== 'COMPLETED' || !sa.audioUrl
            );
            let isFirstSlide = true;
            for (const slideAudio of slidesToGenerate) {
                if (shouldStopGenerating.current) break;
                const slideIndex = slideAudio.slideIndex;
                setSlideAudios(prev => prev.map(sa =>
                    sa.slideIndex === slideIndex ? { ...sa, status: 'GENERATING' as const } : sa
                ));
                try {
                    const response = await api.post(`/lessons/${lessonId}/slide-audios/${slideIndex}/generate`, {
                        multilingualMode: multilingualMode || undefined,
                    });
                    const normalizedData = { ...response.data, status: normalizeStatus(response.data.status) };
                    setSlideAudios(prev => prev.map(sa =>
                        sa.slideIndex === slideIndex ? normalizedData : sa
                    ));
                } catch (slideError) {
                    console.error(`Error generating audio for slide ${slideIndex}:`, slideError);
                    setSlideAudios(prev => prev.map(sa =>
                        sa.slideIndex === slideIndex ? { ...sa, status: 'ERROR' as const, errorMessage: 'Lỗi tạo audio' } : sa
                    ));
                }
                if (isFirstSlide) {
                    await delay(8000);
                    isFirstSlide = false;
                } else {
                    await delay(2500);
                }
            }
        } catch (error) {
            console.error('Error in generateAllAudios:', error);
        } finally {
            setIsGeneratingAll(false);
            shouldStopGenerating.current = false;
        }
    };

    const stopGenerating = () => { shouldStopGenerating.current = true; };

    const startEdit = (slideIndex: number, currentNote: string) => {
        setEditingSlide(slideIndex);
        setEditedNote(currentNote);
    };

    const cancelEdit = () => { setEditingSlide(null); setEditedNote(''); };

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
        if (currentlyPlaying !== null && audioRefs.current[currentlyPlaying]) {
            audioRefs.current[currentlyPlaying].pause();
            audioRefs.current[currentlyPlaying].currentTime = 0;
        }
        if (!audioRefs.current[slideIndex]) {
            audioRefs.current[slideIndex] = new Audio();
        }
        const audio = audioRefs.current[slideIndex];
        audio.src = getFullAudioUrl(audioUrl);
        audio.ontimeupdate = () => {
            if (audio.duration > 0) {
                setPlaybackProgress(prev => ({ ...prev, [slideIndex]: (audio.currentTime / audio.duration) * 100 }));
                setCurrentTime(prev => ({ ...prev, [slideIndex]: audio.currentTime }));
            }
        };
        audio.onended = () => {
            setCurrentlyPlaying(null);
            setPlaybackProgress(prev => ({ ...prev, [slideIndex]: 0 }));
            setCurrentTime(prev => ({ ...prev, [slideIndex]: 0 }));
        };
        audio.onerror = () => {
            setCurrentlyPlaying(null);
            setPlaybackProgress(prev => ({ ...prev, [slideIndex]: 0 }));
        };
        audio.play().catch(() => setCurrentlyPlaying(null));
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

    const formatDuration = (durationInSeconds: number | null) => {
        if (!durationInSeconds || durationInSeconds <= 0) return '--:--';
        const totalSeconds = Math.floor(durationInSeconds);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    const deleteAudio = async (slideIndex: number) => {
        if (!confirm(`Xóa audio cho slide ${slideIndex + 1}?`)) return;
        try {
            if (currentlyPlaying === slideIndex) stopAudio(slideIndex);
            const response = await api.delete(`/lessons/${lessonId}/slide-audios/${slideIndex}`);
            const normalizedData = { ...response.data, status: normalizeStatus(response.data.status) };
            setSlideAudios(prev => prev.map(sa =>
                sa.slideIndex === slideIndex ? normalizedData : sa
            ));
            setPlaybackProgress(prev => ({ ...prev, [slideIndex]: 0 }));
            setCurrentTime(prev => ({ ...prev, [slideIndex]: 0 }));
        } catch (error) {
            console.error('Error deleting audio:', error);
            alert('Lỗi khi xóa audio');
        }
    };

    const deleteAllAudios = async () => {
        if (!confirm('Xóa TẤT CẢ audio đã tạo? Hành động này không thể hoàn tác.')) return;
        try {
            if (currentlyPlaying !== null) stopAudio(currentlyPlaying);
            await api.delete(`/lessons/${lessonId}/slide-audios/delete-all`);
            await loadData();
        } catch (error) {
            console.error('Error deleting all audios:', error);
            alert('Lỗi khi xóa audio');
        }
    };

    // ═══════════════════════════════════════════════════════════════
    // RENDER HELPERS
    // ═══════════════════════════════════════════════════════════════
    const parseContent = (content: string | null): string[] => {
        if (!content) return [];
        try {
            const parsed = JSON.parse(content);
            return Array.isArray(parsed) ? parsed : [content];
        } catch {
            return content.split('\n').filter(l => l.trim());
        }
    };

    const hasSpeakerNotes = slideAudios.some(sa => sa.speakerNote?.trim());
    const completedCount = slideAudios.filter(sa => sa.status === 'COMPLETED').length;
    const hasAnyAudio = completedCount > 0;
    const staleAudioCount = slideAudios.filter(sa => sa.status === 'PENDING' && sa.audioUrl).length;

    // Use slide contents as the primary list, merge with audio data
    const slides = slideContents.length > 0
        ? slideContents
        : slideAudios.map(sa => ({
            id: sa.id,
            slideIndex: sa.slideIndex,
            slideType: 'content',
            title: sa.slideTitle,
            content: null,
            visualIdea: null,
            speakerNote: sa.speakerNote,
        }));

    // ═══════════════════════════════════════════════════════════════
    // RENDER
    // ═══════════════════════════════════════════════════════════════
    if (isLoading) {
        return (
            <div className="step4-audio">
                <div className="loading-state">
                    <div className="loading-spinner"></div>
                    <p>Đang tải dữ liệu slides...</p>
                </div>
            </div>
        );
    }

    if (slides.length === 0 && !lessonData?.slideScript) {
        return (
            <div className="step4-audio">
                <div className="empty-state">
                    <span className="empty-icon">🔊</span>
                    <h3>Chưa có nội dung slides</h3>
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
                    <h2>🔊 Bước 4: Lời Giảng & Audio</h2>
                    <p className="audio-stats">
                        📊 <strong>{completedCount}</strong> / {slideAudios.length} slides đã có audio
                        {hasSpeakerNotes && <> · ✅ Đã có lời giảng</>}
                    </p>
                </div>
                <div className="header-actions">
                    {/* Generate Speaker Notes Button */}
                    <button
                        className="btn-generate-notes"
                        onClick={generateSpeakerNotes}
                        disabled={isGeneratingNotes}
                    >
                        {isGeneratingNotes ? (
                            <><span className="spinner"></span> Đang tạo lời giảng...</>
                        ) : hasSpeakerNotes ? (
                            '🔄 Tạo lại Lời Giảng'
                        ) : (
                            '✨ Tạo Lời Giảng'
                        )}
                    </button>
                    {/* Generate All Audio Button */}
                    <button
                        className="btn-generate-all"
                        onClick={generateAllAudios}
                        disabled={isGeneratingAll || !hasSpeakerNotes}
                        title={!hasSpeakerNotes ? 'Tạo lời giảng trước' : ''}
                    >
                        {isGeneratingAll ? (
                            <><span className="spinner"></span> Đang tạo audio...</>
                        ) : (
                            '🎙️ Tạo Audio Tất Cả'
                        )}
                    </button>
                    {isGeneratingAll && (
                        <button className="btn-stop" onClick={stopGenerating} title="Dừng tạo audio">
                            ⏹️ Dừng
                        </button>
                    )}
                </div>
            </div>

            {/* Stale Audio Warning */}
            {staleAudioCount > 0 && (
                <div className="stale-audio-warning">
                    ⚠️ <strong>{staleAudioCount} slide</strong> có lời giảng đã sửa nhưng audio chưa cập nhật.
                </div>
            )}

            {/* Model Selection for Speaker Notes */}
            <ModelSelector taskType="SPEAKER_NOTES" compact />

            {/* TTS Configuration */}
            <TTSSelector onChange={(config) => {
                if (config.multilingualMode !== undefined) {
                    setMultilingualMode(config.multilingualMode || '');
                }
            }} />

            {/* Slide Cards */}
            <div className="slide-cards">
                {slides.map((slide) => {
                    const audio = slideAudios.find(sa => sa.slideIndex === slide.slideIndex);
                    const contentItems = parseContent(slide.content);
                    const speakerNote = audio?.speakerNote || slide.speakerNote || '';
                    const hasAudio = audio?.status === 'COMPLETED' || (audio?.status === 'PENDING' && audio?.audioUrl);
                    const isEditing = editingSlide === slide.slideIndex;
                    const isGenerating = generatingSlides.has(slide.slideIndex) || audio?.status === 'GENERATING';
                    const isRecording = recordingSlide === slide.slideIndex;

                    return (
                        <div key={slide.id} className={`slide-card ${audio?.status?.toLowerCase() || 'pending'}`}>
                            {/* Card Header: Slide Number + Title */}
                            <div className="card-header">
                                <span className="slide-badge">{slide.slideIndex}</span>
                                <h3 className="slide-title">{slide.title}</h3>
                                <span className="slide-type-badge">{slide.slideType}</span>
                            </div>

                            {/* Card Body: 2-Column Layout */}
                            <div className="card-body">
                                {/* Left: Slide Content */}
                                <div className="card-content-col">
                                    <div className="col-label">📋 Nội dung Slide</div>
                                    {contentItems.length > 0 ? (
                                        <ul className="content-bullets">
                                            {contentItems.map((item, i) => (
                                                <li key={i}>{item}</li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <p className="empty-content">Không có nội dung chi tiết</p>
                                    )}
                                    {slide.visualIdea && (
                                        <div className="visual-hint">🖼️ {slide.visualIdea}</div>
                                    )}
                                </div>

                                {/* Right: Speaker Note */}
                                <div className="card-note-col">
                                    <div className="col-label">🎤 Lời Giảng</div>
                                    {isEditing ? (
                                        <div className="edit-mode">
                                            <textarea
                                                value={editedNote}
                                                onChange={(e) => setEditedNote(e.target.value)}
                                                rows={6}
                                                autoFocus
                                            />
                                            <div className="edit-buttons">
                                                <button className="btn-save" onClick={() => saveEdit(slide.slideIndex)}>💾 Lưu</button>
                                                <button className="btn-cancel" onClick={cancelEdit}>Hủy</button>
                                            </div>
                                        </div>
                                    ) : speakerNote ? (
                                        <div className="note-content">
                                            <p>{speakerNote}</p>
                                            <button className="btn-edit-inline" onClick={() => startEdit(slide.slideIndex, speakerNote)} title="Chỉnh sửa">
                                                ✏️
                                            </button>
                                        </div>
                                    ) : (
                                        <p className="empty-note">Chưa có lời giảng. Nhấn "✨ Tạo Lời Giảng" để tạo.</p>
                                    )}
                                </div>
                            </div>

                            {/* Card Footer: Audio Controls */}
                            <div className="card-footer">
                                <div className="audio-actions">
                                    {/* Generate TTS Button */}
                                    <button
                                        className="btn-generate"
                                        onClick={() => generateSingleAudio(slide.slideIndex)}
                                        disabled={isGenerating || !speakerNote}
                                        title={!speakerNote ? 'Cần có lời giảng trước' : 'Tạo audio TTS'}
                                    >
                                        {isGenerating ? (
                                            <><span className="spinner-small"></span> Đang tạo</>
                                        ) : hasAudio ? '🔄 Tạo lại' : '🎙️ Tạo Audio'}
                                    </button>

                                    {/* Record Button */}
                                    {isRecording ? (
                                        <button className="btn-recording" onClick={stopRecording}>
                                            ⏹️ Dừng ghi
                                        </button>
                                    ) : (
                                        <button
                                            className="btn-record"
                                            onClick={() => startRecording(slide.slideIndex)}
                                            disabled={recordingSlide !== null && recordingSlide !== slide.slideIndex}
                                            title="Ghi âm giọng nói"
                                        >
                                            🎤 Ghi âm
                                        </button>
                                    )}
                                </div>

                                {/* Audio Playback */}
                                {hasAudio && audio && (
                                    <div className="playback-section">
                                        <div className="progress-bar-container">
                                            <div
                                                className="progress-bar"
                                                style={{ width: `${playbackProgress[slide.slideIndex] || 0}%` }}
                                            />
                                        </div>
                                        <div className="playback-controls">
                                            {currentlyPlaying === slide.slideIndex ? (
                                                <button className="btn-stop-play" onClick={() => stopAudio(slide.slideIndex)}>⏹️</button>
                                            ) : (
                                                <button className="btn-play" onClick={() => playAudio(slide.slideIndex, audio.audioUrl!)}>▶️</button>
                                            )}
                                            <span className="time-display">
                                                {formatDuration(currentTime[slide.slideIndex] || 0)} / {formatDuration(audio.audioDuration)}
                                            </span>
                                            <span className="audio-source">
                                                {audio.voiceId === 'recording' ? '🎤 Ghi âm' : `🤖 ${audio.voiceId || 'TTS'}`}
                                            </span>
                                            <a
                                                href={getFullAudioUrl(audio.audioUrl)}
                                                download={audio.audioFileName || `slide${slide.slideIndex}.wav`}
                                                className="btn-download"
                                                title="Tải xuống"
                                            >📥</a>
                                            <button className="btn-delete-small" onClick={() => deleteAudio(slide.slideIndex)} title="Xóa audio">🗑️</button>
                                        </div>
                                    </div>
                                )}

                                {/* Stale warning */}
                                {audio?.status === 'PENDING' && audio?.audioUrl && (
                                    <div className="stale-message">⚠️ Lời giảng đã thay đổi — audio có thể không khớp</div>
                                )}

                                {/* Error */}
                                {audio?.status === 'ERROR' && audio?.errorMessage && (
                                    <div className="error-message">⚠️ {audio.errorMessage}</div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Bottom Actions */}
            {hasAnyAudio && (
                <div className="bottom-actions">
                    <button className="btn-download-all" onClick={downloadAllAudios}>
                        📥 Tải Tất Cả Audio (ZIP)
                    </button>
                    <button className="btn-delete-all" onClick={deleteAllAudios}>
                        🗑️ Xóa Tất Cả Audio
                    </button>
                </div>
            )}
        </div>
    );
}
