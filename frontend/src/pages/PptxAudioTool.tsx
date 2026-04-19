import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, API_BASE_URL } from '../lib/api';
import { TTSSelector } from '../components/TTSSelector';
import { ModelSelector } from '../components/ModelSelector';
import './PptxAudioTool.css';

const getFullAudioUrl = (audioUrl: string | null): string => {
    if (!audioUrl) return '';
    if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://')) return audioUrl;
    return `${API_BASE_URL}${audioUrl}`;
};

interface ParsedSlide {
    index: number;
    title: string;
    content: string[];
    noteFull: string;
    noteEN: string;
    noteVN: string;
    hasDual: boolean;
    audioUrl: string | null;
    audioDuration: number | null;
    audioStatus: string;
    errorMessage: string | null;
}

interface SessionData {
    id: string;
    fileName: string;
    language: string;
    status: string;
    slides: ParsedSlide[];
    totalSlides: number;
    questionsJson?: string | null;
}

const STEPS = [
    { key: 'upload', label: '📤 Upload', icon: '📤' },
    { key: 'audio', label: '🎙️ Audio', icon: '🎙️' },
    { key: 'download', label: '📥 Download', icon: '📥' },
    { key: 'content', label: '📋 Content', icon: '📋' },
    { key: 'questions', label: '❓ Questions', icon: '❓' },
];

export function PptxAudioToolPage() {
    const { sessionId: paramSessionId } = useParams();
    const navigate = useNavigate();

    const [activeStep, setActiveStep] = useState(0);
    const [sessionId, setSessionId] = useState<string | null>(paramSessionId || null);
    const [session, setSession] = useState<SessionData | null>(null);
    const [slides, setSlides] = useState<ParsedSlide[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    // Upload state
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [dragOver, setDragOver] = useState(false);

    // Audio state
    const [language, setLanguage] = useState<'en' | 'vi'>('vi');
    const [isGeneratingAll, setIsGeneratingAll] = useState(false);
    const [generatingSlides, setGeneratingSlides] = useState<Set<number>>(new Set());
    const [editingSlide, setEditingSlide] = useState<number | null>(null);
    const [editedNote, setEditedNote] = useState('');
    const [currentlyPlaying, setCurrentlyPlaying] = useState<number | null>(null);
    const [playbackProgress, setPlaybackProgress] = useState<Record<number, number>>({});
    const [currentTime, setCurrentTime] = useState<Record<number, number>>({});
    const [multilingualMode, setMultilingualMode] = useState<string>('');
    const [vittsMode, setVittsMode] = useState<string>('');
    const [vittsDesignInstruct, setVittsDesignInstruct] = useState<string>('');
    const [vittsNormalize, setVittsNormalize] = useState<boolean>(true);
    const audioRefs = useRef<Record<number, HTMLAudioElement>>({});
    const shouldStopGenerating = useRef(false);

    // Questions state
    const [questions, setQuestions] = useState<any[]>([]);
    const [isGeneratingQuestions, setIsGeneratingQuestions] = useState(false);
    const [questionCounts, setQuestionCounts] = useState({ level1: 20, level2: 20, level3: 10 });

    // Download state
    const [isDownloading, setIsDownloading] = useState(false);

    // Session history state
    interface SessionHistoryItem {
        id: string;
        fileName: string;
        status: string;
        language: string;
        createdAt: string;
        updatedAt: string;
        totalSlides: number;
        audioCount: number;
    }
    const [sessionHistory, setSessionHistory] = useState<SessionHistoryItem[]>([]);
    const [isDeletingSession, setIsDeletingSession] = useState<string | null>(null);

    // Load session on mount if sessionId exists, always load history
    useEffect(() => {
        loadSessionHistory();
        if (paramSessionId) {
            loadSession(paramSessionId);
        }
    }, [paramSessionId]);

    const loadSessionHistory = async () => {
        try {
            const res = await api.get('/pptx-audio-tool');
            setSessionHistory(res.data || []);
        } catch (error) {
            console.error('Error loading session history:', error);
        }
    };

    const loadSession = async (sid: string) => {
        try {
            setIsLoading(true);
            const res = await api.get(`/pptx-audio-tool/${sid}`);
            setSession(res.data);
            setSlides(res.data.slides || []);
            setLanguage(res.data.language || 'vi');
            setSessionId(sid);
            if (res.data.questionsJson) {
                try { setQuestions(JSON.parse(res.data.questionsJson)); } catch { /* empty */ }
            }
            // Auto-navigate to audio step if already uploaded
            if (res.data.status !== 'uploaded') {
                setActiveStep(1);
            }
        } catch (error) {
            console.error('Error loading session:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const refreshSlides = async () => {
        if (!sessionId) return;
        try {
            const res = await api.get(`/pptx-audio-tool/${sessionId}/slides`);
            setSlides(res.data);
        } catch (error) {
            console.error('Error refreshing slides:', error);
        }
    };

    // ═══════════════════════════════════════════════════════════════
    // STEP 1: UPLOAD
    // ═══════════════════════════════════════════════════════════════
    const handleUpload = async (file: File) => {
        if (!file.name.endsWith('.pptx')) {
            alert('Chỉ hỗ trợ file .pptx');
            return;
        }

        try {
            setIsUploading(true);
            setUploadProgress(10);

            const formData = new FormData();
            formData.append('file', file);

            setUploadProgress(30);
            const res = await api.post('/pptx-audio-tool/upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                onUploadProgress: (e) => {
                    if (e.total) setUploadProgress(Math.round((e.loaded / e.total) * 70) + 30);
                },
            });

            setUploadProgress(100);
            setSessionId(res.data.sessionId);
            setSlides(res.data.slides || []);
            setSession(res.data);
            setQuestions([]); // Reset questions for new file
            navigate(`/pptx-audio-tool/${res.data.sessionId}`);
            setActiveStep(1); // Auto-advance to audio step
            loadSessionHistory(); // Refresh history
        } catch (error: any) {
            console.error('Upload failed:', error);
            alert(`Upload thất bại: ${error.response?.data?.message || error.message}`);
        } finally {
            setIsUploading(false);
            setUploadProgress(0);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) handleUpload(file);
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleUpload(file);
    };

    // ═══════════════════════════════════════════════════════════════
    // STEP 2: AUDIO
    // ═══════════════════════════════════════════════════════════════
    const toggleLanguage = async (lang: 'en' | 'vi') => {
        if (!sessionId) return;
        try {
            await api.put(`/pptx-audio-tool/${sessionId}/language`, { language: lang });
            setLanguage(lang);
        } catch (error) {
            console.error('Error setting language:', error);
        }
    };

    const getActiveNote = (slide: ParsedSlide): string => {
        return language === 'en' ? slide.noteEN : slide.noteVN;
    };

    const startEdit = (slideIndex: number, currentNote: string) => {
        setEditingSlide(slideIndex);
        setEditedNote(currentNote);
    };

    const cancelEdit = () => { setEditingSlide(null); setEditedNote(''); };

    const saveEdit = async (slideIndex: number) => {
        if (!sessionId) return;
        try {
            const res = await api.put(`/pptx-audio-tool/${sessionId}/slides/${slideIndex}/note`, {
                note: editedNote,
            });
            setSlides(prev => prev.map(s => s.index === slideIndex ? { ...s, ...res.data } : s));
            setEditingSlide(null);
            setEditedNote('');
        } catch (error) {
            console.error('Error updating note:', error);
        }
    };

    const generateSingleAudio = async (slideIndex: number) => {
        if (!sessionId) return;
        try {
            setGeneratingSlides(prev => new Set(prev).add(slideIndex));
            setSlides(prev => prev.map(s =>
                s.index === slideIndex ? { ...s, audioStatus: 'generating', errorMessage: null } : s
            ));

            const res = await api.post(`/pptx-audio-tool/${sessionId}/slides/${slideIndex}/generate-audio`, {
                multilingualMode: multilingualMode || undefined,
                vittsMode: vittsMode || undefined,
                vittsDesignInstruct: vittsDesignInstruct || undefined,
                vittsNormalize,
            });

            setSlides(prev => prev.map(s => s.index === slideIndex ? res.data : s));
            if (res.data.audioUrl) playAudio(slideIndex, res.data.audioUrl);
        } catch (error: any) {
            console.error('Error generating audio:', error);
            setSlides(prev => prev.map(s =>
                s.index === slideIndex ? { ...s, audioStatus: 'error', errorMessage: error.response?.data?.message || 'Lỗi tạo audio' } : s
            ));
        } finally {
            setGeneratingSlides(prev => { const n = new Set(prev); n.delete(slideIndex); return n; });
        }
    };

    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    const generateAllAudios = async () => {
        if (!sessionId) return;
        try {
            setIsGeneratingAll(true);
            shouldStopGenerating.current = false;

            const toGenerate = slides.filter(s =>
                getActiveNote(s)?.trim() && s.audioStatus !== 'done'
            );

            let isFirst = true;
            for (const slide of toGenerate) {
                if (shouldStopGenerating.current) break;

                setSlides(prev => prev.map(s =>
                    s.index === slide.index ? { ...s, audioStatus: 'generating' } : s
                ));

                try {
                    const res = await api.post(`/pptx-audio-tool/${sessionId}/slides/${slide.index}/generate-audio`, {
                        multilingualMode: multilingualMode || undefined,
                        vittsMode: vittsMode || undefined,
                        vittsDesignInstruct: vittsDesignInstruct || undefined,
                        vittsNormalize,
                    });
                    setSlides(prev => prev.map(s => s.index === slide.index ? res.data : s));
                } catch (err: any) {
                    setSlides(prev => prev.map(s =>
                        s.index === slide.index ? { ...s, audioStatus: 'error', errorMessage: 'Lỗi tạo audio' } : s
                    ));
                }

                if (isFirst) { await delay(8000); isFirst = false; } else { await delay(2500); }
            }
        } finally {
            setIsGeneratingAll(false);
            shouldStopGenerating.current = false;
        }
    };

    const stopGenerating = () => { shouldStopGenerating.current = true; };

    const deleteAudio = async (slideIndex: number) => {
        if (!sessionId || !confirm(`Xóa audio cho slide ${slideIndex + 1}?`)) return;
        try {
            if (currentlyPlaying === slideIndex) stopAudio(slideIndex);
            const res = await api.delete(`/pptx-audio-tool/${sessionId}/slides/${slideIndex}/audio`);
            setSlides(prev => prev.map(s => s.index === slideIndex ? res.data : s));
        } catch (error) {
            console.error('Error deleting audio:', error);
        }
    };

    // Audio playback
    const playAudio = (slideIndex: number, audioUrl: string) => {
        if (currentlyPlaying !== null && audioRefs.current[currentlyPlaying]) {
            audioRefs.current[currentlyPlaying].pause();
            audioRefs.current[currentlyPlaying].currentTime = 0;
        }
        if (!audioRefs.current[slideIndex]) audioRefs.current[slideIndex] = new Audio();
        const audio = audioRefs.current[slideIndex];
        audio.src = getFullAudioUrl(audioUrl);
        audio.ontimeupdate = () => {
            if (audio.duration > 0) {
                setPlaybackProgress(p => ({ ...p, [slideIndex]: (audio.currentTime / audio.duration) * 100 }));
                setCurrentTime(p => ({ ...p, [slideIndex]: audio.currentTime }));
            }
        };
        audio.onended = () => { setCurrentlyPlaying(null); setPlaybackProgress(p => ({ ...p, [slideIndex]: 0 })); setCurrentTime(p => ({ ...p, [slideIndex]: 0 })); };
        audio.onerror = () => { setCurrentlyPlaying(null); };
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

    const formatDuration = (d: number | null) => {
        if (!d || d <= 0) return '--:--';
        const m = Math.floor(d / 60);
        const s = Math.floor(d % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    // ═══════════════════════════════════════════════════════════════
    // STEP 3: DOWNLOAD
    // ═══════════════════════════════════════════════════════════════
    const downloadPptx = async () => {
        if (!sessionId) return;
        try {
            setIsDownloading(true);
            const res = await api.get(`/pptx-audio-tool/${sessionId}/download`, {
                responseType: 'blob',
            });
            const blob = new Blob([res.data], {
                type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = session?.fileName?.replace('.pptx', '_with_audio.pptx') || 'presentation_with_audio.pptx';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (error: any) {
            console.error('Error downloading:', error);
            alert(`Tải thất bại: ${error.response?.data?.message || error.message}`);
        } finally {
            setIsDownloading(false);
        }
    };

    // ═══════════════════════════════════════════════════════════════
    // STEP 5: QUESTIONS
    // ═══════════════════════════════════════════════════════════════
    const generateQuestions = async () => {
        if (!sessionId) return;
        try {
            setIsGeneratingQuestions(true);
            const res = await api.post(`/pptx-audio-tool/${sessionId}/generate-questions`, {
                level1Count: questionCounts.level1,
                level2Count: questionCounts.level2,
                level3Count: questionCounts.level3,
            });
            setQuestions(res.data.questions || []);
        } catch (error: any) {
            console.error('Error generating questions:', error);
            alert(`Lỗi tạo câu hỏi: ${error.response?.data?.message || error.message}`);
        } finally {
            setIsGeneratingQuestions(false);
        }
    };

    // ═══════════════════════════════════════════════════════════════
    // COMPUTED
    // ═══════════════════════════════════════════════════════════════
    const completedCount = slides.filter(s => s.audioStatus === 'done').length;
    const slidesWithNotes = slides.filter(s => getActiveNote(s)?.trim());
    const hasDualLanguage = slides.some(s => s.hasDual);

    // ═══════════════════════════════════════════════════════════════
    // RENDER
    // ═══════════════════════════════════════════════════════════════
    return (
        <div className="pptx-audio-tool">
            <h1 className="page-title">🎙️ PPTX Audio Tool</h1>
            <p className="page-subtitle">Upload PPTX → Tạo Audio từ Speaker Notes → Tải PPTX có Audio</p>

            {/* Stepper */}
            <div className="stepper">
                {STEPS.map((step, i) => (
                    <button
                        key={step.key}
                        className={`step-btn ${i === activeStep ? 'active' : ''} ${i < activeStep ? 'completed' : ''}`}
                        onClick={() => {
                            if (i === 0 || sessionId) setActiveStep(i);
                        }}
                        disabled={i > 0 && !sessionId}
                    >
                        <span className="step-icon">{step.icon}</span>
                        <span className="step-label">{step.label}</span>
                    </button>
                ))}
            </div>

            {/* Step Content */}
            <div className="step-content">
                {/* ════════════ STEP 1: UPLOAD ════════════ */}
                {activeStep === 0 && (
                    <div className="step-upload">
                        <div
                            className={`drop-zone ${dragOver ? 'drag-over' : ''} ${isUploading ? 'uploading' : ''}`}
                            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                            onDragLeave={() => setDragOver(false)}
                            onDrop={handleDrop}
                        >
                            {isUploading ? (
                                <>
                                    <div className="upload-spinner"></div>
                                    <p>Đang upload và phân tích file...</p>
                                    <div className="progress-bar-upload">
                                        <div className="progress-fill" style={{ width: `${uploadProgress}%` }} />
                                    </div>
                                </>
                            ) : (
                                <>
                                    <span className="drop-icon">📤</span>
                                    <h3>Kéo thả file PPTX vào đây</h3>
                                    <p>hoặc nhấn để chọn file</p>
                                    <input
                                        type="file"
                                        accept=".pptx"
                                        onChange={handleFileSelect}
                                        className="file-input-hidden"
                                        id="pptx-file-input"
                                    />
                                    <label htmlFor="pptx-file-input" className="btn-choose-file">
                                        📁 Chọn File
                                    </label>
                                </>
                            )}
                        </div>

                        {sessionId && session && (
                            <div className="upload-result">
                                <p>✅ Đang làm việc: <strong>{session.fileName}</strong> ({slides.length} slides)</p>
                                <button className="btn-next-step" onClick={() => setActiveStep(1)}>
                                    ➡️ Tiếp tục: Notes & Audio
                                </button>
                            </div>
                        )}

                        {/* Session History */}
                        {sessionHistory.length > 0 && (
                            <div className="session-history">
                                <h3 className="history-title">📁 Lịch sử file đã upload</h3>
                                <div className="history-list">
                                    {sessionHistory.map(s => (
                                        <div
                                            key={s.id}
                                            className={`history-item ${s.id === sessionId ? 'active' : ''}`}
                                            onClick={() => {
                                                navigate(`/pptx-audio-tool/${s.id}`);
                                                loadSession(s.id);
                                                setActiveStep(1);
                                            }}
                                        >
                                            <div className="history-info">
                                                <span className="history-name">{s.fileName}</span>
                                                <span className="history-meta">
                                                    {s.totalSlides} slides · {s.audioCount} audio · {new Date(s.createdAt).toLocaleDateString('vi-VN')}
                                                </span>
                                            </div>
                                            <button
                                                className="history-delete"
                                                disabled={isDeletingSession === s.id}
                                                onClick={async (e) => {
                                                    e.stopPropagation();
                                                    if (!confirm(`Xóa "${s.fileName}" và toàn bộ dữ liệu?`)) return;
                                                    try {
                                                        setIsDeletingSession(s.id);
                                                        await api.delete(`/pptx-audio-tool/${s.id}`);
                                                        setSessionHistory(prev => prev.filter(h => h.id !== s.id));
                                                        if (sessionId === s.id) {
                                                            setSessionId(null);
                                                            setSession(null);
                                                            setSlides([]);
                                                            setQuestions([]);
                                                            navigate('/pptx-audio-tool');
                                                        }
                                                    } catch (err) {
                                                        console.error('Delete failed:', err);
                                                    } finally {
                                                        setIsDeletingSession(null);
                                                    }
                                                }}
                                            >
                                                {isDeletingSession === s.id ? '⏳' : '🗑️'}
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* ════════════ STEP 2: NOTES & AUDIO ════════════ */}
                {activeStep === 1 && sessionId && (
                    <div className="step-audio">
                        {/* Header */}
                        <div className="audio-header">
                            <div className="header-left">
                                <h2>🎙️ Notes & Audio</h2>
                                <p className="audio-stats">
                                    📊 <strong>{completedCount}</strong> / {slidesWithNotes.length} slides có audio
                                    {hasDualLanguage && <> · 🌐 Song ngữ</>}
                                </p>
                            </div>
                            <div className="header-actions">
                                {/* Language Toggle */}
                                {hasDualLanguage && (
                                    <div className="language-toggle">
                                        <button
                                            className={`lang-btn ${language === 'vi' ? 'active' : ''}`}
                                            onClick={() => toggleLanguage('vi')}
                                        >
                                            🇻🇳 VN
                                        </button>
                                        <button
                                            className={`lang-btn ${language === 'en' ? 'active' : ''}`}
                                            onClick={() => toggleLanguage('en')}
                                        >
                                            🇬🇧 EN
                                        </button>
                                    </div>
                                )}

                                {/* Generate All */}
                                <button
                                    className="btn-generate-all"
                                    onClick={generateAllAudios}
                                    disabled={isGeneratingAll || slidesWithNotes.length === 0}
                                >
                                    {isGeneratingAll ? (
                                        <><span className="spinner"></span> Đang tạo audio...</>
                                    ) : (
                                        '🎙️ Tạo Audio Tất Cả'
                                    )}
                                </button>
                                {isGeneratingAll && (
                                    <button className="btn-stop" onClick={stopGenerating}>⏹️ Dừng</button>
                                )}
                            </div>
                        </div>

                        {/* TTS Config */}
                        <TTSSelector onChange={(config) => {
                            if (config.multilingualMode !== undefined) setMultilingualMode(config.multilingualMode || '');
                            if (config.vittsMode !== undefined) setVittsMode(config.vittsMode || '');
                            if (config.vittsDesignInstruct !== undefined) setVittsDesignInstruct(config.vittsDesignInstruct || '');
                            if (config.vittsNormalize !== undefined) setVittsNormalize(config.vittsNormalize);
                        }} />

                        {/* Slide Cards */}
                        <div className="slide-cards">
                            {slides.map((slide) => {
                                const activeNote = getActiveNote(slide);
                                const hasNote = activeNote?.trim();
                                const hasAudio = slide.audioStatus === 'done' && slide.audioUrl;
                                const isEditing = editingSlide === slide.index;
                                const isGenerating = generatingSlides.has(slide.index) || slide.audioStatus === 'generating';

                                if (!hasNote) return null; // Skip slides without notes

                                return (
                                    <div key={slide.index} className={`slide-card ${slide.audioStatus}`}>
                                        {/* Card Header */}
                                        <div className="card-header">
                                            <span className="slide-badge">{slide.index + 1}</span>
                                            <h3 className="slide-title">{slide.title}</h3>
                                            {slide.hasDual && <span className="dual-badge">🌐</span>}
                                        </div>

                                        {/* Card Body: Note */}
                                        <div className="card-body">
                                            <div className="card-note-col">
                                                <div className="col-label">
                                                    📝 Speaker Note ({language === 'vi' ? 'Tiếng Việt' : 'English'})
                                                </div>
                                                {isEditing ? (
                                                    <div className="edit-mode">
                                                        <textarea
                                                            value={editedNote}
                                                            onChange={(e) => setEditedNote(e.target.value)}
                                                            rows={6}
                                                            autoFocus
                                                        />
                                                        <div className="edit-buttons">
                                                            <button className="btn-save" onClick={() => saveEdit(slide.index)}>💾 Lưu</button>
                                                            <button className="btn-cancel" onClick={cancelEdit}>Hủy</button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="note-content">
                                                        <p>{activeNote}</p>
                                                        <button
                                                            className="btn-edit-inline"
                                                            onClick={() => startEdit(slide.index, activeNote)}
                                                            title="Chỉnh sửa"
                                                        >
                                                            ✏️
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Card Footer: Audio Controls */}
                                        <div className="card-footer">
                                            <div className="audio-actions">
                                                <button
                                                    className="btn-generate"
                                                    onClick={() => generateSingleAudio(slide.index)}
                                                    disabled={isGenerating || !hasNote}
                                                >
                                                    {isGenerating ? (
                                                        <><span className="spinner-small"></span> Đang tạo</>
                                                    ) : hasAudio ? '🔄 Tạo lại' : '🎙️ Tạo Audio'}
                                                </button>
                                            </div>

                                            {/* Audio Playback */}
                                            {hasAudio && (
                                                <div className="playback-section">
                                                    <div className="progress-bar-container">
                                                        <div
                                                            className="progress-bar"
                                                            style={{ width: `${playbackProgress[slide.index] || 0}%` }}
                                                        />
                                                    </div>
                                                    <div className="playback-controls">
                                                        {currentlyPlaying === slide.index ? (
                                                            <button className="btn-stop-play" onClick={() => stopAudio(slide.index)}>⏹️</button>
                                                        ) : (
                                                            <button className="btn-play" onClick={() => playAudio(slide.index, slide.audioUrl!)}>▶️</button>
                                                        )}
                                                        <span className="time-display">
                                                            {formatDuration(currentTime[slide.index] || 0)} / {formatDuration(slide.audioDuration)}
                                                        </span>
                                                        <a
                                                            href={getFullAudioUrl(slide.audioUrl)}
                                                            download={`slide_${slide.index + 1}.wav`}
                                                            className="btn-download"
                                                            title="Tải xuống"
                                                        >📥</a>
                                                        <button className="btn-delete-small" onClick={() => deleteAudio(slide.index)} title="Xóa audio">🗑️</button>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Error */}
                                            {slide.audioStatus === 'error' && slide.errorMessage && (
                                                <div className="error-message">⚠️ {slide.errorMessage}</div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* No notes warning */}
                        {slidesWithNotes.length === 0 && (
                            <div className="empty-state">
                                <span className="empty-icon">📝</span>
                                <h3>Không có Speaker Notes</h3>
                                <p>File PPTX này không có speaker notes. Cần có notes để tạo audio.</p>
                            </div>
                        )}
                    </div>
                )}

                {/* ════════════ STEP 3: DOWNLOAD ════════════ */}
                {activeStep === 2 && sessionId && (
                    <div className="step-download">
                        <h2>📥 Download PPTX kèm Audio</h2>

                        <div className="download-summary">
                            <table className="summary-table">
                                <thead>
                                    <tr>
                                        <th>Slide</th>
                                        <th>Title</th>
                                        <th>Audio</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {slides.map(s => (
                                        <tr key={s.index}>
                                            <td>{s.index + 1}</td>
                                            <td>{s.title}</td>
                                            <td>
                                                {s.audioStatus === 'done' ? (
                                                    <span className="status-done">✅ Có audio ({formatDuration(s.audioDuration)})</span>
                                                ) : getActiveNote(s)?.trim() ? (
                                                    <span className="status-pending">⏳ Chưa tạo</span>
                                                ) : (
                                                    <span className="status-skip">➖ Không có note</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="download-actions">
                            <button
                                className="btn-download-pptx"
                                onClick={downloadPptx}
                                disabled={isDownloading || completedCount === 0}
                            >
                                {isDownloading ? (
                                    <><span className="spinner"></span> Đang tạo file...</>
                                ) : (
                                    `📥 Tải PPTX kèm Audio (${completedCount} slides)`
                                )}
                            </button>
                        </div>

                        {completedCount === 0 && (
                            <div className="empty-state">
                                <p>⚠️ Cần tạo audio trước khi download.</p>
                                <button className="btn-go-audio" onClick={() => setActiveStep(1)}>
                                    ← Quay lại tạo Audio
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* ════════════ STEP 4: CONTENT ════════════ */}
                {activeStep === 3 && sessionId && (
                    <div className="step-content-view">
                        <h2>📋 Nội dung Slides</h2>
                        <div className="content-cards">
                            {slides.map(slide => (
                                <div key={slide.index} className="content-card">
                                    <div className="content-card-header">
                                        <span className="slide-badge">{slide.index + 1}</span>
                                        <h3>{slide.title}</h3>
                                    </div>
                                    <div className="content-card-body">
                                        {slide.content && slide.content.length > 0 ? (
                                            <ul className="content-bullets">
                                                {slide.content.map((item, i) => (
                                                    <li key={i}>{item}</li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <p className="empty-content">Không có nội dung text</p>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* ════════════ STEP 5: QUESTIONS ════════════ */}
                {activeStep === 4 && sessionId && (
                    <div className="step-questions">
                        <div className="step-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                            <h2>❓ Tạo Câu Hỏi Trắc Nghiệm</h2>
                            {questions.length > 0 && (
                                <button
                                    className="btn-secondary"
                                    onClick={async () => {
                                        try {
                                            const response = await api.get(`/pptx-audio-tool/${sessionId}/questions/export/excel`, {
                                                responseType: 'blob',
                                            });
                                            const url = window.URL.createObjectURL(new Blob([response.data]));
                                            const link = document.createElement('a');
                                            link.href = url;
                                            link.setAttribute('download', `${session?.fileName?.replace('.pptx', '') || 'pptx'}_questions.xlsx`);
                                            document.body.appendChild(link);
                                            link.click();
                                            link.remove();
                                            window.URL.revokeObjectURL(url);
                                        } catch (err) {
                                            alert('Không thể xuất Excel');
                                        }
                                    }}
                                >
                                    📊 Xuất Excel
                                </button>
                            )}
                        </div>

                        <ModelSelector taskType="QUESTIONS" compact />

                        <div className="question-config">
                            <div className="level-inputs" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
                                <div className="level-input">
                                    <label>
                                        <span style={{ background: 'rgba(34,197,94,0.2)', color: '#22c55e', padding: '2px 8px', borderRadius: 4, fontSize: 12, marginRight: 6 }}>Biết</span>
                                        Mức 1
                                    </label>
                                    <input type="number" min="0" max="50" value={questionCounts.level1}
                                        onChange={(e) => setQuestionCounts(prev => ({ ...prev, level1: parseInt(e.target.value) || 0 }))}
                                        style={{ width: 60, marginLeft: 8 }} />
                                </div>
                                <div className="level-input">
                                    <label>
                                        <span style={{ background: 'rgba(59,130,246,0.2)', color: '#3b82f6', padding: '2px 8px', borderRadius: 4, fontSize: 12, marginRight: 6 }}>Hiểu</span>
                                        Mức 2
                                    </label>
                                    <input type="number" min="0" max="50" value={questionCounts.level2}
                                        onChange={(e) => setQuestionCounts(prev => ({ ...prev, level2: parseInt(e.target.value) || 0 }))}
                                        style={{ width: 60, marginLeft: 8 }} />
                                </div>
                                <div className="level-input">
                                    <label>
                                        <span style={{ background: 'rgba(249,115,22,0.2)', color: '#f97316', padding: '2px 8px', borderRadius: 4, fontSize: 12, marginRight: 6 }}>Vận dụng</span>
                                        Mức 3
                                    </label>
                                    <input type="number" min="0" max="50" value={questionCounts.level3}
                                        onChange={(e) => setQuestionCounts(prev => ({ ...prev, level3: parseInt(e.target.value) || 0 }))}
                                        style={{ width: 60, marginLeft: 8 }} />
                                </div>
                            </div>
                            <button className="btn-generate-questions" onClick={generateQuestions}
                                disabled={isGeneratingQuestions || (questionCounts.level1 + questionCounts.level2 + questionCounts.level3 === 0)}>
                                {isGeneratingQuestions ? (<><span className="spinner"></span> Đang tạo câu hỏi...</>) : questions.length > 0 ? ('🔄 Tạo Lại Câu Hỏi') : ('✨ Tạo Câu Hỏi')}
                            </button>
                        </div>

                        {isGeneratingQuestions && (
                            <div style={{ textAlign: 'center', padding: '24px 0' }}>
                                <div className="loading-spinner"></div>
                                <p>Đang tạo câu hỏi ôn tập...</p>
                                <p style={{ fontSize: 12, color: '#64748b' }}>Tổng số: {questionCounts.level1 + questionCounts.level2 + questionCounts.level3} câu</p>
                            </div>
                        )}

                        {!isGeneratingQuestions && questions.length > 0 && (
                            <div>
                                <p style={{ marginBottom: 12 }}>
                                    📊 Tổng: <strong>{questions.length}</strong> câu hỏi
                                    (L1: {questions.filter(q => q.level === 1).length},
                                    L2: {questions.filter(q => q.level === 2).length},
                                    L3: {questions.filter(q => q.level === 3).length})
                                </p>
                                <div style={{ overflowX: 'auto' }}>
                                    <table className="questions-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                        <thead>
                                            <tr style={{ background: 'rgba(30,41,59,0.8)', borderBottom: '2px solid rgba(148,163,184,0.2)' }}>
                                                <th style={{ padding: '10px 8px', textAlign: 'left', width: 50 }}>STT</th>
                                                <th style={{ padding: '10px 8px', textAlign: 'left', width: 60 }}>Mức</th>
                                                <th style={{ padding: '10px 8px', textAlign: 'left', minWidth: 200 }}>Câu hỏi</th>
                                                <th style={{ padding: '10px 8px', textAlign: 'left', minWidth: 120 }}>A (Đúng)</th>
                                                <th style={{ padding: '10px 8px', textAlign: 'left', minWidth: 120 }}>B</th>
                                                <th style={{ padding: '10px 8px', textAlign: 'left', minWidth: 120 }}>C</th>
                                                <th style={{ padding: '10px 8px', textAlign: 'left', minWidth: 120 }}>D</th>
                                                <th style={{ padding: '10px 8px', textAlign: 'left', minWidth: 150 }}>Giải thích</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {questions.map((q, i) => (
                                                <tr key={i} style={{ borderBottom: '1px solid rgba(148,163,184,0.1)' }}>
                                                    <td style={{ padding: '8px', color: '#94a3b8' }}>{i + 1}</td>
                                                    <td style={{ padding: '8px' }}>
                                                        <span style={{
                                                            padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                                                            background: q.level === 1 ? 'rgba(34,197,94,0.15)' : q.level === 2 ? 'rgba(59,130,246,0.15)' : 'rgba(249,115,22,0.15)',
                                                            color: q.level === 1 ? '#22c55e' : q.level === 2 ? '#3b82f6' : '#f97316',
                                                        }}>
                                                            {q.level === 1 ? 'Biết' : q.level === 2 ? 'Hiểu' : 'VD'}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '8px', color: '#e2e8f0' }}>{q.question}</td>
                                                    <td style={{ padding: '8px', color: '#22c55e', fontWeight: 500 }}>{q.correctAnswer}</td>
                                                    <td style={{ padding: '8px', color: '#94a3b8' }}>{q.optionB}</td>
                                                    <td style={{ padding: '8px', color: '#94a3b8' }}>{q.optionC}</td>
                                                    <td style={{ padding: '8px', color: '#94a3b8' }}>{q.optionD}</td>
                                                    <td style={{ padding: '8px', color: '#64748b', fontSize: 12 }}>{q.explanation || '-'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* No session warning */}
                {activeStep > 0 && !sessionId && (
                    <div className="empty-state">
                        <span className="empty-icon">📤</span>
                        <h3>Chưa upload file</h3>
                        <p>Vui lòng upload file PPTX trước.</p>
                        <button className="btn-go-upload" onClick={() => setActiveStep(0)}>
                            ← Quay lại Upload
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
