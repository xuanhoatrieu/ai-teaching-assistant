import { useState, useEffect, useRef, Component, type ReactNode, type ErrorInfo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, API_BASE_URL } from '../lib/api';
import { useJobPolling } from '../hooks/useJobPolling';
import { TTSSelector } from '../components/TTSSelector';
import { ModelSelector } from '../components/ModelSelector';
import './PptxAudioTool.css';
import '../components/steps/Steps.css';

const getFullAudioUrl = (audioUrl: string | null): string => {
    if (!audioUrl) return '';
    if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://')) return audioUrl;
    return `${API_BASE_URL}${audioUrl}`;
};

class QuestionErrorBoundary extends Component<{ children: ReactNode; fallbackText?: string }, { hasError: boolean; error: Error | null }> {
    constructor(props: { children: ReactNode; fallbackText?: string }) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Question card render error:', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="question-card question-error-card" style={{ padding: '12px 16px', background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '8px', color: '#be123c', margin: '8px 0' }}>
                    <p style={{ margin: 0, fontWeight: 600 }}>⚠️ {this.props.fallbackText || 'Lỗi hiển thị câu hỏi'}: {this.state.error?.message}</p>
                </div>
            );
        }
        return this.props.children;
    }
}

// Question structures matching lesson editor
export interface ReviewQuestion {
    id: string;
    questionId: string;
    question: string;
    correctAnswer: string;
    optionB: string;
    optionC: string;
    optionD: string;
    explanation: string;
    level: number;
}

export interface InteractiveQuestion {
    id: string;
    questionOrder: number;
    questionType: string; // MC or MR
    questionText: string;
    answers: string[]; // Array with * prefix for correct answers
    correctFeedback: string;
    incorrectFeedback: string;
    points: number;
}

export interface EnglishQuestion {
    id: string;
    questionOrder: number;
    questionType: string; // MC, MR, MATCH, CLOZE, SHORTANSWER, TRUEFALSE, ESSAY
    subDiscipline?: string;
    difficulty?: number;
    title?: string;
    questionText: string;
    dataJson: string;
    explanation?: string;
    points?: number;
}

const QUESTION_TYPE_OPTIONS = [
    { id: 'MC', label: 'Multiple Choice (1 đáp án)', badge: 'MC', icon: '🔘' },
    { id: 'MR', label: 'Multiple Response (Nhiều đáp án)', badge: 'MR', icon: '☑️' },
    { id: 'MATCH', label: 'Matching (Nối cột / Ghép đôi)', badge: 'MATCH', icon: '🔄' },
    { id: 'CLOZE', label: 'Cloze / Embedded (Điền khuyết)', badge: 'CLOZE', icon: '📝' },
    { id: 'SHORTANSWER', label: 'Short Answer (Điền từ / IPA)', badge: 'SA', icon: '✍️' },
    { id: 'TRUEFALSE', label: 'True / False (Đúng / Sai)', badge: 'TF', icon: '⚖️' },
    { id: 'ESSAY', label: 'Essay / Analysis (Tự luận / Phân tích)', badge: 'ESSAY', icon: '📄' },
];

const SUB_DISCIPLINE_OPTIONS = [
    { id: 'ALL', label: '🌐 Toàn diện (Ngôn ngữ Anh & Ngôn ngữ học)' },
    { id: 'PHONETICS', label: '🗣️ Ngữ âm & Âm vị học (Phonetics & Phonology)' },
    { id: 'MORPHOLOGY', label: '🧩 Hình thái học & Cấu tạo từ (Morphology)' },
    { id: 'SYNTAX', label: '🌳 Cú pháp học (Syntax & Tree Diagrams)' },
    { id: 'SEMANTICS', label: '🧠 Ngữ nghĩa & Ngữ dụng học (Semantics & Pragmatics)' },
    { id: 'TRANSLATION', label: '🌏 Biên - Phiên dịch (Translation Studies)' },
    { id: 'ELT', label: '🎓 Phương pháp giảng dạy tiếng Anh (ELT / TESOL)' },
];

function renderEssayRubric(data: any) {
    const raw = data?.graderInfo || data?.rubric;
    if (!raw) return <p className="essay-rubric">Giảng viên chấm tự luận trên LMS.</p>;
    if (typeof raw === 'string') return <p className="essay-rubric">{raw}</p>;
    if (typeof raw === 'object') {
        const criteria = Array.isArray(raw.criteria) ? raw.criteria : null;
        const totalPoints = typeof raw.totalPoints === 'object' ? JSON.stringify(raw.totalPoints) : raw.totalPoints;
        return (
            <div className="essay-rubric-card">
                {totalPoints !== undefined && totalPoints !== null && (
                    <div className="rubric-total-badge">
                        🎯 <strong>Tổng điểm:</strong> {String(totalPoints)}đ
                    </div>
                )}
                {criteria && criteria.length > 0 ? (
                    <div className="rubric-criteria-list">
                        {criteria.map((c: any, cIdx: number) => {
                            const name = typeof c === 'string'
                                ? c
                                : (typeof c?.name === 'string' ? c.name : (typeof c?.criterion === 'string' ? c.criterion : `Tiêu chí ${cIdx + 1}`));
                            const points = typeof c === 'object' && c?.points !== undefined
                                ? ` (${typeof c.points === 'object' ? JSON.stringify(c.points) : c.points}đ)`
                                : '';
                            const descRaw = typeof c === 'object' ? (c?.description || c?.desc || '') : '';
                            const desc = typeof descRaw === 'object' ? JSON.stringify(descRaw) : String(descRaw);
                            return (
                                <div key={cIdx} className="rubric-criterion-item">
                                    • <strong>{name}</strong>{points}{desc ? `: ${desc}` : ''}
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <p className="essay-rubric">{JSON.stringify(raw)}</p>
                )}
            </div>
        );
    }
    return <p className="essay-rubric">{String(raw)}</p>;
}

function formatClozePrompt(text: string): string {
    if (!text) return '';
    return text.replace(/\{(\d+):[A-Z_]+:[^}]+\}/g, '[ ______ ]');
}

function renderClozeVisual(rawText: string) {
    if (!rawText) return null;
    const regex = /\{(\d+):([A-Z_]+):([^}]+)\}/g;
    const parts: Array<{ type: 'text' | 'blank'; content?: string; points?: string; qType?: string; answers?: string[] }> = [];

    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(rawText)) !== null) {
        if (match.index > lastIndex) {
            parts.push({ type: 'text', content: rawText.substring(lastIndex, match.index) });
        }
        const points = match[1];
        const qType = match[2];
        const rawAnswers = match[3];
        const answers = rawAnswers.split('~').map(a => a.replace(/^=/, '').trim()).filter(Boolean);

        parts.push({
            type: 'blank',
            points,
            qType,
            answers,
        });
        lastIndex = regex.lastIndex;
    }

    if (lastIndex < rawText.length) {
        parts.push({ type: 'text', content: rawText.substring(lastIndex) });
    }

    let blankCount = 0;
    return (
        <div className="cloze-visual-container">
            <div className="cloze-visual-sentence">
                {parts.map((p, idx) => {
                    if (p.type === 'text') {
                        return <span key={idx}>{p.content}</span>;
                    }
                    blankCount++;
                    const currentNum = blankCount;
                    return (
                        <span key={idx} className="cloze-interactive-blank">
                            <span className="cloze-blank-badge">#{currentNum}</span>
                            <span className="cloze-answers-list">
                                {p.answers?.map((ans, aIdx) => (
                                    <span key={aIdx} className="cloze-single-answer">
                                        {aIdx > 0 && <span className="cloze-or-sep">hoặc</span>}
                                        <span className="cloze-ans-text">{ans}</span>
                                    </span>
                                ))}
                            </span>
                            <span className="cloze-points-badge">{p.points}đ</span>
                        </span>
                    );
                })}
            </div>
            <details className="cloze-code-details">
                <summary className="cloze-code-summary">📋 Xem mã Moodle Cloze nguồn</summary>
                <code className="cloze-raw-code">{rawText}</code>
            </details>
        </div>
    );
}

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

// Fixed: Only 1 icon per step
const STEPS = [
    { key: 'upload', label: 'Upload', icon: '📤' },
    { key: 'audio', label: 'Audio', icon: '🎙️' },
    { key: 'download', label: 'Download', icon: '📥' },
    { key: 'content', label: 'Content', icon: '📋' },
    { key: 'questions', label: 'Questions', icon: '❓' },
];

export function PptxAudioToolPage() {
    const { sessionId: paramSessionId } = useParams();
    const navigate = useNavigate();

    const [activeStep, setActiveStep] = useState(0);
    const [sessionId, setSessionId] = useState<string | null>(paramSessionId || null);
    const [session, setSession] = useState<SessionData | null>(null);
    const [slides, setSlides] = useState<ParsedSlide[]>([]);

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
    const [vittsNormalize, setVittsNormalize] = useState<boolean>(false);
    const audioRefs = useRef<Record<number, HTMLAudioElement>>({});

    // Speaker notes AI state
    const [isGeneratingNotes, setIsGeneratingNotes] = useState(false);
    const [isOptimizingNotes, setIsOptimizingNotes] = useState(false);
    const [showNotesOptionsModal, setShowNotesOptionsModal] = useState(false);
    const [notesJobId, setNotesJobId] = useState<string | null>(null);
    const [optimizeJobId, setOptimizeJobId] = useState<string | null>(null);

    // Speaker notes Import state
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [importFileName, setImportFileName] = useState('');
    const [parsedImportNotes, setParsedImportNotes] = useState<Array<{ slideIndex: number; speakerNote: string }>>([]);
    const [isImporting, setIsImporting] = useState(false);
    const [importMessage, setImportMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // ─────────────────────────────────────────────────────────────
    // Questions 3-Tab State
    // ─────────────────────────────────────────────────────────────
    const [activeQuestionTab, setActiveQuestionTab] = useState<'review' | 'interactive' | 'english'>('review');
    const [questionMessage, setQuestionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // 1. Review Questions state
    const [reviewQuestions, setReviewQuestions] = useState<ReviewQuestion[]>([]);
    const [reviewCounts, setReviewCounts] = useState({ level1: 20, level2: 20, level3: 10 });
    const [isGeneratingReview, setIsGeneratingReview] = useState(false);
    const [isAppendingReview, setIsAppendingReview] = useState(false);
    const [editingReviewId, setEditingReviewId] = useState<string | null>(null);
    const [reviewFilter, setReviewFilter] = useState<'ALL' | 1 | 2 | 3>('ALL');
    const reviewImportInputRef = useRef<HTMLInputElement>(null);
    const [isImportingReview, setIsImportingReview] = useState(false);

    // 2. Interactive Questions state
    const [interactiveQuestions, setInteractiveQuestions] = useState<InteractiveQuestion[]>([]);
    const [interactiveCount, setInteractiveCount] = useState(5);
    const [isGeneratingInteractive, setIsGeneratingInteractive] = useState(false);
    const [isAppendingInteractive, setIsAppendingInteractive] = useState(false);
    const [editingInteractiveId, setEditingInteractiveId] = useState<string | null>(null);

    // 3. English Questions state
    const [englishQuestions, setEnglishQuestions] = useState<EnglishQuestion[]>([]);
    const [englishLevelCounts, setEnglishLevelCounts] = useState({ level1: 20, level2: 20, level3: 10 });
    const [selectedSubDiscipline, setSelectedSubDiscipline] = useState('ALL');
    const [selectedQuestionTypes, setSelectedQuestionTypes] = useState<string[]>([
        'MC', 'MR', 'MATCH', 'CLOZE', 'SHORTANSWER', 'TRUEFALSE', 'ESSAY'
    ]);
    const [isGeneratingEnglish, setIsGeneratingEnglish] = useState(false);
    const [isAppendingEnglish, setIsAppendingEnglish] = useState(false);
    const [editingEnglishId, setEditingEnglishId] = useState<string | null>(null);

    // Download state
    const [isDownloading, setIsDownloading] = useState(false);
    const [generateAllJobId, setGenerateAllJobId] = useState<string | null>(null);

    // Audio generate-all background job
    const generateAllAudioJob = useJobPolling({
        onComplete: async () => {
            setIsGeneratingAll(false);
            setGenerateAllJobId(null);
            if (sessionId) await loadSession(sessionId);
        },
        onCancelled: async () => {
            setIsGeneratingAll(false);
            setGenerateAllJobId(null);
            if (sessionId) await loadSession(sessionId);
        },
        onError: (msg) => {
            setIsGeneratingAll(false);
            setGenerateAllJobId(null);
            alert(`Lỗi khi tạo audio: ${msg}`);
        },
    });

    // Background jobs for Speaker Notes Generation & Optimization
    const notesJob = useJobPolling({
        onComplete: async () => {
            setIsGeneratingNotes(false);
            setNotesJobId(null);
            if (sessionId) {
                await loadSession(sessionId);
            }
        },
        onCancelled: async () => {
            setIsGeneratingNotes(false);
            setNotesJobId(null);
            if (sessionId) await loadSession(sessionId);
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
            if (sessionId) {
                await loadSession(sessionId);
            }
        },
        onCancelled: async () => {
            setIsOptimizingNotes(false);
            setOptimizeJobId(null);
            if (sessionId) await loadSession(sessionId);
        },
        onError: (msg) => {
            setIsOptimizingNotes(false);
            setOptimizeJobId(null);
            alert(`Lỗi khi tối ưu lời giảng: ${msg}`);
        },
    });

    // Background jobs for Question Bank (Review, Interactive, English)
    const reviewJob = useJobPolling({
        onComplete: async () => {
            setIsGeneratingReview(false);
            if (sessionId) await loadAllQuestions(sessionId);
            setQuestionMessage({ type: 'success', text: '✓ Đã tạo câu hỏi ôn tập thành công!' });
        },
        onError: (msg) => {
            setIsGeneratingReview(false);
            setQuestionMessage({ type: 'error', text: msg });
        },
    });

    const appendReviewJob = useJobPolling({
        onComplete: async () => {
            setIsAppendingReview(false);
            if (sessionId) await loadAllQuestions(sessionId);
            setQuestionMessage({ type: 'success', text: '✓ Đã thêm câu hỏi ôn tập thành công!' });
        },
        onError: (msg) => {
            setIsAppendingReview(false);
            setQuestionMessage({ type: 'error', text: msg });
        },
    });

    const interactiveJob = useJobPolling({
        onComplete: async () => {
            setIsGeneratingInteractive(false);
            if (sessionId) await loadAllQuestions(sessionId);
            setQuestionMessage({ type: 'success', text: '✓ Đã tạo câu hỏi tương tác thành công!' });
        },
        onError: (msg) => {
            setIsGeneratingInteractive(false);
            setQuestionMessage({ type: 'error', text: msg });
        },
    });

    const appendInteractiveJob = useJobPolling({
        onComplete: async () => {
            setIsAppendingInteractive(false);
            if (sessionId) await loadAllQuestions(sessionId);
            setQuestionMessage({ type: 'success', text: '✓ Đã thêm câu hỏi tương tác thành công!' });
        },
        onError: (msg) => {
            setIsAppendingInteractive(false);
            setQuestionMessage({ type: 'error', text: msg });
        },
    });

    const englishJob = useJobPolling({
        onComplete: async () => {
            setIsGeneratingEnglish(false);
            if (sessionId) await loadAllQuestions(sessionId);
            setQuestionMessage({ type: 'success', text: '✓ Đã tạo câu hỏi tiếng Anh thành công!' });
        },
        onError: (msg) => {
            setIsGeneratingEnglish(false);
            setQuestionMessage({ type: 'error', text: msg });
        },
    });

    const appendEnglishJob = useJobPolling({
        onComplete: async () => {
            setIsAppendingEnglish(false);
            if (sessionId) await loadAllQuestions(sessionId);
            setQuestionMessage({ type: 'success', text: '✓ Đã thêm câu hỏi tiếng Anh thành công!' });
        },
        onError: (msg) => {
            setIsAppendingEnglish(false);
            setQuestionMessage({ type: 'error', text: msg });
        },
    });

    // Refresh slides on each progress tick of background jobs
    useEffect(() => {
        if ((generateAllAudioJob.isRunning || notesJob.isRunning || optimizeJob.isRunning) && sessionId) {
            reloadSlidesOnly(sessionId);
        }
    }, [
        generateAllAudioJob.jobStatus?.progress,
        generateAllAudioJob.isRunning,
        notesJob.jobStatus?.progress,
        notesJob.isRunning,
        optimizeJob.jobStatus?.progress,
        optimizeJob.isRunning,
        sessionId,
    ]);

    const reloadSlidesOnly = async (sid: string) => {
        try {
            const res = await api.get(`/pptx-audio-tool/${sid}`);
            if (res.data?.slides) {
                setSlides(res.data.slides);
            }
        } catch (err) {
            console.error('Error reloading slides:', err);
        }
    };

    const checkActiveJobs = async (sid: string) => {
        try {
            // Speaker notes job
            const resNotes = await api.get(`/generation-jobs/active?lessonId=${sid}&type=pptx-tool-speaker-notes`);
            if (resNotes.data?.id) {
                setNotesJobId(resNotes.data.id);
                setIsGeneratingNotes(true);
                notesJob.startPolling(resNotes.data.id);
            }

            // Optimize notes job
            const resOpt = await api.get(`/generation-jobs/active?lessonId=${sid}&type=pptx-tool-optimize-notes`);
            if (resOpt.data?.id) {
                setOptimizeJobId(resOpt.data.id);
                setIsOptimizingNotes(true);
                optimizeJob.startPolling(resOpt.data.id);
            }

            // Audio generate-all job
            const resAudio = await api.get(`/generation-jobs/active?lessonId=${sid}&type=pptx-tool-generate-all-audio`);
            if (resAudio.data?.id) {
                setGenerateAllJobId(resAudio.data.id);
                setIsGeneratingAll(true);
                generateAllAudioJob.startPolling(resAudio.data.id);
            }

            // Review questions
            const resRevGen = await api.get(`/generation-jobs/active?lessonId=${sid}&type=pptx-tool-review-questions`);
            if (resRevGen.data?.id) {
                setActiveQuestionTab('review');
                setIsGeneratingReview(true);
                reviewJob.startPolling(resRevGen.data.id);
            }
            const resRevApp = await api.get(`/generation-jobs/active?lessonId=${sid}&type=pptx-tool-append-review-questions`);
            if (resRevApp.data?.id) {
                setActiveQuestionTab('review');
                setIsAppendingReview(true);
                appendReviewJob.startPolling(resRevApp.data.id);
            }

            // Interactive questions
            const resIntGen = await api.get(`/generation-jobs/active?lessonId=${sid}&type=pptx-tool-interactive-questions`);
            if (resIntGen.data?.id) {
                setActiveQuestionTab('interactive');
                setIsGeneratingInteractive(true);
                interactiveJob.startPolling(resIntGen.data.id);
            }
            const resIntApp = await api.get(`/generation-jobs/active?lessonId=${sid}&type=pptx-tool-append-interactive-questions`);
            if (resIntApp.data?.id) {
                setActiveQuestionTab('interactive');
                setIsAppendingInteractive(true);
                appendInteractiveJob.startPolling(resIntApp.data.id);
            }

            // English questions
            const resEngGen = await api.get(`/generation-jobs/active?lessonId=${sid}&type=pptx-tool-english-questions`);
            if (resEngGen.data?.id) {
                setActiveQuestionTab('english');
                setIsGeneratingEnglish(true);
                englishJob.startPolling(resEngGen.data.id);
            }
            const resEngApp = await api.get(`/generation-jobs/active?lessonId=${sid}&type=pptx-tool-append-english-questions`);
            if (resEngApp.data?.id) {
                setActiveQuestionTab('english');
                setIsAppendingEnglish(true);
                appendEnglishJob.startPolling(resEngApp.data.id);
            }
        } catch (err) {
            console.error('Error checking active jobs in PPTX tool:', err);
        }
    };

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
            const res = await api.get(`/pptx-audio-tool/${sid}`);
            setSession(res.data);
            setSlides(res.data.slides || []);
            setLanguage(res.data.language || 'vi');
            setSessionId(sid);
            await loadAllQuestions(sid);
            await checkActiveJobs(sid);
            // Auto-navigate to audio step if already uploaded
            if (res.data.status !== 'uploaded') {
                setActiveStep(1);
            }
        } catch (error) {
            console.error('Error loading session:', error);
        }
    };

    const loadAllQuestions = async (sid: string) => {
        try {
            const res = await api.get(`/pptx-audio-tool/${sid}/all-questions`);
            if (res.data) {
                setReviewQuestions(res.data.review || []);
                setInteractiveQuestions(res.data.interactive || []);
                setEnglishQuestions(res.data.english || []);
            }
        } catch (err) {
            console.error('Error loading questions:', err);
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
            setReviewQuestions([]);
            setInteractiveQuestions([]);
            setEnglishQuestions([]);
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

    const startGenerateNotes = async (mode: 'all' | 'missing') => {
        if (!sessionId) return;
        try {
            setIsGeneratingNotes(true);
            setShowNotesOptionsModal(false);
            const res = await api.post(`/pptx-audio-tool/${sessionId}/speaker-notes/generate`, { mode });
            if (res.data?.jobId) {
                setNotesJobId(res.data.jobId);
                notesJob.startPolling(res.data.jobId);
            }
        } catch (err: any) {
            setIsGeneratingNotes(false);
            alert(err.response?.data?.message || 'Lỗi khi bắt đầu tạo lời giảng');
        }
    };

    const cancelNotesJob = async () => {
        const jid = notesJobId || notesJob.jobStatus?.id;
        if (!jid) return;
        try {
            await api.post(`/generation-jobs/${jid}/cancel`);
            setIsGeneratingNotes(false);
            setNotesJobId(null);
            if (sessionId) await loadSession(sessionId);
        } catch (err) {
            console.error('Error cancelling notes job:', err);
        }
    };

    const startOptimizeNotes = async () => {
        if (!sessionId) return;
        try {
            setIsOptimizingNotes(true);
            const res = await api.post(`/pptx-audio-tool/${sessionId}/speaker-notes/optimize`);
            if (res.data?.jobId) {
                setOptimizeJobId(res.data.jobId);
                optimizeJob.startPolling(res.data.jobId);
            }
        } catch (err: any) {
            setIsOptimizingNotes(false);
            alert(err.response?.data?.message || 'Lỗi khi bắt đầu tối ưu lời giảng');
        }
    };

    const cancelOptimizeJob = async () => {
        const jid = optimizeJobId || optimizeJob.jobStatus?.id;
        if (!jid) return;
        try {
            await api.post(`/generation-jobs/${jid}/cancel`);
            setIsOptimizingNotes(false);
            setOptimizeJobId(null);
            if (sessionId) await loadSession(sessionId);
        } catch (err) {
            console.error('Error cancelling optimize job:', err);
        }
    };

    const exportNotesTxt = () => {
        if (!slides || slides.length === 0) return;
        const lines: string[] = [];
        slides.forEach(slide => {
            const note = getActiveNote(slide) || '';
            lines.push(`=== SLIDE ${slide.index + 1}: ${slide.title || `Slide ${slide.index + 1}`} ===`);
            lines.push(note.trim() ? note.trim() : '(Chưa có lời giảng)');
            lines.push('');
        });

        const textContent = lines.join('\n');
        const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const cleanTitle = (session?.fileName || 'BaiGiang').replace(/\.pptx$/i, '').replace(/[^a-zA-Z0-9_\-\u00C0-\u024F\u1EA0-\u1EF9]/g, '_');
        link.download = `${cleanTitle}_LoiGiang.txt`;
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
        if (!sessionId || parsedImportNotes.length === 0) return;
        try {
            setIsImporting(true);
            const response = await api.post(`/pptx-audio-tool/${sessionId}/speaker-notes/import`, {
                notes: parsedImportNotes,
            });

            if (response.data?.success) {
                if (response.data.slides) {
                    setSlides(response.data.slides);
                } else {
                    await loadSession(sessionId);
                }
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

    const generateAllAudios = async () => {
        if (!sessionId) return;
        try {
            setIsGeneratingAll(true);
            const res = await api.post(`/pptx-audio-tool/${sessionId}/generate-all-audio`, {
                multilingualMode: multilingualMode || undefined,
                vittsMode: vittsMode || undefined,
                vittsDesignInstruct: vittsDesignInstruct || undefined,
                vittsNormalize,
            });
            if (res.data?.jobId) {
                setGenerateAllJobId(res.data.jobId);
                generateAllAudioJob.startPolling(res.data.jobId);
            }
        } catch (error: any) {
            console.error('Error starting audio generation for all slides:', error);
            setIsGeneratingAll(false);
            alert(error.response?.data?.message || 'Lỗi khi bắt đầu tạo audio. Vui lòng thử lại.');
        }
    };

    const cancelAudioJob = async () => {
        const jobId = generateAllJobId || generateAllAudioJob.jobStatus?.id;
        if (!jobId) return;
        try {
            await api.post(`/generation-jobs/${jobId}/cancel`);
            generateAllAudioJob.stopPolling();
            setIsGeneratingAll(false);
            setGenerateAllJobId(null);
            if (sessionId) await loadSession(sessionId);
        } catch (err) {
            console.error('Error cancelling audio job:', err);
            setIsGeneratingAll(false);
        }
    };

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
    // STEP 5: QUESTIONS HANDLERS (REVIEW, INTERACTIVE, ENGLISH)
    // ═══════════════════════════════════════════════════════════════

    // 1. Review Questions
    const handleGenerateReview = async () => {
        if (!sessionId) return;
        if (reviewQuestions.length > 0 && !confirm('⚠️ Thao tác này sẽ XÓA toàn bộ câu hỏi ôn tập cũ và tạo mới. Tiếp tục?')) return;
        try {
            setIsGeneratingReview(true);
            setQuestionMessage(null);
            const res = await api.post(`/pptx-audio-tool/${sessionId}/review-questions/generate`, {
                level1: reviewCounts.level1,
                level2: reviewCounts.level2,
                level3: reviewCounts.level3,
            });
            if (res.data?.jobId) {
                reviewJob.startPolling(res.data.jobId);
            }
        } catch (error: any) {
            console.error('Error generating review questions:', error);
            setIsGeneratingReview(false);
            setQuestionMessage({ type: 'error', text: error.response?.data?.message || 'Không thể tạo câu hỏi ôn tập' });
        }
    };

    const handleAppendReview = async () => {
        if (!sessionId) return;
        try {
            setIsAppendingReview(true);
            setQuestionMessage(null);
            const res = await api.post(`/pptx-audio-tool/${sessionId}/review-questions/append`, {
                level1: reviewCounts.level1,
                level2: reviewCounts.level2,
                level3: reviewCounts.level3,
            });
            if (res.data?.jobId) {
                appendReviewJob.startPolling(res.data.jobId);
            }
        } catch (error: any) {
            console.error('Error appending review questions:', error);
            setIsAppendingReview(false);
            setQuestionMessage({ type: 'error', text: error.response?.data?.message || 'Không thể tạo thêm câu hỏi ôn tập' });
        }
    };

    const handleUpdateReview = async (q: ReviewQuestion) => {
        if (!sessionId) return;
        try {
            await api.put(`/pptx-audio-tool/${sessionId}/questions/review/${q.id}`, q);
            setEditingReviewId(null);
            setQuestionMessage({ type: 'success', text: '✓ Đã lưu thay đổi câu hỏi!' });
        } catch (error: any) {
            setQuestionMessage({ type: 'error', text: 'Không thể lưu câu hỏi' });
        }
    };

    const handleDeleteReview = async (id: string) => {
        if (!sessionId || !confirm('Xóa câu hỏi này?')) return;
        try {
            await api.delete(`/pptx-audio-tool/${sessionId}/questions/review/${id}`);
            setReviewQuestions(prev => prev.filter(q => q.id !== id));
            setQuestionMessage({ type: 'success', text: '✓ Đã xóa câu hỏi!' });
        } catch (error: any) {
            setQuestionMessage({ type: 'error', text: 'Không thể xóa câu hỏi' });
        }
    };

    const handleClearAllReview = async () => {
        if (!sessionId || !confirm('Xóa toàn bộ câu hỏi ôn tập?')) return;
        try {
            await api.delete(`/pptx-audio-tool/${sessionId}/questions/review`);
            setReviewQuestions([]);
            setQuestionMessage({ type: 'success', text: '✓ Đã xóa toàn bộ câu hỏi ôn tập!' });
        } catch (error: any) {
            setQuestionMessage({ type: 'error', text: 'Không thể xóa toàn bộ câu hỏi' });
        }
    };

    const handleExportReviewExcel = async () => {
        if (!sessionId) return;
        try {
            const res = await api.get(`/pptx-audio-tool/${sessionId}/review-questions/export/excel`, { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const a = document.createElement('a');
            a.href = url;
            a.download = `${session?.fileName?.replace('.pptx', '') || 'pptx'}_review_questions.xlsx`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch {
            setQuestionMessage({ type: 'error', text: 'Không thể xuất Excel' });
        }
    };

    const handleExportReviewWord = async () => {
        if (!sessionId) return;
        try {
            const res = await api.get(`/pptx-audio-tool/${sessionId}/review-questions/export/word`, { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const a = document.createElement('a');
            a.href = url;
            a.download = `${session?.fileName?.replace('.pptx', '') || 'pptx'}_review_questions.docx`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch {
            setQuestionMessage({ type: 'error', text: 'Không thể xuất Word' });
        }
    };

    const handleExportReviewMoodleXml = async () => {
        if (!sessionId) return;
        try {
            const res = await api.get(`/pptx-audio-tool/${sessionId}/review-questions/export/moodle-xml`, { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/xml; charset=utf-8' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = `${session?.fileName?.replace('.pptx', '') || 'pptx'}_review_moodle.xml`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch {
            setQuestionMessage({ type: 'error', text: 'Không thể xuất Moodle XML' });
        }
    };

    const handleDownloadReviewTemplate = async () => {
        try {
            const res = await api.get(`/pptx-audio-tool/dummy/review-questions/template/excel`, { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const a = document.createElement('a');
            a.href = url;
            a.download = 'mau_cau_hoi_on_tap.xlsx';
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch {
            setQuestionMessage({ type: 'error', text: 'Không thể tải file mẫu' });
        }
    };

    const handleImportReviewExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file || !sessionId) return;
        try {
            setIsImportingReview(true);
            setQuestionMessage(null);
            const formData = new FormData();
            formData.append('file', file);
            const res = await api.post(`/pptx-audio-tool/${sessionId}/review-questions/import/excel`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            await loadAllQuestions(sessionId);
            setQuestionMessage({ type: 'success', text: `✓ Đã import thành công ${res.data.imported || 0} câu hỏi!` });
        } catch (error: any) {
            setQuestionMessage({ type: 'error', text: error.response?.data?.message || 'Import thất bại' });
        } finally {
            setIsImportingReview(false);
        }
    };

    // 2. Interactive Questions Handlers
    const handleGenerateInteractive = async () => {
        if (!sessionId) return;
        if (interactiveQuestions.length > 0 && !confirm('⚠️ Thao tác này sẽ XÓA toàn bộ câu hỏi tương tác cũ và tạo mới. Tiếp tục?')) return;
        try {
            setIsGeneratingInteractive(true);
            setQuestionMessage(null);
            const res = await api.post(`/pptx-audio-tool/${sessionId}/interactive-questions/generate`, { count: interactiveCount });
            if (res.data?.jobId) {
                interactiveJob.startPolling(res.data.jobId);
            }
        } catch (error: any) {
            console.error('Error generating interactive questions:', error);
            setIsGeneratingInteractive(false);
            setQuestionMessage({ type: 'error', text: error.response?.data?.message || 'Không thể tạo câu hỏi tương tác' });
        }
    };

    const handleAppendInteractive = async () => {
        if (!sessionId) return;
        try {
            setIsAppendingInteractive(true);
            setQuestionMessage(null);
            const res = await api.post(`/pptx-audio-tool/${sessionId}/interactive-questions/append`, { count: interactiveCount });
            if (res.data?.jobId) {
                appendInteractiveJob.startPolling(res.data.jobId);
            }
        } catch (error: any) {
            console.error('Error appending interactive questions:', error);
            setIsAppendingInteractive(false);
            setQuestionMessage({ type: 'error', text: error.response?.data?.message || 'Không thể tạo thêm câu hỏi tương tác' });
        }
    };

    const handleUpdateInteractive = async (q: InteractiveQuestion) => {
        if (!sessionId) return;
        try {
            await api.put(`/pptx-audio-tool/${sessionId}/questions/interactive/${q.id}`, q);
            setEditingInteractiveId(null);
            setQuestionMessage({ type: 'success', text: '✓ Đã lưu thay đổi câu hỏi!' });
        } catch {
            setQuestionMessage({ type: 'error', text: 'Không thể lưu câu hỏi' });
        }
    };

    const handleDeleteInteractive = async (id: string) => {
        if (!sessionId || !confirm('Xóa câu hỏi này?')) return;
        try {
            await api.delete(`/pptx-audio-tool/${sessionId}/questions/interactive/${id}`);
            setInteractiveQuestions(prev => prev.filter(q => q.id !== id));
            setQuestionMessage({ type: 'success', text: '✓ Đã xóa câu hỏi!' });
        } catch {
            setQuestionMessage({ type: 'error', text: 'Không thể xóa câu hỏi' });
        }
    };

    const handleClearAllInteractive = async () => {
        if (!sessionId || !confirm('Xóa toàn bộ câu hỏi tương tác?')) return;
        try {
            await api.delete(`/pptx-audio-tool/${sessionId}/questions/interactive`);
            setInteractiveQuestions([]);
            setQuestionMessage({ type: 'success', text: '✓ Đã xóa toàn bộ câu hỏi tương tác!' });
        } catch {
            setQuestionMessage({ type: 'error', text: 'Không thể xóa câu hỏi' });
        }
    };

    const handleExportInteractiveExcel = async () => {
        if (!sessionId) return;
        try {
            const res = await api.get(`/pptx-audio-tool/${sessionId}/interactive-questions/export/excel`, { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const a = document.createElement('a');
            a.href = url;
            a.download = `${session?.fileName?.replace('.pptx', '') || 'pptx'}_interactive_questions.xlsx`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch {
            setQuestionMessage({ type: 'error', text: 'Không thể xuất Excel' });
        }
    };

    const handleExportInteractiveWord = async () => {
        if (!sessionId) return;
        try {
            const res = await api.get(`/pptx-audio-tool/${sessionId}/interactive-questions/export/word`, { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const a = document.createElement('a');
            a.href = url;
            a.download = `${session?.fileName?.replace('.pptx', '') || 'pptx'}_interactive_questions.docx`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch {
            setQuestionMessage({ type: 'error', text: 'Không thể xuất Word' });
        }
    };

    // 3. English Questions Handlers
    const handleGenerateEnglish = async () => {
        if (!sessionId) return;
        if (selectedQuestionTypes.length === 0) {
            setQuestionMessage({ type: 'error', text: 'Vui lòng chọn ít nhất 1 dạng câu hỏi.' });
            return;
        }
        if (englishQuestions.length > 0 && !confirm('⚠️ Thao tác này sẽ XÓA toàn bộ câu hỏi tiếng Anh cũ và tạo mới. Tiếp tục?')) return;
        try {
            setIsGeneratingEnglish(true);
            setQuestionMessage(null);
            const res = await api.post(`/pptx-audio-tool/${sessionId}/english-questions/generate`, {
                level1: englishLevelCounts.level1,
                level2: englishLevelCounts.level2,
                level3: englishLevelCounts.level3,
                questionTypes: selectedQuestionTypes,
                subDiscipline: selectedSubDiscipline,
            });
            if (res.data?.jobId) {
                englishJob.startPolling(res.data.jobId);
            }
        } catch (error: any) {
            console.error('Error generating english questions:', error);
            setIsGeneratingEnglish(false);
            setQuestionMessage({ type: 'error', text: error.response?.data?.message || 'Không thể tạo câu hỏi tiếng Anh' });
        }
    };

    const handleAppendEnglish = async () => {
        if (!sessionId) return;
        if (selectedQuestionTypes.length === 0) {
            setQuestionMessage({ type: 'error', text: 'Vui lòng chọn ít nhất 1 dạng câu hỏi.' });
            return;
        }
        try {
            setIsAppendingEnglish(true);
            setQuestionMessage(null);
            const res = await api.post(`/pptx-audio-tool/${sessionId}/english-questions/append`, {
                level1: englishLevelCounts.level1,
                level2: englishLevelCounts.level2,
                level3: englishLevelCounts.level3,
                questionTypes: selectedQuestionTypes,
                subDiscipline: selectedSubDiscipline,
            });
            if (res.data?.jobId) {
                appendEnglishJob.startPolling(res.data.jobId);
            }
        } catch (error: any) {
            console.error('Error appending english questions:', error);
            setIsAppendingEnglish(false);
            setQuestionMessage({ type: 'error', text: error.response?.data?.message || 'Không thể thêm câu hỏi tiếng Anh' });
        }
    };

    const handleUpdateEnglish = async (q: EnglishQuestion) => {
        if (!sessionId) return;
        try {
            await api.put(`/pptx-audio-tool/${sessionId}/questions/english/${q.id}`, q);
            setEditingEnglishId(null);
            setQuestionMessage({ type: 'success', text: '✓ Đã lưu thay đổi câu hỏi tiếng Anh!' });
        } catch {
            setQuestionMessage({ type: 'error', text: 'Không thể lưu câu hỏi tiếng Anh' });
        }
    };

    const handleDeleteEnglish = async (id: string) => {
        if (!sessionId || !confirm('Xác nhận xóa câu hỏi này?')) return;
        try {
            await api.delete(`/pptx-audio-tool/${sessionId}/questions/english/${id}`);
            setEnglishQuestions(prev => prev.filter(q => q.id !== id));
            setQuestionMessage({ type: 'success', text: '✓ Đã xóa câu hỏi!' });
        } catch {
            setQuestionMessage({ type: 'error', text: 'Không thể xóa câu hỏi' });
        }
    };

    const handleClearAllEnglish = async () => {
        if (!sessionId || !confirm('Xóa toàn bộ câu hỏi tiếng Anh?')) return;
        try {
            await api.delete(`/pptx-audio-tool/${sessionId}/questions/english`);
            setEnglishQuestions([]);
            setQuestionMessage({ type: 'success', text: '✓ Đã xóa toàn bộ câu hỏi tiếng Anh!' });
        } catch {
            setQuestionMessage({ type: 'error', text: 'Không thể xóa câu hỏi' });
        }
    };

    const handleExportEnglishMoodleXml = async () => {
        if (!sessionId) return;
        try {
            const res = await api.get(`/pptx-audio-tool/${sessionId}/english-questions/export/moodle-xml`, { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/xml; charset=utf-8' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = `${session?.fileName?.replace('.pptx', '') || 'pptx'}_english_moodle.xml`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch {
            setQuestionMessage({ type: 'error', text: 'Không thể xuất Moodle XML' });
        }
    };

    const handleExportEnglishExcel = async () => {
        if (!sessionId) return;
        try {
            const res = await api.get(`/pptx-audio-tool/${sessionId}/english-questions/export/excel`, { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const a = document.createElement('a');
            a.href = url;
            a.download = `${session?.fileName?.replace('.pptx', '') || 'pptx'}_english_questions.xlsx`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch {
            setQuestionMessage({ type: 'error', text: 'Không thể xuất Excel' });
        }
    };

    const handleExportEnglishWord = async () => {
        if (!sessionId) return;
        try {
            const res = await api.get(`/pptx-audio-tool/${sessionId}/english-questions/export/word`, { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const a = document.createElement('a');
            a.href = url;
            a.download = `${session?.fileName?.replace('.pptx', '') || 'pptx'}_english_questions.docx`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch {
            setQuestionMessage({ type: 'error', text: 'Không thể xuất Word' });
        }
    };

    const toggleQuestionType = (type: string) => {
        setSelectedQuestionTypes(prev =>
            prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
        );
    };

    const selectAllQuestionTypes = () => {
        setSelectedQuestionTypes(['MC', 'MR', 'MATCH', 'CLOZE', 'SHORTANSWER', 'TRUEFALSE', 'ESSAY']);
    };

    const deselectAllQuestionTypes = () => {
        setSelectedQuestionTypes([]);
    };

    const parseAnswers = (answers: string[]) => {
        return (answers || []).map(a => ({
            text: a.replace(/^\*/, ''),
            isCorrect: a.startsWith('*'),
        }));
    };

    // ═══════════════════════════════════════════════════════════════
    // COMPUTED
    // ═══════════════════════════════════════════════════════════════
    const completedCount = slides.filter(s => s.audioStatus === 'done').length;
    const slidesWithNotes = slides.filter(s => getActiveNote(s)?.trim());
    const hasDualLanguage = slides.some(s => s.hasDual);
    const filteredReviewQuestions = reviewQuestions.filter(q => {
        if (reviewFilter === 'ALL') return true;
        return q.level === reviewFilter;
    });

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
                                                            setReviewQuestions([]);
                                                            setInteractiveQuestions([]);
                                                            setEnglishQuestions([]);
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
                                    📊 <strong>{completedCount}</strong> / {slides.length} slides ({slidesWithNotes.length} có note)
                                    {hasDualLanguage && <> · 🌐 Song ngữ</>}
                                </p>
                            </div>
                            <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
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

                                {/* Generate Speaker Notes */}
                                <button
                                    className="btn-generate-notes"
                                    onClick={() => setShowNotesOptionsModal(true)}
                                    disabled={isGeneratingNotes || isOptimizingNotes}
                                    title="Dùng AI soạn lời giảng từ nội dung slide"
                                >
                                    {isGeneratingNotes ? (
                                        <>
                                            <span className="spinner"></span>{' '}
                                            {notesJob.jobStatus?.progress !== undefined
                                                ? `Đang soạn (${notesJob.jobStatus.progress}%)`
                                                : 'Đang soạn...'}
                                        </>
                                    ) : slidesWithNotes.length > 0 ? (
                                        '🔄 Tạo lại Lời Giảng'
                                    ) : (
                                        '✨ Tạo Lời Giảng'
                                    )}
                                </button>
                                {isGeneratingNotes && (
                                    <button className="btn-stop" onClick={cancelNotesJob} title="Hủy tạo lời giảng">⏹️ Dừng</button>
                                )}

                                {/* Optimize Speaker Notes */}
                                <button
                                    className="btn-optimize-notes"
                                    onClick={startOptimizeNotes}
                                    disabled={isOptimizingNotes || isGeneratingNotes || slidesWithNotes.length === 0}
                                    title={slidesWithNotes.length === 0 ? 'Cần có lời giảng trước khi tối ưu' : 'Chuẩn hóa nhịp điệu đọc & dấu câu cho TTS'}
                                >
                                    {isOptimizingNotes ? (
                                        <>
                                            <span className="spinner"></span>{' '}
                                            {optimizeJob.jobStatus?.progress !== undefined
                                                ? `Đang tối ưu (${optimizeJob.jobStatus.progress}%)`
                                                : 'Đang tối ưu...'}
                                        </>
                                    ) : (
                                        '✅ Tối Ưu & Kiểm Duyệt'
                                    )}
                                </button>
                                {isOptimizingNotes && (
                                    <button className="btn-stop" onClick={cancelOptimizeJob} title="Hủy tối ưu">⏹️ Dừng</button>
                                )}

                                {/* Export Notes */}
                                <button
                                    className="btn-export-notes"
                                    onClick={exportNotesTxt}
                                    disabled={slidesWithNotes.length === 0}
                                    title="Tải về file TXT lời giảng các slide"
                                >
                                    📤 Xuất Lời Giảng
                                </button>

                                {/* Import Notes */}
                                <button
                                    className="btn-import-notes"
                                    onClick={() => {
                                        setImportFileName('');
                                        setParsedImportNotes([]);
                                        setImportMessage(null);
                                        setIsImportModalOpen(true);
                                    }}
                                    disabled={!slides || slides.length === 0}
                                    title="Nhập lời giảng từ file văn bản TXT"
                                >
                                    📥 Nhập Lời Giảng
                                </button>

                                {/* Generate All */}
                                <button
                                    className="btn-generate-all"
                                    onClick={generateAllAudios}
                                    disabled={isGeneratingAll || slidesWithNotes.length === 0 || isGeneratingNotes || isOptimizingNotes}
                                >
                                    {isGeneratingAll ? (
                                        <>
                                            <span className="spinner"></span>{' '}
                                            {generateAllAudioJob.jobStatus?.progress !== undefined
                                                ? `Đang tạo audio (${generateAllAudioJob.jobStatus.progress}%)`
                                                : 'Đang tạo audio...'}
                                        </>
                                    ) : (
                                        '🎙️ Tạo Audio Tất Cả'
                                    )}
                                </button>
                                {isGeneratingAll && (
                                    <button className="btn-stop" onClick={cancelAudioJob}>⏹️ Dừng</button>
                                )}
                            </div>
                        </div>

                        {/* Model & TTS Config */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '14px 0' }}>
                            <ModelSelector taskType="SPEAKER_NOTES" compact />
                            <TTSSelector onChange={(config) => {
                                if (config.multilingualMode !== undefined) setMultilingualMode(config.multilingualMode || '');
                                if (config.vittsMode !== undefined) setVittsMode(config.vittsMode || '');
                                if (config.vittsDesignInstruct !== undefined) setVittsDesignInstruct(config.vittsDesignInstruct || '');
                                if (config.vittsNormalize !== undefined) setVittsNormalize(config.vittsNormalize);
                            }} />
                        </div>

                        {/* Background Job Running Banner for Speaker Notes */}
                        {notesJob.isRunning && (
                            <div style={{
                                margin: '14px 0',
                                padding: '12px 18px',
                                background: '#f0fdf4',
                                border: '1px solid #bbf7d0',
                                borderRadius: '8px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '16px'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <span className="spinner" style={{ borderColor: '#16a34a', borderTopColor: 'transparent', width: 20, height: 20 }}></span>
                                    <div>
                                        <div style={{ fontWeight: 600, color: '#15803d', fontSize: '0.95rem' }}>
                                            {notesJob.jobStatus?.message || 'Đang tạo lời giảng bằng AI...'} ({notesJob.jobStatus?.progress || 0}%)
                                        </div>
                                        <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                                            Tác vụ đang chạy ngầm trên máy chủ. Bạn có thể chuyển tab hoặc làm việc khác mà không bị gián đoạn.
                                        </div>
                                    </div>
                                </div>
                                <button
                                    className="btn-stop"
                                    onClick={cancelNotesJob}
                                    style={{ padding: '6px 14px', fontSize: '0.85rem', flexShrink: 0 }}
                                >
                                    ⏹️ Hủy bỏ
                                </button>
                            </div>
                        )}

                        {/* Background Job Running Banner for Optimize Notes */}
                        {optimizeJob.isRunning && (
                            <div style={{
                                margin: '14px 0',
                                padding: '12px 18px',
                                background: '#faf5ff',
                                border: '1px solid #e9d5ff',
                                borderRadius: '8px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '16px'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <span className="spinner" style={{ borderColor: '#9333ea', borderTopColor: 'transparent', width: 20, height: 20 }}></span>
                                    <div>
                                        <div style={{ fontWeight: 600, color: '#7e22ce', fontSize: '0.95rem' }}>
                                            {optimizeJob.jobStatus?.message || 'Đang tối ưu lời giảng cho TTS...'} ({optimizeJob.jobStatus?.progress || 0}%)
                                        </div>
                                        <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                                            Chuẩn hóa nhịp điệu đọc, ngắt nghỉ dấu câu để giọng đọc nhân tạo hay nhất.
                                        </div>
                                    </div>
                                </div>
                                <button
                                    className="btn-stop"
                                    onClick={cancelOptimizeJob}
                                    style={{ padding: '6px 14px', fontSize: '0.85rem', flexShrink: 0 }}
                                >
                                    ⏹️ Hủy bỏ
                                </button>
                            </div>
                        )}

                        {/* Background Job Running Banner for Audio */}
                        {generateAllAudioJob.isRunning && (
                            <div style={{
                                margin: '14px 0',
                                padding: '12px 18px',
                                background: '#f0f9ff',
                                border: '1px solid #bae6fd',
                                borderRadius: '8px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '16px'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <span className="spinner" style={{ borderColor: '#0284c7', borderTopColor: 'transparent', width: 20, height: 20 }}></span>
                                    <div>
                                        <div style={{ fontWeight: 600, color: '#0369a1', fontSize: '0.95rem' }}>
                                            {generateAllAudioJob.jobStatus?.message || 'Đang tạo audio chạy nền...'} ({generateAllAudioJob.jobStatus?.progress || 0}%)
                                        </div>
                                        <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                                            Tác vụ đang chạy ngầm trên máy chủ. Bạn có thể chuyển tab hoặc làm việc khác mà không bị gián đoạn.
                                        </div>
                                    </div>
                                </div>
                                <button
                                    className="btn-stop"
                                    onClick={cancelAudioJob}
                                    style={{ padding: '6px 14px', fontSize: '0.85rem', flexShrink: 0 }}
                                >
                                    ⏹️ Hủy bỏ
                                </button>
                            </div>
                        )}

                        {/* Slide Cards */}
                        <div className="slide-cards">
                            {slides.map((slide) => {
                                const activeNote = getActiveNote(slide);
                                const hasNote = Boolean(activeNote?.trim());
                                const hasAudio = slide.audioStatus === 'done' && slide.audioUrl;
                                const isEditing = editingSlide === slide.index;
                                const isGenerating = generatingSlides.has(slide.index) || slide.audioStatus === 'generating';

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
                                                            placeholder="Nhập nội dung Speaker Note tại đây..."
                                                        />
                                                        <div className="edit-buttons">
                                                            <button className="btn-save" onClick={() => saveEdit(slide.index)}>💾 Lưu</button>
                                                            <button className="btn-cancel" onClick={cancelEdit}>Hủy</button>
                                                        </div>
                                                    </div>
                                                ) : hasNote ? (
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
                                                ) : (
                                                    <div className="note-content empty-note-placeholder" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', background: 'rgba(148, 163, 184, 0.05)', borderRadius: '6px', border: '1px dashed rgba(148, 163, 184, 0.3)' }}>
                                                        <p style={{ color: '#94a3b8', fontStyle: 'italic', margin: 0 }}>Chưa có Speaker Note cho slide này.</p>
                                                        <button
                                                            className="btn-secondary btn-sm"
                                                            onClick={() => startEdit(slide.index, '')}
                                                            style={{ fontSize: '0.82rem', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                                        >
                                                            ✏️ Thêm Note
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
                                                    title={!hasNote ? 'Cần thêm Speaker Note trước khi tạo audio' : undefined}
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

                        {/* No notes warning / Callout */}
                        {slidesWithNotes.length === 0 && (
                            <div className="empty-state" style={{ margin: '24px 0', padding: '32px 20px', background: 'rgba(30, 41, 59, 0.4)', border: '1px dashed rgba(148, 163, 184, 0.3)', borderRadius: 12 }}>
                                <span className="empty-icon" style={{ fontSize: '2.5rem' }}>✨</span>
                                <h3 style={{ marginTop: 12 }}>File PPTX chưa có Speaker Notes</h3>
                                <p style={{ maxWidth: 520, margin: '8px auto 16px', color: '#94a3b8' }}>
                                    Hệ thống cần lời giảng để tạo âm thanh cho bài giảng. Hãy nhấn <strong>"Tạo Lời Giảng"</strong> để AI đọc nội dung slide và tự động soạn kịch bản sư phạm cho bạn!
                                </p>
                                <button
                                    className="btn-generate-notes"
                                    onClick={() => setShowNotesOptionsModal(true)}
                                    disabled={isGeneratingNotes}
                                    style={{ margin: '0 auto' }}
                                >
                                    ✨ Tạo Lời Giảng Với AI Ngay
                                </button>
                            </div>
                        )}

                        {/* Speaker Notes Options Modal */}
                        {showNotesOptionsModal && (
                            <div className="modal-backdrop" onClick={() => setShowNotesOptionsModal(false)} style={{
                                position: 'fixed',
                                top: 0,
                                left: 0,
                                right: 0,
                                bottom: 0,
                                background: 'rgba(0, 0, 0, 0.65)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                zIndex: 1000,
                                backdropFilter: 'blur(4px)'
                            }}>
                                <div className="modal-content" onClick={e => e.stopPropagation()} style={{
                                    background: '#1e293b',
                                    borderRadius: 14,
                                    padding: '24px 28px',
                                    maxWidth: 520,
                                    width: '90%',
                                    border: '1px solid rgba(148, 163, 184, 0.2)',
                                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)'
                                }}>
                                    <h3 style={{ margin: '0 0 8px 0', color: '#f8fafc', fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span>✨</span> Tùy Chọn Tạo Lời Giảng Bằng AI
                                    </h3>
                                    <p style={{ color: '#94a3b8', fontSize: '0.88rem', margin: '0 0 20px 0' }}>
                                        Chọn phương thức tạo lời giảng phù hợp với bài thuyết trình của bạn:
                                    </p>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                        {/* Option 1: All slides */}
                                        <div
                                            onClick={() => startGenerateNotes('all')}
                                            style={{
                                                padding: '16px 18px',
                                                border: '2px solid rgba(148, 163, 184, 0.2)',
                                                borderRadius: 10,
                                                cursor: 'pointer',
                                                transition: 'all 0.2s',
                                                background: 'rgba(15, 23, 42, 0.6)',
                                            }}
                                            onMouseEnter={e => (e.currentTarget.style.borderColor = '#0284c7')}
                                            onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.2)')}
                                        >
                                            <div style={{ fontWeight: 600, color: '#f1f5f9', fontSize: '0.98rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <span>🎯 Tạo lại cho TẤT CẢ các slide ({slides.length} slide)</span>
                                                {slidesWithNotes.length > 0 && (
                                                    <span style={{ fontSize: '0.72rem', background: 'rgba(2, 132, 199, 0.2)', color: '#38bdf8', padding: '2px 8px', borderRadius: 999 }}>
                                                        Khuyên dùng
                                                    </span>
                                                )}
                                            </div>
                                            <div style={{ color: '#94a3b8', fontSize: '0.84rem', marginTop: 6, lineHeight: 1.45 }}>
                                                AI sẽ đọc đồng thời cả <strong>nội dung trên slide</strong> VÀ <strong>ghi chú hiện có (nếu có)</strong> để mở rộng, viết lại thành lời giảng chuẩn mực sư phạm (180 – 220 từ).
                                            </div>
                                        </div>

                                        {/* Option 2: Missing slides */}
                                        <div
                                            onClick={() => {
                                                if (slides.length - slidesWithNotes.length > 0) {
                                                    startGenerateNotes('missing');
                                                }
                                            }}
                                            style={{
                                                padding: '16px 18px',
                                                border: '2px solid rgba(148, 163, 184, 0.2)',
                                                borderRadius: 10,
                                                cursor: slides.length - slidesWithNotes.length === 0 ? 'not-allowed' : 'pointer',
                                                opacity: slides.length - slidesWithNotes.length === 0 ? 0.5 : 1,
                                                transition: 'all 0.2s',
                                                background: 'rgba(15, 23, 42, 0.6)',
                                            }}
                                            onMouseEnter={e => {
                                                if (slides.length - slidesWithNotes.length > 0) {
                                                    e.currentTarget.style.borderColor = '#10b981';
                                                }
                                            }}
                                            onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.2)')}
                                        >
                                            <div style={{ fontWeight: 600, color: '#f1f5f9', fontSize: '0.98rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <span>➕ Chỉ tạo cho các slide THIẾU ({slides.length - slidesWithNotes.length} slide)</span>
                                            </div>
                                            <div style={{ color: '#94a3b8', fontSize: '0.84rem', marginTop: 6, lineHeight: 1.45 }}>
                                                Chỉ soạn bài giảng cho các slide chưa có ghi chú. Giữ nguyên 100% nội dung của {slidesWithNotes.length} slide đã có.
                                            </div>
                                        </div>
                                    </div>

                                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 22 }}>
                                        <button
                                            className="btn-cancel"
                                            onClick={() => setShowNotesOptionsModal(false)}
                                            style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid rgba(148, 163, 184, 0.2)', background: 'transparent', color: '#94a3b8', cursor: 'pointer' }}
                                        >
                                            Đóng
                                        </button>
                                    </div>
                                </div>
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
                                            <label className="modal-label">📁 Chọn file văn bản (.txt):</label>
                                            <div className="file-upload-box">
                                                <input
                                                    type="file"
                                                    id="pptxTxtFileInput"
                                                    accept=".txt"
                                                    onChange={handleFileChange}
                                                    disabled={isImporting}
                                                    style={{ display: 'none' }}
                                                />
                                                <label htmlFor="pptxTxtFileInput" className="btn-select-file">
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
                        {/* Hidden input for Excel Import */}
                        <input
                            type="file"
                            ref={reviewImportInputRef}
                            accept=".xlsx,.xls"
                            onChange={handleImportReviewExcel}
                            style={{ display: 'none' }}
                        />

                        {/* Step Header with Tab Actions */}
                        <div className="step-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                            <div>
                                <h2>❓ Ngân Hàng Câu Hỏi</h2>
                                <p style={{ color: '#94a3b8', fontSize: '0.9rem', margin: '4px 0 0' }}>
                                    Tạo và quản lý câu hỏi ôn tập, câu hỏi tương tác H5P và câu hỏi tiếng Anh chuyên ngành từ nội dung bài giảng.
                                </p>
                            </div>
                            <div className="header-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                {activeQuestionTab === 'interactive' && interactiveQuestions.length > 0 && (
                                    <>
                                        <button className="btn-secondary btn-sm" onClick={handleExportInteractiveExcel}>
                                            📊 Xuất Excel
                                        </button>
                                        <button className="btn-secondary btn-sm" onClick={handleExportInteractiveWord}>
                                            📝 Xuất Word
                                        </button>
                                        <button className="btn-delete btn-sm" onClick={handleClearAllInteractive} style={{ padding: '6px 12px' }}>
                                            🗑️ Xóa tất cả
                                        </button>
                                    </>
                                )}

                                {activeQuestionTab === 'review' && (
                                    <>
                                        <button className="btn-secondary btn-sm" onClick={handleDownloadReviewTemplate} title="Tải template Excel chuẩn để nhập câu hỏi">
                                            📥 Tải file mẫu
                                        </button>
                                        <button className="btn-secondary btn-sm" onClick={() => reviewImportInputRef.current?.click()} disabled={isImportingReview}>
                                            {isImportingReview ? '⏳ Đang import...' : '📤 Import Excel'}
                                        </button>
                                        {reviewQuestions.length > 0 && (
                                            <>
                                                <button className="btn-secondary btn-sm" onClick={handleExportReviewExcel}>
                                                    📊 Xuất Excel
                                                </button>
                                                <button className="btn-secondary btn-sm" onClick={handleExportReviewWord}>
                                                    📝 Xuất Word
                                                </button>
                                                <button className="btn-primary btn-sm" onClick={handleExportReviewMoodleXml}>
                                                    📋 Xuất Moodle XML
                                                </button>
                                                <button className="btn-delete btn-sm" onClick={handleClearAllReview} style={{ padding: '6px 12px' }}>
                                                    🗑️ Xóa tất cả
                                                </button>
                                            </>
                                        )}
                                    </>
                                )}

                                {activeQuestionTab === 'english' && (
                                    <>
                                        {englishQuestions.length > 0 && (
                                            <>
                                                <button className="btn-secondary btn-sm" onClick={handleExportEnglishExcel}>
                                                    📊 Xuất Excel
                                                </button>
                                                <button className="btn-secondary btn-sm" onClick={handleExportEnglishWord}>
                                                    📝 Xuất Word
                                                </button>
                                                <button className="btn-primary btn-sm" onClick={handleExportEnglishMoodleXml}>
                                                    📋 Xuất Moodle XML
                                                </button>
                                                <button className="btn-delete btn-sm" onClick={handleClearAllEnglish} style={{ padding: '6px 12px' }}>
                                                    🗑️ Xóa tất cả
                                                </button>
                                            </>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Model Selector */}
                        <ModelSelector taskType="QUESTIONS" compact />

                        {/* Status Message */}
                        {questionMessage && (
                            <div className={`${questionMessage.type}-message`} style={{ margin: '14px 0', padding: '10px 16px', borderRadius: 8 }}>
                                {questionMessage.text}
                            </div>
                        )}

                        {/* 3-Tab Navigation */}
                        <div className="tabs" style={{ marginBottom: 20 }}>
                            <button
                                className={`tab ${activeQuestionTab === 'interactive' ? 'active' : ''}`}
                                onClick={() => setActiveQuestionTab('interactive')}
                            >
                                ⚡ Câu hỏi Tương tác ({interactiveQuestions.length}) {(isGeneratingInteractive || isAppendingInteractive) && '⏳'}
                            </button>
                            <button
                                className={`tab ${activeQuestionTab === 'review' ? 'active' : ''}`}
                                onClick={() => setActiveQuestionTab('review')}
                            >
                                📝 Câu hỏi Ôn tập ({reviewQuestions.length}) {(isGeneratingReview || isAppendingReview) && '⏳'}
                            </button>
                            <button
                                className={`tab ${activeQuestionTab === 'english' ? 'active' : ''}`}
                                onClick={() => setActiveQuestionTab('english')}
                            >
                                🇬🇧 Câu hỏi Tiếng Anh ({englishQuestions.length}) {(isGeneratingEnglish || isAppendingEnglish) && '⏳'}
                            </button>
                        </div>

                        {/* ════════════ TAB: REVIEW QUESTIONS (DEFAULT) ════════════ */}
                        {activeQuestionTab === 'review' && (
                            <div className="question-section">
                                <div className="question-config">
                                    <h3>📝 Cấu hình tạo câu hỏi ôn tập (Bloom Taxonomy)</h3>
                                    <p className="hint">
                                        Tạo ngân hàng câu hỏi trắc nghiệm theo 3 mức độ nhận thức Bloom (Biết, Hiểu, Vận dụng) bám sát nội dung bài giảng.
                                    </p>
                                    <div className="review-config-controls">
                                        <div className="review-level-inputs">
                                            <div className="level-input">
                                                <label>
                                                    <span className="level-badge level-know">Biết</span>
                                                    Mức độ 1
                                                </label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max="50"
                                                    value={reviewCounts.level1}
                                                    onChange={(e) => setReviewCounts({ ...reviewCounts, level1: +e.target.value })}
                                                />
                                            </div>
                                            <div className="level-input">
                                                <label>
                                                    <span className="level-badge level-understand">Hiểu</span>
                                                    Mức độ 2
                                                </label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max="50"
                                                    value={reviewCounts.level2}
                                                    onChange={(e) => setReviewCounts({ ...reviewCounts, level2: +e.target.value })}
                                                />
                                            </div>
                                            <div className="level-input">
                                                <label>
                                                    <span className="level-badge level-apply">Vận dụng</span>
                                                    Mức độ 3
                                                </label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max="50"
                                                    value={reviewCounts.level3}
                                                    onChange={(e) => setReviewCounts({ ...reviewCounts, level3: +e.target.value })}
                                                />
                                            </div>
                                        </div>
                                        <div className="review-actions">
                                            <button
                                                className="btn-primary"
                                                onClick={handleGenerateReview}
                                                disabled={isGeneratingReview || isAppendingReview || (reviewCounts.level1 + reviewCounts.level2 + reviewCounts.level3 === 0)}
                                            >
                                                {isGeneratingReview ? '🔄 Đang tạo...' : '🤖 Tạo Mới (Xóa cũ)'}
                                            </button>
                                            {reviewQuestions.length > 0 && (
                                                <button
                                                    className="btn-secondary"
                                                    onClick={handleAppendReview}
                                                    disabled={isGeneratingReview || isAppendingReview || (reviewCounts.level1 + reviewCounts.level2 + reviewCounts.level3 === 0)}
                                                >
                                                    {isAppendingReview ? '🔄 Đang thêm...' : '➕ Tạo Thêm (Giữ cũ)'}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {(isGeneratingReview || isAppendingReview || isImportingReview) && (
                                    <div className="generating-state" style={{ textAlign: 'center', padding: '32px 0' }}>
                                        <div className="loading-spinner"></div>
                                        <p style={{ marginTop: 12, fontWeight: 500 }}>
                                            {isImportingReview
                                                ? 'Đang import câu hỏi từ Excel...'
                                                : isAppendingReview
                                                    ? (appendReviewJob.jobStatus?.message || 'Đang thêm câu hỏi ôn tập chạy nền...')
                                                    : (reviewJob.jobStatus?.message || 'Đang tạo câu hỏi ôn tập theo chuẩn Bloom chạy nền...')}
                                        </p>
                                        <p className="hint" style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
                                            {reviewJob.isRunning && reviewJob.jobStatus?.progress !== undefined
                                                ? `Tiến độ: ${reviewJob.jobStatus.progress}% (Có thể chuyển tab khác, tác vụ vẫn tiếp tục chạy ngầm)`
                                                : appendReviewJob.isRunning && appendReviewJob.jobStatus?.progress !== undefined
                                                    ? `Tiến độ: ${appendReviewJob.jobStatus.progress}% (Có thể chuyển tab khác, tác vụ vẫn tiếp tục chạy ngầm)`
                                                    : `Tổng cấu hình: ${reviewCounts.level1 + reviewCounts.level2 + reviewCounts.level3} câu (Biết: ${reviewCounts.level1}, Hiểu: ${reviewCounts.level2}, Vận dụng: ${reviewCounts.level3})`}
                                        </p>
                                    </div>
                                )}

                                {!isGeneratingReview && !isAppendingReview && !isImportingReview && reviewQuestions.length > 0 && (
                                    <div className="questions-preview" style={{ marginTop: 20 }}>
                                        {/* Filter Tabs */}
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
                                            <h3 style={{ margin: 0 }}>Danh sách câu hỏi Ôn tập ({reviewQuestions.length})</h3>
                                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                                <button
                                                    className={`btn-sm ${reviewFilter === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
                                                    onClick={() => setReviewFilter('ALL')}
                                                >
                                                    Tất cả ({reviewQuestions.length})
                                                </button>
                                                <button
                                                    className={`btn-sm ${reviewFilter === 1 ? 'btn-primary' : 'btn-secondary'}`}
                                                    onClick={() => setReviewFilter(1)}
                                                >
                                                    Mức 1: Biết ({reviewQuestions.filter(q => q.level === 1).length})
                                                </button>
                                                <button
                                                    className={`btn-sm ${reviewFilter === 2 ? 'btn-primary' : 'btn-secondary'}`}
                                                    onClick={() => setReviewFilter(2)}
                                                >
                                                    Mức 2: Hiểu ({reviewQuestions.filter(q => q.level === 2).length})
                                                </button>
                                                <button
                                                    className={`btn-sm ${reviewFilter === 3 ? 'btn-primary' : 'btn-secondary'}`}
                                                    onClick={() => setReviewFilter(3)}
                                                >
                                                    Mức 3: Vận dụng ({reviewQuestions.filter(q => q.level === 3).length})
                                                </button>
                                            </div>
                                        </div>

                                        {/* Desktop Table */}
                                        <div className="questions-table-wrapper desktop-questions-table" style={{ overflowX: 'auto' }}>
                                            <table className="questions-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                                <thead>
                                                    <tr style={{ background: 'rgba(30,41,59,0.8)', borderBottom: '2px solid rgba(148,163,184,0.2)' }}>
                                                        <th style={{ width: '60px', padding: '10px 8px', textAlign: 'left' }}>STT</th>
                                                        <th style={{ width: '80px', padding: '10px 8px', textAlign: 'left' }}>Mức</th>
                                                        <th style={{ minWidth: '220px', padding: '10px 8px', textAlign: 'left' }}>Câu hỏi</th>
                                                        <th style={{ minWidth: '120px', padding: '10px 8px', textAlign: 'left' }}>A (Đúng)</th>
                                                        <th style={{ minWidth: '120px', padding: '10px 8px', textAlign: 'left' }}>B</th>
                                                        <th style={{ minWidth: '120px', padding: '10px 8px', textAlign: 'left' }}>C</th>
                                                        <th style={{ minWidth: '120px', padding: '10px 8px', textAlign: 'left' }}>D</th>
                                                        <th style={{ minWidth: '160px', padding: '10px 8px', textAlign: 'left' }}>Giải thích</th>
                                                        <th style={{ width: '90px', padding: '10px 8px', textAlign: 'center' }}>Thao tác</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {filteredReviewQuestions.map((q, idx) => (
                                                        <tr key={q.id || idx} style={{ borderBottom: '1px solid rgba(148,163,184,0.1)' }}>
                                                            <td style={{ padding: '8px', color: '#94a3b8' }}>{idx + 1}</td>
                                                            <td style={{ padding: '8px' }}>
                                                                <span style={{
                                                                    padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                                                                    background: q.level === 1 ? 'rgba(34,197,94,0.15)' : q.level === 2 ? 'rgba(59,130,246,0.15)' : 'rgba(249,115,22,0.15)',
                                                                    color: q.level === 1 ? '#22c55e' : q.level === 2 ? '#3b82f6' : '#f97316',
                                                                }}>
                                                                    {q.level === 1 ? 'Biết' : q.level === 2 ? 'Hiểu' : 'Vận dụng'}
                                                                </span>
                                                            </td>
                                                            <td style={{ padding: '8px' }}>
                                                                {editingReviewId === q.id ? (
                                                                    <input
                                                                        type="text"
                                                                        value={q.question}
                                                                        onChange={(e) => setReviewQuestions(prev =>
                                                                            prev.map(p => p.id === q.id ? { ...p, question: e.target.value } : p)
                                                                        )}
                                                                        style={{ width: '100%', padding: '4px 8px', borderRadius: 4, background: '#1e293b', border: '1px solid #475569', color: '#fff' }}
                                                                    />
                                                                ) : <span style={{ color: '#e2e8f0' }}>{q.question}</span>}
                                                            </td>
                                                            <td style={{ padding: '8px' }}>
                                                                {editingReviewId === q.id ? (
                                                                    <input
                                                                        type="text"
                                                                        value={q.correctAnswer}
                                                                        onChange={(e) => setReviewQuestions(prev =>
                                                                            prev.map(p => p.id === q.id ? { ...p, correctAnswer: e.target.value } : p)
                                                                        )}
                                                                        style={{ width: '100%', padding: '4px 8px', borderRadius: 4, background: '#1e293b', border: '1px solid #475569', color: '#22c55e' }}
                                                                    />
                                                                ) : <span style={{ color: '#22c55e', fontWeight: 500 }}>{q.correctAnswer}</span>}
                                                            </td>
                                                            <td style={{ padding: '8px' }}>
                                                                {editingReviewId === q.id ? (
                                                                    <input
                                                                        type="text"
                                                                        value={q.optionB}
                                                                        onChange={(e) => setReviewQuestions(prev =>
                                                                            prev.map(p => p.id === q.id ? { ...p, optionB: e.target.value } : p)
                                                                        )}
                                                                        style={{ width: '100%', padding: '4px 8px', borderRadius: 4, background: '#1e293b', border: '1px solid #475569', color: '#94a3b8' }}
                                                                    />
                                                                ) : <span style={{ color: '#94a3b8' }}>{q.optionB}</span>}
                                                            </td>
                                                            <td style={{ padding: '8px' }}>
                                                                {editingReviewId === q.id ? (
                                                                    <input
                                                                        type="text"
                                                                        value={q.optionC}
                                                                        onChange={(e) => setReviewQuestions(prev =>
                                                                            prev.map(p => p.id === q.id ? { ...p, optionC: e.target.value } : p)
                                                                        )}
                                                                        style={{ width: '100%', padding: '4px 8px', borderRadius: 4, background: '#1e293b', border: '1px solid #475569', color: '#94a3b8' }}
                                                                    />
                                                                ) : <span style={{ color: '#94a3b8' }}>{q.optionC}</span>}
                                                            </td>
                                                            <td style={{ padding: '8px' }}>
                                                                {editingReviewId === q.id ? (
                                                                    <input
                                                                        type="text"
                                                                        value={q.optionD}
                                                                        onChange={(e) => setReviewQuestions(prev =>
                                                                            prev.map(p => p.id === q.id ? { ...p, optionD: e.target.value } : p)
                                                                        )}
                                                                        style={{ width: '100%', padding: '4px 8px', borderRadius: 4, background: '#1e293b', border: '1px solid #475569', color: '#94a3b8' }}
                                                                    />
                                                                ) : <span style={{ color: '#94a3b8' }}>{q.optionD}</span>}
                                                            </td>
                                                            <td style={{ padding: '8px' }}>
                                                                {editingReviewId === q.id ? (
                                                                    <input
                                                                        type="text"
                                                                        value={q.explanation || ''}
                                                                        onChange={(e) => setReviewQuestions(prev =>
                                                                            prev.map(p => p.id === q.id ? { ...p, explanation: e.target.value } : p)
                                                                        )}
                                                                        style={{ width: '100%', padding: '4px 8px', borderRadius: 4, background: '#1e293b', border: '1px solid #475569', color: '#cbd5e1' }}
                                                                    />
                                                                ) : <span style={{ color: '#64748b', fontSize: 12 }}>{q.explanation || '-'}</span>}
                                                            </td>
                                                            <td style={{ padding: '8px', textAlign: 'center' }}>
                                                                <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                                                                    {editingReviewId === q.id ? (
                                                                        <button className="btn-save btn-sm" onClick={() => handleUpdateReview(q)} title="Lưu">💾</button>
                                                                    ) : (
                                                                        <button className="btn-edit btn-sm" onClick={() => setEditingReviewId(q.id)} title="Sửa">✏️</button>
                                                                    )}
                                                                    <button className="btn-delete btn-sm" onClick={() => handleDeleteReview(q.id)} title="Xóa">🗑️</button>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>

                                        {/* Mobile Review Cards */}
                                        <div className="mobile-review-cards">
                                            {filteredReviewQuestions.map((q) => (
                                                <div key={q.id} className="review-card-item">
                                                    <div className="review-card-top">
                                                        <span className="review-q-id">{q.questionId || q.id}</span>
                                                        <div className="review-card-btns">
                                                            {editingReviewId === q.id ? (
                                                                <button className="btn-save" onClick={() => handleUpdateReview(q)}>💾 Lưu</button>
                                                            ) : (
                                                                <button className="btn-edit" onClick={() => setEditingReviewId(q.id)}>✏️ Sửa</button>
                                                            )}
                                                            <button className="btn-delete" onClick={() => handleDeleteReview(q.id)}>🗑️ Xóa</button>
                                                        </div>
                                                    </div>
                                                    <div className="review-card-question">
                                                        {editingReviewId === q.id ? (
                                                            <textarea
                                                                value={q.question}
                                                                onChange={(e) => setReviewQuestions(prev =>
                                                                    prev.map(p => p.id === q.id ? { ...p, question: e.target.value } : p)
                                                                )}
                                                                className="edit-textarea"
                                                                rows={3}
                                                            />
                                                        ) : (
                                                            <div className="q-text-bold">{q.question}</div>
                                                        )}
                                                    </div>
                                                    <div className="review-card-answers">
                                                        <div className="review-ans-item correct">
                                                            <span className="ans-tag">A (Đúng):</span>
                                                            {editingReviewId === q.id ? (
                                                                <input
                                                                    type="text"
                                                                    value={q.correctAnswer}
                                                                    onChange={(e) => setReviewQuestions(prev =>
                                                                        prev.map(p => p.id === q.id ? { ...p, correctAnswer: e.target.value } : p)
                                                                    )}
                                                                    className="edit-input"
                                                                />
                                                            ) : (
                                                                <span>{q.correctAnswer}</span>
                                                            )}
                                                        </div>
                                                        <div className="review-ans-item">
                                                            <span className="ans-tag">B:</span>
                                                            {editingReviewId === q.id ? (
                                                                <input
                                                                    type="text"
                                                                    value={q.optionB}
                                                                    onChange={(e) => setReviewQuestions(prev =>
                                                                        prev.map(p => p.id === q.id ? { ...p, optionB: e.target.value } : p)
                                                                    )}
                                                                    className="edit-input"
                                                                />
                                                            ) : (
                                                                <span>{q.optionB}</span>
                                                            )}
                                                        </div>
                                                        <div className="review-ans-item">
                                                            <span className="ans-tag">C:</span>
                                                            {editingReviewId === q.id ? (
                                                                <input
                                                                    type="text"
                                                                    value={q.optionC}
                                                                    onChange={(e) => setReviewQuestions(prev =>
                                                                        prev.map(p => p.id === q.id ? { ...p, optionC: e.target.value } : p)
                                                                    )}
                                                                    className="edit-input"
                                                                />
                                                            ) : (
                                                                <span>{q.optionC}</span>
                                                            )}
                                                        </div>
                                                        <div className="review-ans-item">
                                                            <span className="ans-tag">D:</span>
                                                            {editingReviewId === q.id ? (
                                                                <input
                                                                    type="text"
                                                                    value={q.optionD}
                                                                    onChange={(e) => setReviewQuestions(prev =>
                                                                        prev.map(p => p.id === q.id ? { ...p, optionD: e.target.value } : p)
                                                                    )}
                                                                    className="edit-input"
                                                                />
                                                            ) : (
                                                                <span>{q.optionD}</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {!isGeneratingReview && !isAppendingReview && !isImportingReview && reviewQuestions.length === 0 && (
                                    <div className="empty-state" style={{ padding: '36px 0', textAlign: 'center', color: '#94a3b8' }}>
                                        <p style={{ fontSize: '1.05rem', margin: '0 0 10px' }}>Chưa có câu hỏi ôn tập.</p>
                                        <p style={{ fontSize: '0.88rem', margin: 0 }}>Hãy bấm "🤖 Tạo Mới (Xóa cũ)" để sinh câu hỏi tự động hoặc "📤 Import Excel" để tải lên danh sách có sẵn.</p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ════════════ TAB 2: INTERACTIVE QUESTIONS ════════════ */}
                        {activeQuestionTab === 'interactive' && (
                            <div className="question-section">
                                <div className="question-config">
                                    <h3>⚡ Câu hỏi Tương tác (H5P / Video / Interactive Slide)</h3>
                                    <p className="hint">
                                        Tạo các câu hỏi trắc nghiệm tương tác dạng Multiple Choice / Multiple Response kèm điểm số và phản hồi Đúng/Sai.
                                    </p>
                                    <div className="interactive-config-controls">
                                        <div className="level-input interactive-input-box">
                                            <label>
                                                <span className="level-badge level-know">Số lượng</span>
                                                Số câu hỏi
                                            </label>
                                            <input
                                                type="number"
                                                min="1"
                                                max="20"
                                                value={interactiveCount}
                                                onChange={(e) => setInteractiveCount(+e.target.value)}
                                            />
                                        </div>
                                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                            <button
                                                className="btn-primary"
                                                onClick={handleGenerateInteractive}
                                                disabled={isGeneratingInteractive || isAppendingInteractive || interactiveCount <= 0}
                                            >
                                                {isGeneratingInteractive ? '🔄 Đang tạo...' : '🤖 Tạo Câu Hỏi Tương Tác'}
                                            </button>
                                            {interactiveQuestions.length > 0 && (
                                                <button
                                                    className="btn-secondary"
                                                    onClick={handleAppendInteractive}
                                                    disabled={isGeneratingInteractive || isAppendingInteractive || interactiveCount <= 0}
                                                >
                                                    {isAppendingInteractive ? '🔄 Đang thêm...' : `➕ Thêm ${interactiveCount} Câu Hỏi Nữa`}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {(isGeneratingInteractive || isAppendingInteractive) && (
                                    <div className="generating-state" style={{ textAlign: 'center', padding: '32px 0' }}>
                                        <div className="loading-spinner"></div>
                                        <p style={{ marginTop: 12, fontWeight: 500 }}>
                                            {isAppendingInteractive
                                                ? (appendInteractiveJob.jobStatus?.message || 'Đang tạo thêm câu hỏi tương tác chạy nền...')
                                                : (interactiveJob.jobStatus?.message || 'Đang tạo câu hỏi tương tác H5P chạy nền...')}
                                        </p>
                                        <p className="hint" style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
                                            {interactiveJob.isRunning && interactiveJob.jobStatus?.progress !== undefined
                                                ? `Tiến độ: ${interactiveJob.jobStatus.progress}% (Có thể chuyển tab khác, tác vụ vẫn tiếp tục chạy ngầm)`
                                                : appendInteractiveJob.isRunning && appendInteractiveJob.jobStatus?.progress !== undefined
                                                    ? `Tiến độ: ${appendInteractiveJob.jobStatus.progress}% (Có thể chuyển tab khác, tác vụ vẫn tiếp tục chạy ngầm)`
                                                    : `Số lượng: ${interactiveCount} câu hỏi tương tác H5P`}
                                        </p>
                                    </div>
                                )}

                                {!isGeneratingInteractive && !isAppendingInteractive && interactiveQuestions.length > 0 && (
                                    <div className="questions-preview">
                                        <h3 style={{ marginBottom: 16 }}>Danh sách Câu hỏi Tương tác ({interactiveQuestions.length})</h3>
                                        <div className="questions-list" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                            {interactiveQuestions.map((q) => (
                                                <div key={q.id} className="question-card interactive-card">
                                                    <div className="question-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                                                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                                            <span className="question-type" style={{ padding: '2px 8px', borderRadius: 4, background: 'rgba(59,130,246,0.2)', color: '#3b82f6', fontWeight: 600, fontSize: 12 }}>
                                                                {q.questionType}
                                                            </span>
                                                            <span className="question-points" style={{ fontSize: 12, color: '#94a3b8' }}>{q.points} điểm</span>
                                                        </div>
                                                        <div className="question-actions" style={{ display: 'flex', gap: 6 }}>
                                                            {editingInteractiveId === q.id ? (
                                                                <button className="btn-save btn-sm" onClick={() => handleUpdateInteractive(q)}>💾 Lưu</button>
                                                            ) : (
                                                                <button className="btn-edit btn-sm" onClick={() => setEditingInteractiveId(q.id)}>✏️ Sửa</button>
                                                            )}
                                                            <button className="btn-delete btn-sm" onClick={() => handleDeleteInteractive(q.id)}>🗑️ Xóa</button>
                                                        </div>
                                                    </div>
                                                    {editingInteractiveId === q.id ? (
                                                        <textarea
                                                            value={q.questionText}
                                                            onChange={(e) => setInteractiveQuestions(prev =>
                                                                prev.map(p => p.id === q.id ? { ...p, questionText: e.target.value } : p)
                                                            )}
                                                            className="edit-textarea"
                                                            rows={2}
                                                            style={{ width: '100%', marginBottom: 12 }}
                                                        />
                                                    ) : (
                                                        <p className="question-text" style={{ fontSize: '1rem', fontWeight: 500, margin: '0 0 12px' }}>{q.questionText}</p>
                                                    )}
                                                    <div className="answers-list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                        {editingInteractiveId === q.id ? (
                                                            (q.answers || []).map((ans, i) => (
                                                                <div key={i} className={`answer ${ans.startsWith('*') ? 'correct' : ''}`} style={{ display: 'flex', alignItems: 'center' }}>
                                                                    <span>{ans.startsWith('*') ? '✅' : '⬜'}</span>
                                                                    <input
                                                                        type="text"
                                                                        value={ans.replace(/^\*/, '')}
                                                                        onChange={(e) => {
                                                                            const prefix = ans.startsWith('*') ? '*' : '';
                                                                            const newAnswers = [...q.answers];
                                                                            newAnswers[i] = prefix + e.target.value;
                                                                            setInteractiveQuestions(prev =>
                                                                                prev.map(p => p.id === q.id ? { ...p, answers: newAnswers } : p)
                                                                            );
                                                                        }}
                                                                        style={{ flex: 1, marginLeft: 8, padding: '4px 8px', borderRadius: 4, background: '#1e293b', border: '1px solid #475569', color: '#fff' }}
                                                                    />
                                                                </div>
                                                            ))
                                                        ) : (
                                                            parseAnswers(q.answers || []).map((a, i) => (
                                                                <div key={i} className={`answer ${a.isCorrect ? 'correct' : ''}`}>
                                                                    {a.isCorrect ? '✅' : '⬜'} {a.text}
                                                                </div>
                                                            ))
                                                        )}
                                                    </div>
                                                    <div className="feedback" style={{ marginTop: 12, fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                        <div className="feedback-correct" style={{ color: '#22c55e' }}>✅ Phản hồi đúng: {q.correctFeedback}</div>
                                                        <div className="feedback-incorrect" style={{ color: '#ef4444' }}>❌ Phản hồi sai: {q.incorrectFeedback}</div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {!isGeneratingInteractive && !isAppendingInteractive && interactiveQuestions.length === 0 && (
                                    <div className="empty-state" style={{ padding: '36px 0', textAlign: 'center', color: '#94a3b8' }}>
                                        <p style={{ fontSize: '1.05rem', margin: '0 0 10px' }}>Chưa có câu hỏi tương tác.</p>
                                        <p style={{ fontSize: '0.88rem', margin: 0 }}>Hãy bấm "🤖 Tạo Câu Hỏi Tương Tác" để sinh câu hỏi phục vụ kiểm tra nhanh.</p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ════════════ TAB 3: ENGLISH QUESTIONS ════════════ */}
                        {activeQuestionTab === 'english' && (
                            <div className="question-section">
                                <div className="question-config english-config-container">
                                    <h3>🇬🇧 Ngân Hàng Câu Hỏi Tiếng Anh (Ngành Ngôn Ngữ Anh)</h3>
                                    <p className="hint">
                                        Tạo câu hỏi chuyên sâu ngành Ngôn ngữ Anh & Ngôn ngữ học, hỗ trợ đa dạng cấu trúc xuất chuẩn Moodle XML (Multiple Choice, Matching, Cloze, Short Answer, True/False, Essay).
                                    </p>

                                    <div className="english-config-top-row">
                                        {/* Cột 1: Số lượng câu hỏi theo mức độ Bloom */}
                                        <div className="english-config-col bloom-col">
                                            <label className="config-section-label">📊 Số lượng câu hỏi theo mức độ Bloom:</label>
                                            <div className="level-inputs">
                                                <div className="level-input">
                                                    <label>
                                                        <span className="level-badge level-know">Biết</span>
                                                        Mức độ 1
                                                    </label>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        max="50"
                                                        value={englishLevelCounts.level1}
                                                        onChange={(e) => setEnglishLevelCounts({ ...englishLevelCounts, level1: +e.target.value })}
                                                    />
                                                </div>
                                                <div className="level-input">
                                                    <label>
                                                        <span className="level-badge level-understand">Hiểu</span>
                                                        Mức độ 2
                                                    </label>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        max="50"
                                                        value={englishLevelCounts.level2}
                                                        onChange={(e) => setEnglishLevelCounts({ ...englishLevelCounts, level2: +e.target.value })}
                                                    />
                                                </div>
                                                <div className="level-input">
                                                    <label>
                                                        <span className="level-badge level-apply">Vận dụng</span>
                                                        Mức độ 3
                                                    </label>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        max="50"
                                                        value={englishLevelCounts.level3}
                                                        onChange={(e) => setEnglishLevelCounts({ ...englishLevelCounts, level3: +e.target.value })}
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Cột 2: Phân môn chuyên sâu */}
                                        <div className="english-config-col discipline-col">
                                            <label className="config-section-label">🎯 Phân môn chuyên sâu:</label>
                                            <div className="discipline-input-card">
                                                <label className="discipline-sublabel">
                                                    <span className="level-badge level-discipline">Chuyên đề</span>
                                                    Lĩnh vực học thuật
                                                </label>
                                                <select
                                                    value={selectedSubDiscipline}
                                                    onChange={(e) => setSelectedSubDiscipline(e.target.value)}
                                                    className="select-subdiscipline"
                                                >
                                                    {SUB_DISCIPLINE_OPTIONS.map(opt => (
                                                        <option key={opt.id} value={opt.id}>{opt.label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Hàng 2: Chọn dạng câu hỏi */}
                                    <div className="english-config-section types-selector-box">
                                        <div className="types-header">
                                            <label className="types-label">
                                                Các dạng câu hỏi ({selectedQuestionTypes.length}/{QUESTION_TYPE_OPTIONS.length} đã chọn):
                                            </label>
                                            <div className="types-quick-actions">
                                                <button
                                                    type="button"
                                                    className="btn-text-action"
                                                    onClick={selectAllQuestionTypes}
                                                >
                                                    ✓ Chọn tất cả
                                                </button>
                                                <span className="divider">|</span>
                                                <button
                                                    type="button"
                                                    className="btn-text-action"
                                                    onClick={deselectAllQuestionTypes}
                                                >
                                                    ✗ Bỏ chọn
                                                </button>
                                            </div>
                                        </div>

                                        <div className="type-checkboxes-grid three-columns">
                                            {QUESTION_TYPE_OPTIONS.map(type => {
                                                const isChecked = selectedQuestionTypes.includes(type.id);
                                                return (
                                                    <label
                                                        key={type.id}
                                                        className={`type-checkbox-card ${isChecked ? 'checked' : ''}`}
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            toggleQuestionType(type.id);
                                                        }}
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            checked={isChecked}
                                                            onChange={() => {}}
                                                        />
                                                        <span className="type-icon">{type.icon}</span>
                                                        <span className="type-label-text">{type.label}</span>
                                                        <span className="type-badge-mini">{type.badge}</span>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div className="config-actions-row" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
                                        <button
                                            className="btn-primary"
                                            onClick={handleGenerateEnglish}
                                            disabled={isGeneratingEnglish || isAppendingEnglish || selectedQuestionTypes.length === 0 || (englishLevelCounts.level1 + englishLevelCounts.level2 + englishLevelCounts.level3 === 0)}
                                        >
                                            {isGeneratingEnglish ? '🔄 Đang tạo...' : '🤖 Tạo Mới Câu Hỏi Tiếng Anh'}
                                        </button>
                                        {englishQuestions.length > 0 && (
                                            <button
                                                className="btn-secondary"
                                                onClick={handleAppendEnglish}
                                                disabled={isGeneratingEnglish || isAppendingEnglish || selectedQuestionTypes.length === 0 || (englishLevelCounts.level1 + englishLevelCounts.level2 + englishLevelCounts.level3 === 0)}
                                            >
                                                {isAppendingEnglish ? '⏳ Đang thêm...' : `➕ Thêm ${englishLevelCounts.level1 + englishLevelCounts.level2 + englishLevelCounts.level3} Câu Hỏi Nữa`}
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {(isGeneratingEnglish || isAppendingEnglish) && (
                                    <div className="generating-state" style={{ textAlign: 'center', padding: '32px 0' }}>
                                        <div className="loading-spinner"></div>
                                        <p style={{ marginTop: 12, fontWeight: 500 }}>
                                            {isAppendingEnglish
                                                ? (appendEnglishJob.jobStatus?.message || 'Đang thêm câu hỏi tiếng Anh chuyên ngành chạy nền...')
                                                : (englishJob.jobStatus?.message || 'Đang tạo câu hỏi tiếng Anh chuyên ngành với AI chạy nền...')}
                                        </p>
                                        <p className="hint" style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
                                            {englishJob.isRunning && englishJob.jobStatus?.progress !== undefined
                                                ? `Tiến độ: ${englishJob.jobStatus.progress}% (Có thể chuyển tab khác, tác vụ vẫn tiếp tục chạy ngầm)`
                                                : appendEnglishJob.isRunning && appendEnglishJob.jobStatus?.progress !== undefined
                                                    ? `Tiến độ: ${appendEnglishJob.jobStatus.progress}% (Có thể chuyển tab khác, tác vụ vẫn tiếp tục chạy ngầm)`
                                                    : `Tổng số: ${englishLevelCounts.level1 + englishLevelCounts.level2 + englishLevelCounts.level3} câu (Biết: ${englishLevelCounts.level1}, Hiểu: ${englishLevelCounts.level2}, Vận dụng: ${englishLevelCounts.level3})`}
                                        </p>
                                    </div>
                                )}

                                {!isGeneratingEnglish && !isAppendingEnglish && englishQuestions.length > 0 && (
                                    <div className="questions-preview" style={{ marginTop: 20 }}>
                                        <div className="preview-header-english" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                                            <h3>Danh sách câu hỏi Tiếng Anh ({englishQuestions.length})</h3>
                                            <div className="preview-actions" style={{ display: 'flex', gap: 8 }}>
                                                <button className="btn-secondary btn-sm" onClick={handleExportEnglishExcel}>
                                                    📊 Xuất Excel
                                                </button>
                                                <button className="btn-secondary btn-sm" onClick={handleExportEnglishWord}>
                                                    📝 Xuất Word
                                                </button>
                                                <button className="btn-primary btn-sm" onClick={handleExportEnglishMoodleXml}>
                                                    📋 Xuất Moodle XML
                                                </button>
                                            </div>
                                        </div>

                                        <div className="questions-list" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                            {englishQuestions.map((q) => {
                                                const isEditing = editingEnglishId === q.id;
                                                let parsedData: any = {};
                                                try {
                                                    parsedData = JSON.parse(q.dataJson);
                                                } catch {
                                                    parsedData = {};
                                                }

                                                return (
                                                    <QuestionErrorBoundary key={q.id} fallbackText={`Lỗi hiển thị câu ${q.questionOrder || ''}`}>
                                                        <div className="question-card english-card">
                                                            <div className="question-header">
                                                                <span className={`badge-qtype badge-${String(q.questionType).toLowerCase()}`}>
                                                                    {q.questionType}
                                                                </span>
                                                                {q.subDiscipline && (
                                                                    <span className="badge-subdiscipline">
                                                                        {typeof q.subDiscipline === 'object' ? JSON.stringify(q.subDiscipline) : String(q.subDiscipline)}
                                                                    </span>
                                                                )}
                                                                <span className="question-points">{typeof q.points === 'object' ? JSON.stringify(q.points) : (q.points || 1)} điểm</span>
                                                                <div className="question-actions">
                                                                    {isEditing ? (
                                                                        <button className="btn-save" onClick={() => handleUpdateEnglish(q)}>💾 Lưu</button>
                                                                    ) : (
                                                                        <button className="btn-edit" onClick={() => setEditingEnglishId(q.id)}>✏️ Sửa</button>
                                                                    )}
                                                                    <button className="btn-delete" onClick={() => handleDeleteEnglish(q.id)}>🗑️ Xóa</button>
                                                                </div>
                                                            </div>

                                                            {isEditing ? (
                                                                <textarea
                                                                    value={q.questionText}
                                                                    onChange={(e) => setEnglishQuestions(prev =>
                                                                        prev.map(p => p.id === q.id ? { ...p, questionText: e.target.value } : p)
                                                                    )}
                                                                    className="edit-textarea"
                                                                />
                                                            ) : (
                                                                <p className="question-text">
                                                                    <strong>{q.title ? `${typeof q.title === 'object' ? JSON.stringify(q.title) : q.title}: ` : ''}</strong>
                                                                    {q.questionType === 'CLOZE'
                                                                        ? formatClozePrompt(typeof q.questionText === 'object' ? JSON.stringify(q.questionText) : String(q.questionText ?? ''))
                                                                        : (typeof q.questionText === 'object' ? JSON.stringify(q.questionText) : String(q.questionText ?? ''))}
                                                                </p>
                                                            )}

                                                            {/* MC / MR Options */}
                                                            {(q.questionType === 'MC' || q.questionType === 'MR') && Array.isArray(parsedData.options) && (
                                                                <div className="english-options-list">
                                                                    {parsedData.options.map((opt: any, optIdx: number) => {
                                                                        const isCorrect = opt.fraction > 0 || opt.isCorrect;
                                                                        const optText = typeof opt === 'object' && opt.text !== undefined
                                                                            ? (typeof opt.text === 'object' ? JSON.stringify(opt.text) : String(opt.text))
                                                                            : (typeof opt === 'object' ? JSON.stringify(opt) : String(opt ?? ''));
                                                                        return (
                                                                            <div key={optIdx} className={`english-option-item ${isCorrect ? 'correct' : ''}`}>
                                                                                <span className="opt-letter">{String.fromCharCode(65 + optIdx)}</span>
                                                                                <span className="opt-text">{optText}</span>
                                                                                {isCorrect && <span className="opt-check">✓ Đáp án đúng</span>}
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}

                                                            {/* Matching Pairs */}
                                                            {(q.questionType === 'MATCH' || q.questionType === 'MATCHING') && Array.isArray(parsedData.pairs) && (
                                                                <div className="matching-preview-box">
                                                                    <table className="matching-table">
                                                                        <thead>
                                                                            <tr>
                                                                                <th>Thuật ngữ / Nội dung</th>
                                                                                <th></th>
                                                                                <th>Khái niệm / Ghép đôi</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody>
                                                                            {parsedData.pairs.map((pair: any, pIdx: number) => {
                                                                                const leftVal = pair.left ?? pair.subquestion ?? pair.question ?? '';
                                                                                const rightVal = pair.right ?? pair.answer ?? pair.match ?? '';
                                                                                return (
                                                                                    <tr key={pIdx}>
                                                                                        <td className="match-sub">
                                                                                            {typeof leftVal === 'object' ? JSON.stringify(leftVal) : String(leftVal)}
                                                                                        </td>
                                                                                        <td className="match-arrow">➔</td>
                                                                                        <td className="match-ans">
                                                                                            {typeof rightVal === 'object' ? JSON.stringify(rightVal) : String(rightVal)}
                                                                                        </td>
                                                                                    </tr>
                                                                                );
                                                                            })}
                                                                        </tbody>
                                                                    </table>
                                                                </div>
                                                            )}

                                                            {/* Cloze Text */}
                                                            {q.questionType === 'CLOZE' && (
                                                                <div className="cloze-preview-box">
                                                                    <div className="cloze-tag">📝 Mô phỏng câu hỏi điền khuyết (Cloze):</div>
                                                                    {renderClozeVisual(typeof (parsedData.clozeText || q.questionText) === 'object' ? JSON.stringify(parsedData.clozeText || q.questionText) : String(parsedData.clozeText || q.questionText))}
                                                                </div>
                                                            )}

                                                            {/* Short Answer */}
                                                            {q.questionType === 'SHORTANSWER' && (
                                                                <div className="shortanswer-preview-box">
                                                                    <span className="sa-label">🔑 Đáp án chấp nhận:</span>
                                                                    <div className="sa-keys">
                                                                        {(Array.isArray(parsedData.acceptableAnswers)
                                                                            ? parsedData.acceptableAnswers
                                                                            : (parsedData.acceptableAnswers ? [parsedData.acceptableAnswers] : (parsedData.correctAnswer ? [parsedData.correctAnswer] : []))
                                                                        ).map((ans: any, aIdx: number) => (
                                                                            <span key={aIdx} className="sa-key-chip">
                                                                                {typeof ans === 'object' ? JSON.stringify(ans) : String(ans ?? '')}
                                                                            </span>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {/* True/False */}
                                                            {q.questionType === 'TRUEFALSE' && (
                                                                <div className="truefalse-preview-box">
                                                                    <span className="tf-label">Mệnh đề:</span>
                                                                    <span className={`tf-badge ${String(parsedData.correctAnswer).toLowerCase() === 'true' || parsedData.correctAnswer === true ? 'true' : 'false'}`}>
                                                                        {String(parsedData.correctAnswer).toLowerCase() === 'true' || parsedData.correctAnswer === true ? 'TRUE (ĐÚNG)' : 'FALSE (SAI)'}
                                                                    </span>
                                                                    {parsedData.feedbackTrue && (
                                                                        <span className="tf-feedback" style={{ marginLeft: '10px', fontSize: '0.85rem', color: '#64748b' }}>
                                                                            (Giải thích: {parsedData.correctAnswer ? parsedData.feedbackTrue : parsedData.feedbackFalse})
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            )}

                                                            {/* Essay */}
                                                            {q.questionType === 'ESSAY' && (
                                                                <div className="essay-preview-box">
                                                                    <span className="essay-label">📋 Hướng dẫn chấm / Barem (Grader Info):</span>
                                                                    {renderEssayRubric(parsedData)}
                                                                </div>
                                                            )}

                                                            {/* Explanation */}
                                                            {(q.explanation || isEditing) && (
                                                                <div className="review-card-exp">
                                                                    <span className="exp-label">💡 Giải thích học thuật:</span>
                                                                    {isEditing ? (
                                                                        <input
                                                                            type="text"
                                                                            value={typeof q.explanation === 'object' ? JSON.stringify(q.explanation) : (q.explanation || '')}
                                                                            onChange={(e) => setEnglishQuestions(prev =>
                                                                                prev.map(p => p.id === q.id ? { ...p, explanation: e.target.value } : p)
                                                                            )}
                                                                            className="edit-input"
                                                                        />
                                                                    ) : (
                                                                        <span>{typeof q.explanation === 'object' ? JSON.stringify(q.explanation) : q.explanation}</span>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </QuestionErrorBoundary>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {!isGeneratingEnglish && !isAppendingEnglish && englishQuestions.length === 0 && (
                                    <div className="empty-state" style={{ padding: '36px 0', textAlign: 'center', color: '#94a3b8' }}>
                                        <p style={{ fontSize: '1.05rem', margin: '0 0 10px' }}>Chưa có câu hỏi tiếng Anh.</p>
                                        <p style={{ fontSize: '0.88rem', margin: 0 }}>Hãy chọn các dạng câu hỏi và bấm "🤖 Tạo Mới Câu Hỏi Tiếng Anh" để bắt đầu.</p>
                                    </div>
                                )}
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
