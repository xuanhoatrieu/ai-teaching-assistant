import { useState, useEffect, useRef } from 'react';
import { useLessonEditor } from '../../contexts/LessonEditorContext';
import { api, API_BASE_URL } from '../../lib/api';
import { useJobPolling } from '../../hooks/useJobPolling';
import { TTSSelector } from '../TTSSelector';
import { ModelSelector } from '../ModelSelector';
import '../ModelSelector.css';
import './Step4GenerateAudio.css';

// Helper to get full audio URL from backend with optional cache busting
const getFullAudioUrl = (audioUrl: string | null, cacheBust = false): string => {
    if (!audioUrl) return '';
    let url = audioUrl;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `${API_BASE_URL}${audioUrl}`;
    }
    return cacheBust ? `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}` : url;
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
    const [isOptimizingNotes, setIsOptimizingNotes] = useState(false);
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
    const [vittsNormalize, setVittsNormalize] = useState<boolean>(false);
    const [recordingSlide, setRecordingSlide] = useState<number | null>(null);
    const audioRefs = useRef<Record<number, HTMLAudioElement>>({});
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);

    // Job IDs for cancellation
    const [notesJobId, setNotesJobId] = useState<string | null>(null);
    const [optimizeJobId, setOptimizeJobId] = useState<string | null>(null);
    const [generateAllJobId, setGenerateAllJobId] = useState<string | null>(null);

    // Audio Range & Filter settings
    const [audioScope, setAudioScope] = useState<'all' | 'range'>('all');
    const [rangeFrom, setRangeFrom] = useState<number>(1);
    const [rangeTo, setRangeTo] = useState<number>(1);
    const [onlyMissingOrError, setOnlyMissingOrError] = useState<boolean>(false);

    // Export & Import TXT states
    const [showExportMenu, setShowExportMenu] = useState<boolean>(false);
    const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);
    const [importTarget, setImportTarget] = useState<'optimized' | 'raw' | 'both'>('optimized');
    const [parsedImportNotes, setParsedImportNotes] = useState<Array<{ slideIndex: number; speakerNote: string }>>([]);
    const [importFileName, setImportFileName] = useState<string>('');
    const [isImporting, setIsImporting] = useState<boolean>(false);
    const [importMessage, setImportMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const exportMenuRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (lessonData?.id) {
            refreshLessonData();
            loadData();
        }
    }, [lessonData?.id]);

    // Close export dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
                setShowExportMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

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
            await checkActiveJobs();
        } catch (error) {
            console.error('Error loading data:', error);
        } finally {
            setIsLoading(false);
        }
    };

    // ═══════════════════════════════════════════════════════════════
    // SPEAKER NOTES GENERATION (ASYNC JOB)
    // ═══════════════════════════════════════════════════════════════
    const reloadAfterJob = async () => {
        const slidesRes = await api.get(`/lessons/${lessonId}/slides`);
        if (slidesRes.data) setSlideContents(slidesRes.data);
        const audioRes = await api.get(`/lessons/${lessonId}/slide-audios`);
        if (audioRes.data?.length > 0) setSlideAudios(normalizeSlideAudios(audioRes.data));
    };

    // Refresh only the audio status while the generate-all job is running so each
    // slide card flips GENERATING (yellow) → COMPLETED (green) in real time.
    const reloadAudiosOnly = async () => {
        try {
            const audioRes = await api.get(`/lessons/${lessonId}/slide-audios`);
            if (audioRes.data?.length > 0) setSlideAudios(normalizeSlideAudios(audioRes.data));
        } catch (err) {
            console.error('Error refreshing slide audios:', err);
        }
    };

    const notesJob = useJobPolling({
        onComplete: async () => {
            setIsGeneratingNotes(false);
            setNotesJobId(null);
            await reloadAfterJob();
        },
        onCancelled: async () => {
            setIsGeneratingNotes(false);
            setNotesJobId(null);
            await reloadAfterJob();
        },
        onError: (msg) => {
            setIsGeneratingNotes(false);
            setNotesJobId(null);
            alert(`Lỗi khi tạo lời giảng: ${msg}`);
        },
    });

    const optimizeJob = useJobPolling({
        onComplete: async () => {
            setIsOptimizingNotes(false);
            setOptimizeJobId(null);
            await reloadAfterJob();
        },
        onCancelled: async () => {
            setIsOptimizingNotes(false);
            setOptimizeJobId(null);
            await reloadAfterJob();
        },
        onError: (msg) => {
            setIsOptimizingNotes(false);
            setOptimizeJobId(null);
            alert(`Lỗi khi tối ưu lời giảng: ${msg}`);
        },
    });

    const generateAllJob = useJobPolling({
        onComplete: async () => {
            setIsGeneratingAll(false);
            setGenerateAllJobId(null);
            await reloadAfterJob();
        },
        onCancelled: async () => {
            setIsGeneratingAll(false);
            setGenerateAllJobId(null);
            await reloadAfterJob();
        },
        onError: (msg) => {
            setIsGeneratingAll(false);
            setGenerateAllJobId(null);
            alert(`Lỗi khi tạo audio: ${msg}`);
        },
    });

    // While the generate-all job is running, refresh audio statuses on each
    // progress tick so cards update color and become playable one by one.
    useEffect(() => {
        if (generateAllJob.isRunning) {
            reloadAudiosOnly();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [generateAllJob.jobStatus?.progress, generateAllJob.isRunning]);

    const checkActiveJobs = async () => {
        try {
            // Check speaker notes job
            const resNotes = await api.get(`/generation-jobs/active?lessonId=${lessonId}&type=speaker-notes`);
            if (resNotes.data?.id) {
                setNotesJobId(resNotes.data.id);
                setIsGeneratingNotes(true);
                notesJob.startPolling(resNotes.data.id);
            }

            // Check optimize notes job
            const resOpt = await api.get(`/generation-jobs/active?lessonId=${lessonId}&type=optimize-notes`);
            if (resOpt.data?.id) {
                setOptimizeJobId(resOpt.data.id);
                setIsOptimizingNotes(true);
                optimizeJob.startPolling(resOpt.data.id);
            }

            // Check generate all job
            const resAll = await api.get(`/generation-jobs/active?lessonId=${lessonId}&type=slide-audio-generate-all`);
            if (resAll.data?.id) {
                setGenerateAllJobId(resAll.data.id);
                setIsGeneratingAll(true);
                generateAllJob.startPolling(resAll.data.id);
            }
        } catch (err) {
            console.error('Error checking active jobs:', err);
        }
    };

    const cancelJob = async (jobId: string | null | undefined, setRunning: (val: boolean) => void) => {
        if (!jobId) return;
        try {
            await api.post(`/generation-jobs/${jobId}/cancel`);
            setRunning(false);
            await reloadAfterJob();
        } catch (error) {
            console.error('Error cancelling job:', error);
            setRunning(false);
            await reloadAfterJob();
        }
    };

    const generateSpeakerNotes = async () => {
        try {
            setIsGeneratingNotes(true);
            const response = await api.post(
                `/lessons/${lessonId}/slide-audios/generate-speaker-notes`,
            );
            if (response.data?.jobId) {
                setNotesJobId(response.data.jobId);
                notesJob.startPolling(response.data.jobId);
            }
        } catch (error: any) {
            console.error('Error starting speaker notes generation:', error);
            setIsGeneratingNotes(false);
            alert('Lỗi khi bắt đầu tạo lời giảng. Vui lòng thử lại.');
        }
    };

    const optimizeSpeakerNotes = async () => {
        try {
            setIsOptimizingNotes(true);
            const response = await api.post(
                `/lessons/${lessonId}/slide-audios/optimize-speaker-notes`,
            );
            if (response.data?.jobId) {
                setOptimizeJobId(response.data.jobId);
                optimizeJob.startPolling(response.data.jobId);
            }
        } catch (error: any) {
            console.error('Error starting speaker notes optimization:', error);
            setIsOptimizingNotes(false);
            alert('Lỗi khi bắt đầu tối ưu lời giảng. Vui lòng thử lại.');
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
                vittsMode: vittsMode || undefined,
                vittsDesignInstruct: vittsDesignInstruct || undefined,
                vittsNormalize,
            });
            const normalizedData = { ...response.data, status: normalizeStatus(response.data.status) };
            setSlideAudios(prev => prev.map(sa =>
                sa.slideIndex === slideIndex ? normalizedData : sa
            ));
            if (response.data.audioUrl) {
                playAudio(slideIndex, response.data.audioUrl);
            }
        } catch (error: any) {
            console.error('Error generating audio:', error);
            let message = 'Lỗi không xác định';
            if (error && typeof error === 'object') {
                if (error.response?.data?.message) {
                    message = error.response.data.message;
                } else if (error.message) {
                    message = error.message;
                }
            }
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

    const generateAllAudios = async () => {
        try {
            setIsGeneratingAll(true);
            const payload: any = {
                multilingualMode: multilingualMode || undefined,
                vittsMode: vittsMode || undefined,
                vittsDesignInstruct: vittsDesignInstruct || undefined,
                vittsNormalize,
                onlyMissingOrError,
            };

            if (audioScope === 'range') {
                payload.fromSlide = Number(rangeFrom);
                payload.toSlide = Number(rangeTo);
            }

            const response = await api.post(`/lessons/${lessonId}/slide-audios/generate-all`, payload);
            if (response.data?.jobId) {
                setGenerateAllJobId(response.data.jobId);
                generateAllJob.startPolling(response.data.jobId);
            }
        } catch (error: any) {
            console.error('Error starting audio generation for all slides:', error);
            setIsGeneratingAll(false);
            alert('Lỗi khi bắt đầu tạo audio. Vui lòng thử lại.');
        }
    };

    // ═══════════════════════════════════════════════════════════════
    // EXPORT & IMPORT TXT HELPERS
    // ═══════════════════════════════════════════════════════════════
    const handleExportTXT = (source: 'raw' | 'optimized') => {
        const lines: string[] = [];
        slides.forEach(slide => {
            const audio = slideAudios.find(sa => sa.slideIndex === slide.slideIndex);
            const note = source === 'raw' ? (slide.speakerNote || '') : (audio?.speakerNote || '');
            lines.push(`=== SLIDE ${slide.slideIndex}: ${slide.title || `Slide ${slide.slideIndex}`} ===`);
            lines.push(note.trim() ? note.trim() : '');
            lines.push('');
        });

        const textContent = lines.join('\n');
        const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const cleanTitle = (lessonData?.title || 'BaiHoc').replace(/[^a-zA-Z0-9_\-\u00C0-\u024F\u1EA0-\u1EF9]/g, '_');
        link.download = `${cleanTitle}_LoiGiang_${source === 'raw' ? 'Buoc1' : 'ToiUu'}.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const parseSpeakerNotesFromTxt = (text: string): Array<{ slideIndex: number; speakerNote: string }> => {
        const lines = text.split(/\r?\n/);
        const result: Array<{ slideIndex: number; speakerNote: string }> = [];
        let currentSlideIndex: number | null = null;
        let currentLines: string[] = [];

        const headerRegex = /^(?:={3,}\s*|---\s*|\[\s*)?slide\s*(\d+)[\s:\-\]|=]*(.*)$/i;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            const match = trimmed.match(headerRegex);

            const isDelimiter = match && (
                trimmed.startsWith('===') ||
                trimmed.startsWith('---') ||
                trimmed.startsWith('[') ||
                trimmed.endsWith('===') ||
                trimmed.endsWith('---') ||
                trimmed.endsWith(']') ||
                /^\s*slide\s*\d+\s*[:\-]?\s*$/i.test(trimmed)
            );

            if (isDelimiter && match) {
                if (currentSlideIndex !== null) {
                    result.push({
                        slideIndex: currentSlideIndex,
                        speakerNote: currentLines.join('\n').trim(),
                    });
                    currentLines = [];
                }
                currentSlideIndex = parseInt(match[1], 10);
            } else if (currentSlideIndex !== null) {
                currentLines.push(line);
            }
        }

        if (currentSlideIndex !== null) {
            result.push({
                slideIndex: currentSlideIndex,
                speakerNote: currentLines.join('\n').trim(),
            });
        }

        return result;
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setImportFileName(file.name);
        setImportMessage(null);
        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target?.result as string;
            if (content) {
                const parsed = parseSpeakerNotesFromTxt(content);
                setParsedImportNotes(parsed);
                if (parsed.length === 0) {
                    setImportMessage({
                        type: 'error',
                        text: 'Không nhận diện được slide nào theo định dạng hợp lệ. Định dạng mẫu: "=== SLIDE 1: Tiêu đề ===" theo sau là lời giảng.',
                    });
                } else {
                    setImportMessage({
                        type: 'success',
                        text: `Đã nhận diện được ${parsed.length} slide từ file!`,
                    });
                }
            }
        };
        reader.readAsText(file, 'utf-8');
    };

    const handleConfirmImport = async () => {
        if (parsedImportNotes.length === 0) return;
        try {
            setIsImporting(true);
            const response = await api.post(`/lessons/${lessonId}/slide-audios/import-speaker-notes`, {
                notes: parsedImportNotes,
                target: importTarget,
            });

            if (response.data?.success) {
                if (response.data.slides) setSlideContents(response.data.slides);
                if (response.data.slideAudios) setSlideAudios(normalizeSlideAudios(response.data.slideAudios));
                alert(`✅ Đã nhập thành công lời giảng cho ${response.data.importedCount} slide!`);
                setIsImportModalOpen(false);
                setParsedImportNotes([]);
                setImportFileName('');
                setImportMessage(null);
            }
        } catch (err: any) {
            console.error('Error importing speaker notes:', err);
            alert('Lỗi khi nhập lời giảng: ' + (err.response?.data?.message || err.message));
        } finally {
            setIsImporting(false);
        }
    };

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
        audio.src = getFullAudioUrl(audioUrl, true);
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
        if (!confirm(`Xóa audio cho slide ${slideIndex}?`)) return;
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
                    <div className="action-btn-group">
                        <button
                            className="btn-generate-notes"
                            onClick={generateSpeakerNotes}
                            disabled={isGeneratingNotes}
                        >
                            {isGeneratingNotes ? (
                                <><span className="spinner"></span> {notesJob.jobStatus?.message || 'Đang tạo lời giảng...'}</>
                            ) : hasSpeakerNotes ? (
                                '🔄 Tạo lại Lời Giảng'
                            ) : (
                                '✨ Tạo Lời Giảng'
                            )}
                        </button>
                        {isGeneratingNotes && (
                            <button
                                className="btn-stop"
                                onClick={() => cancelJob(notesJobId || notesJob.jobStatus?.id, setIsGeneratingNotes)}
                                title="Dừng tạo lời giảng"
                            >
                                ⏹️ Dừng
                            </button>
                        )}
                    </div>

                    {/* Optimize & QA Speaker Notes Button */}
                    <div className="action-btn-group">
                        <button
                            className="btn-optimize-notes"
                            onClick={optimizeSpeakerNotes}
                            disabled={isOptimizingNotes || !hasSpeakerNotes}
                            title={!hasSpeakerNotes ? 'Tạo lời giảng trước' : 'Kiểm duyệt + Rửa ngôn ngữ + Tối ưu TTS'}
                        >
                            {isOptimizingNotes ? (
                                <><span className="spinner"></span> {optimizeJob.jobStatus?.message || 'Đang tối ưu...'}</>
                            ) : (
                                '✅ Tối Ưu & Kiểm Duyệt'
                            )}
                        </button>
                        {isOptimizingNotes && (
                            <button
                                className="btn-stop"
                                onClick={() => cancelJob(optimizeJobId || optimizeJob.jobStatus?.id, setIsOptimizingNotes)}
                                title="Dừng tối ưu lời giảng"
                            >
                                ⏹️ Dừng
                            </button>
                        )}
                    </div>

                    {/* Export Dropdown */}
                    <div className="export-dropdown-wrapper" ref={exportMenuRef}>
                        <button
                            className="btn-export-notes"
                            onClick={() => setShowExportMenu(prev => !prev)}
                            disabled={!hasSpeakerNotes}
                            title={!hasSpeakerNotes ? 'Cần có lời giảng trước khi xuất' : 'Xuất lời giảng ra file TXT'}
                        >
                            📤 Xuất Lời Giảng ▾
                        </button>
                        {showExportMenu && (
                            <div className="export-menu-dropdown">
                                <button
                                    className="export-menu-item"
                                    onClick={() => { handleExportTXT('raw'); setShowExportMenu(false); }}
                                >
                                    📄 Lời Giảng Bước 1 (Gốc)
                                </button>
                                <button
                                    className="export-menu-item"
                                    onClick={() => { handleExportTXT('optimized'); setShowExportMenu(false); }}
                                >
                                    ✅ Lời Giảng Tối Ưu (TTS)
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Import TXT Button */}
                    <button
                        className="btn-import-notes"
                        onClick={() => {
                            setIsImportModalOpen(true);
                            setImportMessage(null);
                        }}
                        title="Nhập lời giảng từ file TXT"
                    >
                        📥 Nhập Lời Giảng
                    </button>
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
                if (config.vittsMode !== undefined) {
                    setVittsMode(config.vittsMode || '');
                }
                if (config.vittsDesignInstruct !== undefined) {
                    setVittsDesignInstruct(config.vittsDesignInstruct || '');
                }
                if (config.vittsNormalize !== undefined) {
                    setVittsNormalize(config.vittsNormalize);
                }
            }} />

            {/* Audio Generation Controls Panel */}
            <div className="audio-generation-panel">
                <div className="panel-header-row">
                    <div className="panel-title">
                        <span className="panel-badge">🎙️ TẠO AUDIO BÀI GIẢNG</span>
                        <span className="panel-desc">Tùy chọn phạm vi tạo audio và sinh giọng đọc hàng loạt</span>
                    </div>

                    <div className="audio-run-actions">
                        <button
                            className="btn-generate-all"
                            onClick={generateAllAudios}
                            disabled={isGeneratingAll || !hasSpeakerNotes}
                            title={!hasSpeakerNotes ? 'Cần có lời giảng trước khi tạo audio' : ''}
                        >
                            {isGeneratingAll ? (
                                <>
                                    <span className="spinner"></span>{' '}
                                    {generateAllJob.jobStatus?.progress !== undefined
                                        ? `Đang tạo audio (${generateAllJob.jobStatus.progress}%)`
                                        : 'Đang tạo audio...'}
                                </>
                            ) : audioScope === 'range' ? (
                                `🎙️ Tạo Audio (Slide ${rangeFrom} - ${rangeTo})`
                            ) : (
                                '🎙️ Tạo Audio Tất Cả'
                            )}
                        </button>
                        {isGeneratingAll && (
                            <button
                                className="btn-stop"
                                onClick={() => cancelJob(generateAllJobId || generateAllJob.jobStatus?.id, setIsGeneratingAll)}
                                title="Dừng tạo audio"
                            >
                                ⏹️ Dừng
                            </button>
                        )}
                    </div>
                </div>

                <div className="panel-options-row">
                    {/* Range / Scope Selector */}
                    <div className="scope-selection-group">
                        <label className={`scope-option ${audioScope === 'all' ? 'active' : ''}`}>
                            <input
                                type="radio"
                                name="audioScope"
                                value="all"
                                checked={audioScope === 'all'}
                                onChange={() => setAudioScope('all')}
                                disabled={isGeneratingAll}
                            />
                            <span>Tất cả slides ({slides.length})</span>
                        </label>

                        <label className={`scope-option ${audioScope === 'range' ? 'active' : ''}`}>
                            <input
                                type="radio"
                                name="audioScope"
                                value="range"
                                checked={audioScope === 'range'}
                                onChange={() => setAudioScope('range')}
                                disabled={isGeneratingAll}
                            />
                            <span>Theo khoảng slide:</span>
                            <span className="range-input-wrapper">
                                Từ
                                <input
                                    type="number"
                                    className="range-input"
                                    min={1}
                                    max={slides.length || 1}
                                    value={rangeFrom}
                                    onChange={(e) => setRangeFrom(Math.max(1, parseInt(e.target.value) || 1))}
                                    disabled={audioScope !== 'range' || isGeneratingAll}
                                />
                                đến
                                <input
                                    type="number"
                                    className="range-input"
                                    min={1}
                                    max={slides.length || 1}
                                    value={rangeTo}
                                    onChange={(e) => setRangeTo(Math.max(1, parseInt(e.target.value) || 1))}
                                    disabled={audioScope !== 'range' || isGeneratingAll}
                                />
                            </span>
                        </label>
                    </div>

                    {/* Quick Filter Checkbox */}
                    <label className="quick-filter-checkbox" title="Chỉ tạo lại audio cho những slide chưa có file audio hoặc đang bị lỗi">
                        <input
                            type="checkbox"
                            checked={onlyMissingOrError}
                            onChange={(e) => setOnlyMissingOrError(e.target.checked)}
                            disabled={isGeneratingAll}
                        />
                        <span>⚡ Chỉ tạo slide chưa có audio hoặc bị lỗi</span>
                    </label>
                </div>
            </div>



            {/* Slide Cards */}
            <div className="slide-cards">
                {slides.map((slide) => {
                    const audio = slideAudios.find(sa => sa.slideIndex === slide.slideIndex);
                    const contentItems = parseContent(slide.content);
                    const rawNote = slide.speakerNote || '';  // From Button 1 (Slide.speakerNote)
                    const optimizedNote = audio?.speakerNote || '';  // From Button 2 (SlideAudio.speakerNote)
                    const activeNote = optimizedNote || rawNote;  // Best available note for audio generation
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

                            {/* Card Body: 3-Column Layout */}
                            <div className="card-body card-body-3col">
                                {/* Col 1: Slide Content */}
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

                                {/* Col 2: Raw Speaker Note (Button 1) */}
                                <div className="card-note-col card-note-raw">
                                    <div className="col-label">✨ Lời Giảng (Bước 1)</div>
                                    {rawNote ? (
                                        <div className="note-content">
                                            <p>{rawNote}</p>
                                        </div>
                                    ) : (
                                        <p className="empty-note">Chưa có. Nhấn "✨ Tạo Lời Giảng".</p>
                                    )}
                                </div>

                                {/* Col 3: Optimized Speaker Note (Button 2) */}
                                <div className="card-note-col card-note-optimized">
                                    <div className="col-label">✅ Lời Giảng (Tối Ưu)</div>
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
                                    ) : optimizedNote ? (
                                        <div className="note-content">
                                            <p>{optimizedNote}</p>
                                            <button className="btn-edit-inline" onClick={() => startEdit(slide.slideIndex, optimizedNote)} title="Chỉnh sửa">
                                                ✏️
                                            </button>
                                        </div>
                                    ) : (
                                        <p className="empty-note">Chưa tối ưu. Nhấn "✅ Tối Ưu & Kiểm Duyệt".</p>
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
                                        disabled={isGenerating || !activeNote}
                                        title={!activeNote ? 'Cần có lời giảng trước' : 'Tạo audio TTS'}
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

            {/* Import Speaker Notes Modal */}
            {isImportModalOpen && (
                <div className="import-modal-backdrop" onClick={() => !isImporting && setIsImportModalOpen(false)}>
                    <div className="import-modal-container" onClick={(e) => e.stopPropagation()}>
                        <div className="import-modal-header">
                            <h3>📥 Nhập Lời Giảng từ File TXT</h3>
                            <button
                                className="btn-close-modal"
                                onClick={() => !isImporting && setIsImportModalOpen(false)}
                                disabled={isImporting}
                            >
                                ✕
                            </button>
                        </div>
                        <div className="import-modal-body">
                            <div className="import-section">
                                <label className="modal-label">🎯 Chọn nơi áp dụng lời giảng:</label>
                                <div className="target-radio-group">
                                    <label className={`target-radio-card ${importTarget === 'optimized' ? 'active' : ''}`}>
                                        <input
                                            type="radio"
                                            name="importTarget"
                                            value="optimized"
                                            checked={importTarget === 'optimized'}
                                            onChange={() => setImportTarget('optimized')}
                                            disabled={isImporting}
                                        />
                                        <div>
                                            <div className="target-title">✅ Lời Giảng Tối Ưu (Khuyến nghị)</div>
                                            <div className="target-desc">Áp dụng trực tiếp vào lời giảng dùng để sinh giọng đọc Audio TTS</div>
                                        </div>
                                    </label>
                                    <label className={`target-radio-card ${importTarget === 'raw' ? 'active' : ''}`}>
                                        <input
                                            type="radio"
                                            name="importTarget"
                                            value="raw"
                                            checked={importTarget === 'raw'}
                                            onChange={() => setImportTarget('raw')}
                                            disabled={isImporting}
                                        />
                                        <div>
                                            <div className="target-title">✨ Lời Giảng Bước 1</div>
                                            <div className="target-desc">Cập nhật vào cột lời giảng gốc của Slide</div>
                                        </div>
                                    </label>
                                    <label className={`target-radio-card ${importTarget === 'both' ? 'active' : ''}`}>
                                        <input
                                            type="radio"
                                            name="importTarget"
                                            value="both"
                                            checked={importTarget === 'both'}
                                            onChange={() => setImportTarget('both')}
                                            disabled={isImporting}
                                        />
                                        <div>
                                            <div className="target-title">🔄 Cả hai cột</div>
                                            <div className="target-desc">Đồng bộ đồng thời vào cả Bước 1 và Lời giảng Tối ưu</div>
                                        </div>
                                    </label>
                                </div>
                            </div>

                            <div className="import-section">
                                <label className="modal-label">📁 Chọn file văn bản (.txt):</label>
                                <div className="file-upload-box">
                                    <input
                                        type="file"
                                        id="txtFileInput"
                                        accept=".txt"
                                        onChange={handleFileChange}
                                        disabled={isImporting}
                                        style={{ display: 'none' }}
                                    />
                                    <label htmlFor="txtFileInput" className="btn-select-file">
                                        📂 Duyệt file từ máy tính
                                    </label>
                                    {importFileName ? (
                                        <span className="selected-filename">📄 {importFileName}</span>
                                    ) : (
                                        <span className="file-placeholder">Chưa chọn file</span>
                                    )}
                                </div>
                            </div>

                            <div className="import-format-tip">
                                💡 <strong>Định dạng file hỗ trợ:</strong> Mỗi slide bắt đầu bằng <code>=== SLIDE 1: Tiêu đề ===</code> hoặc <code>[Slide 1]</code> hoặc <code>--- Slide 1 ---</code>, theo sau là nội dung lời giảng.
                            </div>

                            {importMessage && (
                                <div className={`import-alert ${importMessage.type}`}>
                                    {importMessage.text}
                                </div>
                            )}

                            {parsedImportNotes.length > 0 && (
                                <div className="import-preview-box">
                                    <div className="preview-header">
                                        📋 Xem trước ({parsedImportNotes.length} slide đã nhận diện):
                                    </div>
                                    <div className="preview-items-list">
                                        {parsedImportNotes.map((item) => (
                                            <div key={item.slideIndex} className="preview-row">
                                                <span className="preview-badge">Slide {item.slideIndex}</span>
                                                <span className="preview-text">
                                                    {item.speakerNote || <em style={{ color: '#94a3b8' }}>(trống)</em>}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="import-modal-footer">
                            <button
                                className="btn-modal-cancel"
                                onClick={() => setIsImportModalOpen(false)}
                                disabled={isImporting}
                            >
                                Hủy
                            </button>
                            <button
                                className="btn-modal-confirm"
                                onClick={handleConfirmImport}
                                disabled={isImporting || parsedImportNotes.length === 0}
                            >
                                {isImporting ? 'Đang cập nhật...' : `💾 Cập nhật (${parsedImportNotes.length} slide)`}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
