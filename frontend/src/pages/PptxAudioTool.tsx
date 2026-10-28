import { useState, useEffect, useRef, Component, type ReactNode, type ErrorInfo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, API_BASE_URL } from '../lib/api';
import { filenameFromDisposition } from '../lib/download-filename';
import { useJobPolling } from '../hooks/useJobPolling';
import { TTSSelector } from '../components/TTSSelector';
import { ModelSelector } from '../components/ModelSelector';
import { ImageCropModal } from '../components/ImageCropModal';
import { ExamManagerPanel } from '../components/exam/ExamManagerPanel';
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
    { id: 'TRUEFALSE', label: 'True / False (Đúng / Sai)', badge: 'TF', icon: '⚖️' },
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

interface BulletItem {
    emoji: string;
    point: string;
    description: string;
}

interface ParsedSlide {
    index: number;
    originalSlideIndex?: number | null;
    slideType?: string;
    layoutType?: string;
    title: string;
    content: string[];
    optimizedContent?: BulletItem[] | null;
    interactiveData?: string | null;
    noteFull: string;
    noteEN: string;
    noteVN: string;
    hasDual: boolean;
    imageUrl?: string | null;
    audioUrl: string | null;
    audioDuration: number | null;
    audioStatus: string;
    errorMessage: string | null;
    extraAudioUrl?: string | null;
    extraAudioName?: string | null;
    extraAudioDuration?: number | null;
}

interface PptxSubject {
    id: string;
    name: string;
    description?: string | null;
    major?: string | null;
    majorName?: string | null;
    expertiseArea?: string | null;
    courseName?: string | null;
    targetAudience?: string | null;
    institutionType?: string | null;
    language: string;
    additionalContext?: string | null;
    sessionCount?: number;
    createdAt?: string;
}

interface PptxTemplateItem {
    id: string;
    name: string;
    description?: string | null;
    titleBgUrl?: string | null;
    contentBgUrl?: string | null;
    isDefault?: boolean;
    isSystem?: boolean;
}

interface SessionData {
    id: string;
    pptxSubjectId?: string | null;
    pptxSubject?: PptxSubject | null;
    lessonTitle?: string | null;
    contextText?: string | null;
    contextFileName?: string | null;
    fileName: string;
    language: string;
    status: string;
    slides: ParsedSlide[];
    totalSlides: number;
    questionsJson?: string | null;
}

// 4-step workflow (Step 3 combines Slide Workspace & Export matching Step 5 of Lesson Editor)
const STEPS = [
    { key: 'upload', label: 'Môn học & Bài', icon: '📚' },
    { key: 'audio', label: 'Lời giảng & Audio', icon: '🎙️' },
    { key: 'download', label: 'Slide & Xuất học liệu', icon: '📊' },
    { key: 'questions', label: 'Ngân hàng Câu hỏi', icon: '❓' },
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
    const [uploadStatusText, setUploadStatusText] = useState('');
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
    const [notesLanguage, setNotesLanguage] = useState<'vi' | 'en'>('vi');
    const [notesJobId, setNotesJobId] = useState<string | null>(null);
    const [optimizeJobId, setOptimizeJobId] = useState<string | null>(null);

    // Speaker notes Import state
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [importFileName, setImportFileName] = useState('');
    const [parsedImportNotes, setParsedImportNotes] = useState<Array<{ slideIndex: number; speakerNote: string }>>([]);
    const [isImporting, setIsImporting] = useState(false);
    const [importMessage, setImportMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // ─────────────────────────────────────────────────────────────
    // Questions 4-Tab State
    // ─────────────────────────────────────────────────────────────
    const [activeQuestionTab, setActiveQuestionTab] = useState<'review' | 'interactive' | 'english' | 'exam'>('review');
    const [showSubjectExamPanel, setShowSubjectExamPanel] = useState<boolean>(false);
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
        'MC', 'MR', 'MATCH', 'CLOZE', 'TRUEFALSE'
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

    // Session history & Subject state
    interface SessionHistoryItem {
        id: string;
        pptxSubjectId?: string | null;
        pptxSubject?: { id: string; name: string; major?: string | null; language?: string } | null;
        lessonTitle?: string;
        hasContext?: boolean;
        contextFileName?: string | null;
        contextLength?: number;
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

    // Subjects state (Independent Subjects for PPTX Tool)
    const [subjects, setSubjects] = useState<PptxSubject[]>([]);
    const [selectedSubjectFilter, setSelectedSubjectFilter] = useState<string>('ALL'); // 'ALL' | 'UNCATEGORIZED' | subjectId
    const [showSubjectModal, setShowSubjectModal] = useState(false);
    const [editingSubject, setEditingSubject] = useState<PptxSubject | null>(null);
    const [subjectForm, setSubjectForm] = useState({
        name: '',
        major: '',
        targetAudience: 'Sinh viên đại học',
        institutionType: 'UNIVERSITY',
        language: 'vi',
        description: '',
        additionalContext: '',
    });
    const [isSavingSubject, setIsSavingSubject] = useState(false);

    // New Lesson creation state (Step 0)
    const [newLessonSubjectId, setNewLessonSubjectId] = useState<string>('');
    const [newLessonTitle, setNewLessonTitle] = useState<string>('');
    const [newLessonContextText, setNewLessonContextText] = useState<string>('');
    const [newLessonContextFileName, setNewLessonContextFileName] = useState<string>('');
    const [isExtractingNewContext, setIsExtractingNewContext] = useState(false);
    const [showNewLessonContextBox, setShowNewLessonContextBox] = useState(false);

    // Active Session Context & Metadata Modal state
    const [showContextModal, setShowContextModal] = useState(false);
    const [metaLessonTitle, setMetaLessonTitle] = useState('');
    const [metaSubjectId, setMetaSubjectId] = useState<string>('');
    const [metaContextText, setMetaContextText] = useState('');
    const [metaContextFileName, setMetaContextFileName] = useState<string | null>(null);
    const [isSavingMeta, setIsSavingMeta] = useState(false);
    const [isUploadingSessionContext, setIsUploadingSessionContext] = useState(false);
    const sessionContextFileInputRef = useRef<HTMLInputElement>(null);

    // SCORM 1.2, H5P & Slide Workspace state (Step 3 / activeStep === 2)
    const [templates, setTemplates] = useState<PptxTemplateItem[]>([]);
    const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
    const [exportBgOption, setExportBgOption] = useState<'tuaf_clean' | 'tuaf_full' | 'custom' | 'minimal'>('tuaf_clean');
    const [exportTheme, setExportTheme] = useState<'light' | 'dark'>('light');
    const [isExportingScorm, setIsExportingScorm] = useState(false);
    const [isExportingH5p, setIsExportingH5p] = useState(false);
    const [isExportingMoodleXml, setIsExportingMoodleXml] = useState(false);
    const [showMoodleGuide, setShowMoodleGuide] = useState(false);

    // Slide Card Editing & AI Regeneration states (Step 3)
    const [editingContentSlideIndex, setEditingContentSlideIndex] = useState<number | null>(null);
    const [editingTitle, setEditingTitle] = useState('');
    const [editingBullets, setEditingBullets] = useState<BulletItem[]>([]);
    const [editingRawContent, setEditingRawContent] = useState('');
    const [savingContent, setSavingContent] = useState(false);
    const [regeneratingContentSlides, setRegeneratingContentSlides] = useState<Set<number>>(new Set());
    const [regeneratingImageSlides, setRegeneratingImageSlides] = useState<Set<number>>(new Set());
    const [cropModalImageSrc, setCropModalImageSrc] = useState<string | null>(null);
    const [cropModalSlideIndex, setCropModalSlideIndex] = useState<number | null>(null);
    const [uploadingSlideImage, setUploadingSlideImage] = useState<number | null>(null);
    const [uploadingExtraAudioSlide, setUploadingExtraAudioSlide] = useState<number | null>(null);
    const [deletingSlideIndex, setDeletingSlideIndex] = useState<number | null>(null);
    const [movingSlideIndex, setMovingSlideIndex] = useState<number | null>(null);
    const [generatingInteractionSlide, setGeneratingInteractionSlide] = useState<number | null>(null);
    const [expandedInteractiveSlide, setExpandedInteractiveSlide] = useState<number | null>(null);
    const [editingInteractiveSlide, setEditingInteractiveSlide] = useState<number | null>(null);
    const [editingInteractiveForm, setEditingInteractiveForm] = useState<any | null>(null);
    const [savingInteractiveSlide, setSavingInteractiveSlide] = useState(false);

    // Add Theory Slide Modal state
    const [showAddSlideModal, setShowAddSlideModal] = useState(false);
    const [addSlideInsertAfter, setAddSlideInsertAfter] = useState<number>(-1);
    const [newSlideTitle, setNewSlideTitle] = useState('');
    const [newSlideContent, setNewSlideContent] = useState('');
    const [newSlideSpeakerNote, setNewSlideSpeakerNote] = useState('');
    const [creatingSlide, setCreatingSlide] = useState(false);

    // Interactive Slide Configuration Modal state
    const [interactiveConfigModal, setInteractiveConfigModal] = useState<{
        isOpen: boolean;
        mode: 'insert' | 'configure';
        insertAfterIndex: number;
        targetSlideIndex: number | null;
        generationMode: 'generate_new' | 'extract_existing';
        sourceType: 'slide_range' | 'custom_text' | 'audio' | 'image';
        fromSlideIndex: number;
        toSlideIndex: number;
        customContent: string;
        imageBase64: string;
        imageFileName: string;
        audioFile: File | null;
        existingAudioUrl: string;
        existingAudioName: string;
        selectedQuestionTypes: string[];
        questionCount: number;
        passScore: number;
        fallbackSlideIndex: number;
        allowContinueWithoutPass: boolean;
        slideTitle: string;
    }>({
        isOpen: false,
        mode: 'insert',
        insertAfterIndex: 1,
        targetSlideIndex: null,
        generationMode: 'generate_new',
        sourceType: 'slide_range',
        fromSlideIndex: 1,
        toSlideIndex: 1,
        customContent: '',
        imageBase64: '',
        imageFileName: '',
        audioFile: null,
        existingAudioUrl: '',
        existingAudioName: '',
        selectedQuestionTypes: ['MC', 'TF', 'MR'],
        questionCount: 5,
        passScore: 4,
        fallbackSlideIndex: 1,
        allowContinueWithoutPass: false,
        slideTitle: 'Điểm kiểm tra kiến thức',
    });
    const [isSubmittingInteractiveModal, setIsSubmittingInteractiveModal] = useState(false);
    const [isExtractingInteractiveFile, setIsExtractingInteractiveFile] = useState(false);
    const [extractedInteractiveFileName, setExtractedInteractiveFileName] = useState<string>('');

    // Load session on mount if sessionId exists, always load subjects, history, and templates
    useEffect(() => {
        loadSubjects();
        loadSessionHistory();
        loadTemplates();
        if (paramSessionId) {
            loadSession(paramSessionId);
        }
    }, [paramSessionId]);

    const loadSubjects = async () => {
        try {
            const res = await api.get('/pptx-audio-tool/subjects');
            const list: PptxSubject[] = res.data || [];
            setSubjects(list);
            if (!newLessonSubjectId && list.length > 0) {
                setNewLessonSubjectId(list[0].id);
            }
        } catch (error) {
            console.error('Error loading PPTX subjects:', error);
        }
    };

    const loadTemplates = async () => {
        try {
            const res = await api.get('/pptx-audio-tool/templates/list');
            const list: PptxTemplateItem[] = res.data || [];
            setTemplates(list);
            const def = list.find(t => t.isDefault) || list[0];
            if (def) setSelectedTemplateId(def.id);
        } catch (error) {
            console.error('Error loading PPTX templates:', error);
        }
    };

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
            setMetaLessonTitle(res.data.lessonTitle || res.data.fileName?.replace(/\.pptx$/i, '') || '');
            setMetaSubjectId(res.data.pptxSubjectId || '');
            setMetaContextText(res.data.contextText || '');
            setMetaContextFileName(res.data.contextFileName || null);
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

    const openCreateSubjectModal = () => {
        setEditingSubject(null);
        setSubjectForm({
            name: '',
            major: '',
            targetAudience: 'Sinh viên đại học',
            institutionType: 'UNIVERSITY',
            language: 'vi',
            description: '',
            additionalContext: '',
        });
        setShowSubjectModal(true);
    };

    const openEditSubjectModal = (sub: PptxSubject, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        setEditingSubject(sub);
        setSubjectForm({
            name: sub.name || '',
            major: sub.major || sub.majorName || sub.expertiseArea || '',
            targetAudience: sub.targetAudience || 'Sinh viên đại học',
            institutionType: sub.institutionType || 'UNIVERSITY',
            language: sub.language || 'vi',
            description: sub.description || '',
            additionalContext: sub.additionalContext || '',
        });
        setShowSubjectModal(true);
    };

    const handleSaveSubject = async () => {
        if (!subjectForm.name.trim()) {
            alert('Vui lòng nhập tên môn học.');
            return;
        }
        try {
            setIsSavingSubject(true);
            if (editingSubject) {
                await api.put(`/pptx-audio-tool/subjects/${editingSubject.id}`, subjectForm);
            } else {
                const res = await api.post('/pptx-audio-tool/subjects', subjectForm);
                if (res.data?.id) {
                    setSelectedSubjectFilter(res.data.id);
                    setNewLessonSubjectId(res.data.id);
                }
            }
            await loadSubjects();
            await loadSessionHistory();
            if (sessionId) await loadSession(sessionId);
            setShowSubjectModal(false);
        } catch (err: any) {
            alert(err.response?.data?.message || 'Không thể lưu môn học.');
        } finally {
            setIsSavingSubject(false);
        }
    };

    const handleDeleteSubject = async (sub: PptxSubject, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        if (!confirm(`Xóa môn học "${sub.name}"? Các bài học bên trong sẽ được giữ lại ở mục "Chưa phân loại".`)) return;
        try {
            await api.delete(`/pptx-audio-tool/subjects/${sub.id}`);
            if (selectedSubjectFilter === sub.id) setSelectedSubjectFilter('ALL');
            if (newLessonSubjectId === sub.id) setNewLessonSubjectId('');
            await loadSubjects();
            await loadSessionHistory();
        } catch (err: any) {
            alert(err.response?.data?.message || 'Không thể xóa môn học.');
        }
    };

    const handleExtractNewLessonContextFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try {
            setIsExtractingNewContext(true);
            setShowNewLessonContextBox(true);
            const formData = new FormData();
            formData.append('file', file);
            const res = await api.post('/pptx-audio-tool/extract-context-file', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            const extractedText = res.data?.text || '';
            const fName = res.data?.fileName || file.name;
            setNewLessonContextText(prev =>
                prev.trim()
                    ? `${prev.trim()}\n\n--- [Tài liệu: ${fName}] ---\n${extractedText}`
                    : extractedText
            );
            setNewLessonContextFileName(prev =>
                prev ? `${prev}, ${fName}` : fName
            );
        } catch (err: any) {
            alert(err.response?.data?.message || 'Không thể trích xuất nội dung từ file tài liệu.');
        } finally {
            setIsExtractingNewContext(false);
        }
    };

    const openSessionContextModal = () => {
        if (!session) return;
        setMetaLessonTitle(session.lessonTitle || session.fileName?.replace(/\.pptx$/i, '') || '');
        setMetaSubjectId(session.pptxSubjectId || '');
        setMetaContextText(session.contextText || '');
        setMetaContextFileName(session.contextFileName || null);
        setShowContextModal(true);
    };

    const handleUploadSessionContextFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file || !sessionId) return;
        try {
            setIsUploadingSessionContext(true);
            const formData = new FormData();
            formData.append('file', file);
            formData.append('mode', metaContextText.trim() ? 'append' : 'replace');
            const res = await api.post(`/pptx-audio-tool/${sessionId}/context-file`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            setMetaContextText(res.data?.contextText || '');
            setMetaContextFileName(res.data?.contextFileName || file.name);
            await loadSession(sessionId);
            await loadSessionHistory();
        } catch (err: any) {
            alert(err.response?.data?.message || 'Không thể tải lên file tài liệu ngữ cảnh.');
        } finally {
            setIsUploadingSessionContext(false);
        }
    };

    const handleSaveSessionMeta = async () => {
        if (!sessionId) return;
        try {
            setIsSavingMeta(true);
            const res = await api.put(`/pptx-audio-tool/${sessionId}/meta`, {
                lessonTitle: metaLessonTitle.trim() || undefined,
                pptxSubjectId: metaSubjectId || null,
                contextText: metaContextText,
                contextFileName: metaContextText.trim() ? metaContextFileName : null,
            });
            setSession(res.data);
            await loadSubjects();
            await loadSessionHistory();
            setShowContextModal(false);
        } catch (err: any) {
            alert(err.response?.data?.message || 'Không thể lưu thông tin bài học.');
        } finally {
            setIsSavingMeta(false);
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
    // STEP 1: UPLOAD (Direct upload for <= 25MB, Chunked Upload for > 25MB to bypass Cloudflare 100MB limit)
    // ═══════════════════════════════════════════════════════════════
    const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB per chunk

    const handleUpload = async (file: File) => {
        if (!file.name.endsWith('.pptx')) {
            alert('Chỉ hỗ trợ file .pptx');
            return;
        }

        const effectiveSubjectId =
            newLessonSubjectId ||
            (selectedSubjectFilter !== 'ALL' && selectedSubjectFilter !== 'UNCATEGORIZED'
                ? selectedSubjectFilter
                : '');
        const effectiveLessonTitle = newLessonTitle.trim() || file.name.replace(/\.pptx$/i, '');

        try {
            setIsUploading(true);
            setUploadProgress(5);

            let resData: any;

            if (file.size <= 25 * 1024 * 1024) {
                // File nhỏ (<= 25MB): Upload 1 request thông thường
                setUploadStatusText('Đang tải file bài giảng lên...');
                const formData = new FormData();
                formData.append('file', file);
                if (effectiveSubjectId) formData.append('pptxSubjectId', effectiveSubjectId);
                if (effectiveLessonTitle) formData.append('lessonTitle', effectiveLessonTitle);
                if (newLessonContextText.trim()) formData.append('contextText', newLessonContextText.trim());
                if (newLessonContextFileName) formData.append('contextFileName', newLessonContextFileName);

                const res = await api.post('/pptx-audio-tool/upload', formData, {
                    headers: { 'Content-Type': 'multipart/form-data' },
                    onUploadProgress: (e) => {
                        if (e.total) {
                            setUploadProgress(Math.round((e.loaded / e.total) * 85) + 5);
                        }
                    },
                });
                resData = res.data;
            } else {
                // File lớn (> 25MB): Tải phân đoạn 10MB/mảnh để bypass Cloudflare 100MB limit & chống rớt mạng
                const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
                const fileSizeMb = (file.size / (1024 * 1024)).toFixed(1);
                console.log(`[Chunked Upload] ${file.name} (${fileSizeMb} MB) -> ${totalChunks} chunks`);

                setUploadStatusText(`Đang khởi tạo tải phân đoạn (${fileSizeMb} MB)...`);
                const initRes = await api.post('/pptx-audio-tool/upload-chunk/init', {
                    fileName: file.name,
                    fileSize: file.size,
                    totalChunks,
                });
                const { uploadId } = initRes.data;

                // Tải lần lượt từng chunk với cơ chế retry tối đa 3 lần
                for (let i = 0; i < totalChunks; i++) {
                    const start = i * CHUNK_SIZE;
                    const end = Math.min(file.size, start + CHUNK_SIZE);
                    const chunkBlob = file.slice(start, end);

                    const chunkFormData = new FormData();
                    chunkFormData.append('chunk', chunkBlob, `chunk_${i}.tmp`);
                    chunkFormData.append('uploadId', uploadId);
                    chunkFormData.append('chunkIndex', String(i));

                    let attempts = 0;
                    let success = false;
                    let lastErr: any = null;

                    while (attempts < 3 && !success) {
                        try {
                            attempts++;
                            setUploadStatusText(`Đang tải phần ${i + 1}/${totalChunks} (${Math.round((i / totalChunks) * 100)}%)...`);
                            await api.post('/pptx-audio-tool/upload-chunk', chunkFormData, {
                                headers: { 'Content-Type': 'multipart/form-data' },
                            });
                            success = true;
                        } catch (err: any) {
                            lastErr = err;
                            console.warn(`[Chunked Upload] Retry chunk ${i + 1}/${totalChunks} (attempt ${attempts}):`, err);
                            await new Promise((r) => setTimeout(r, 1000 * attempts));
                        }
                    }

                    if (!success) {
                        throw new Error(`Tải phần ${i + 1}/${totalChunks} thất bại sau 3 lần thử. ${lastErr?.message || ''}`);
                    }

                    // Tiến độ upload các mảnh từ 10% đến 85%
                    const progressPercent = Math.round(10 + ((i + 1) / totalChunks) * 75);
                    setUploadProgress(progressPercent);
                }

                // Hoàn tất và ghép các mảnh trên server
                setUploadProgress(90);
                setUploadStatusText('Đang ghép các phần và bóc tách slide PowerPoint...');
                const completeRes = await api.post('/pptx-audio-tool/upload-chunk/complete', {
                    uploadId,
                    fileName: file.name,
                    totalChunks,
                    pptxSubjectId: effectiveSubjectId || undefined,
                    lessonTitle: effectiveLessonTitle || undefined,
                    contextText: newLessonContextText.trim() || undefined,
                    contextFileName: newLessonContextFileName || undefined,
                });
                resData = completeRes.data;
            }

            setUploadProgress(100);
            setUploadStatusText('Hoàn tất!');
            setNewLessonTitle('');
            setNewLessonContextText('');
            setNewLessonContextFileName('');
            setShowNewLessonContextBox(false);
            setSessionId(resData.sessionId);
            setSlides(resData.slides || []);
            setSession(resData);
            setReviewQuestions([]);
            setInteractiveQuestions([]);
            setEnglishQuestions([]);
            navigate(`/pptx-audio-tool/${resData.sessionId}`);
            await loadSession(resData.sessionId);
            setActiveStep(1); // Auto-advance to audio step
            loadSubjects();
            loadSessionHistory(); // Refresh history
        } catch (error: any) {
            console.error('Upload failed:', error);
            const msg = error.response?.status === 413
                ? 'Dung lượng file vượt quá giới hạn tải lên (mã 413). Vui lòng thử lại.'
                : (error.response?.data?.message || error.message);
            alert(`Upload thất bại: ${msg}`);
        } finally {
            setIsUploading(false);
            setUploadProgress(0);
            setUploadStatusText('');
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
        setLanguage(lang);
        try {
            await api.put(`/pptx-audio-tool/${sessionId}/language`, { language: lang });
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
                language: language,
            });
            setSlides(prev => prev.map(s => s.index === slideIndex ? { ...s, ...res.data } : s));
            setEditingSlide(null);
            setEditedNote('');
        } catch (error) {
            console.error('Error updating note:', error);
        }
    };

    const startGenerateNotes = async (mode: 'all' | 'missing', targetLang: 'vi' | 'en' = notesLanguage) => {
        if (!sessionId) return;
        try {
            setIsGeneratingNotes(true);
            setShowNotesOptionsModal(false);
            setLanguage(targetLang);
            const res = await api.post(`/pptx-audio-tool/${sessionId}/speaker-notes/generate`, {
                mode,
                language: targetLang,
            });
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
    // STEP 3: DOWNLOAD & EXPORT (PPTX, SCORM 1.2, H5P)
    // ═══════════════════════════════════════════════════════════════
    const triggerNativeDownload = (ticketPath: string) => {
        const fullUrl = ticketPath.startsWith('http')
            ? ticketPath
            : `${API_BASE_URL}${ticketPath.replace(/^\/api/, '')}`;
        const link = document.createElement('a');
        link.href = fullUrl;
        link.rel = 'noopener';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

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
            const baseTitle = session?.lessonTitle || session?.fileName?.replace(/\.pptx$/i, '') || 'presentation';
            a.download = `${baseTitle}_with_audio.pptx`;
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

    const handleExportScorm = async () => {
        if (!sessionId) return;
        try {
            setIsExportingScorm(true);
            const res = await api.post(`/pptx-audio-tool/${sessionId}/export/scorm/ticket`, {
                templateId: selectedTemplateId || undefined,
                bgOption: exportBgOption,
                theme: exportTheme,
            });
            if (res.data?.url) {
                triggerNativeDownload(res.data.url);
            }
        } catch (error: any) {
            console.error('Error exporting SCORM:', error);
            alert(`Xuất SCORM thất bại: ${error.response?.data?.message || error.message}`);
        } finally {
            setIsExportingScorm(false);
        }
    };

    const handleExportH5p = async () => {
        if (!sessionId) return;
        try {
            setIsExportingH5p(true);
            const res = await api.post(`/pptx-audio-tool/${sessionId}/export/h5p/ticket`, {
                templateId: selectedTemplateId || undefined,
                bgOption: exportBgOption,
                theme: exportTheme,
            });
            if (res.data?.url) {
                triggerNativeDownload(res.data.url);
            }
        } catch (error: any) {
            console.error('Error exporting H5P:', error);
            alert(`Xuất H5P thất bại: ${error.response?.data?.message || error.message}`);
        } finally {
            setIsExportingH5p(false);
        }
    };

    const handleExportMoodleXml = async () => {
        if (!sessionId) return;
        try {
            setIsExportingMoodleXml(true);
            const res = await api.get(`/pptx-audio-tool/${sessionId}/export/moodle-xml`, {
                responseType: 'blob',
            });
            const disposition = res.headers?.['content-disposition'] || res.headers?.['Content-Disposition'];
            const baseTitle = session?.lessonTitle || session?.fileName?.replace(/\.pptx$/i, '') || 'lesson';
            const filename = filenameFromDisposition(disposition, `${baseTitle}_moodle_quiz.xml`, '.xml');
            const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/xml; charset=utf-8' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (error: any) {
            console.error('Error exporting Moodle XML:', error);
            alert(`Xuất Moodle Quiz XML thất bại: ${error.response?.data?.message || error.message}`);
        } finally {
            setIsExportingMoodleXml(false);
        }
    };

    // ═══════════════════════════════════════════════════════════════
    // STEP 3: SLIDE WORKSPACE HANDLERS (MATCHING STEP 5 GENERATE PPTX)
    // ═══════════════════════════════════════════════════════════════

    const parseBulletsFromSlide = (slide: ParsedSlide): BulletItem[] => {
        if (Array.isArray(slide.optimizedContent) && slide.optimizedContent.length > 0) {
            return slide.optimizedContent;
        }
        if (Array.isArray(slide.content) && slide.content.length > 0) {
            return slide.content.map(line => {
                const str = String(line || '').trim();
                const colonIdx = str.indexOf(':');
                if (colonIdx > 0 && colonIdx < 60) {
                    return {
                        emoji: '•',
                        point: str.substring(0, colonIdx).trim(),
                        description: str.substring(colonIdx + 1).trim(),
                    };
                }
                return {
                    emoji: '•',
                    point: str,
                    description: '',
                };
            });
        }
        return [];
    };

    const parseInteractiveData = (slide: ParsedSlide): any | null => {
        if (!slide.interactiveData) return null;
        try {
            return typeof slide.interactiveData === 'string'
                ? JSON.parse(slide.interactiveData)
                : slide.interactiveData;
        } catch {
            return null;
        }
    };

    const startEditingSlideContent = (slide: ParsedSlide) => {
        const bullets = parseBulletsFromSlide(slide);
        setEditingContentSlideIndex(slide.index);
        setEditingTitle(slide.title || '');
        setEditingRawContent(Array.isArray(slide.content) ? slide.content.join('\n') : '');
        setEditingBullets(
            bullets.length > 0
                ? bullets.map(b => ({ ...b }))
                : [{ emoji: '📌', point: '', description: '' }],
        );
    };

    const cancelEditingSlideContent = () => {
        setEditingContentSlideIndex(null);
        setEditingTitle('');
        setEditingBullets([]);
        setEditingRawContent('');
    };

    const updateEditingBullet = (index: number, field: keyof BulletItem, value: string) => {
        setEditingBullets(prev => prev.map((b, i) => (i === index ? { ...b, [field]: value } : b)));
    };

    const addEditingBullet = () => {
        setEditingBullets(prev => [...prev, { emoji: '📌', point: '', description: '' }]);
    };

    const removeEditingBullet = (index: number) => {
        if (editingBullets.length <= 1) return;
        setEditingBullets(prev => prev.filter((_, i) => i !== index));
    };

    const saveSlideContent = async (slideIndex: number) => {
        if (!sessionId) return;
        try {
            setSavingContent(true);
            const validBullets = editingBullets.filter(b => b.point.trim() || b.description.trim());
            const res = await api.put(`/pptx-audio-tool/${sessionId}/slides/${slideIndex}/content`, {
                title: editingTitle,
                content: editingRawContent,
                optimizedContent: validBullets.length > 0 ? validBullets : null,
            });
            setSlides(prev => prev.map(s => (s.index === slideIndex ? { ...s, ...res.data } : s)));
            setEditingContentSlideIndex(null);
        } catch (err: any) {
            alert(err.response?.data?.message || 'Không thể lưu nội dung slide.');
        } finally {
            setSavingContent(false);
        }
    };

    const handleChangeSlideLayout = async (slideIndex: number, newLayout: string) => {
        if (!sessionId) return;
        const autoSlideType = newLayout === 'checkpoint_gate'
            ? 'checkpoint_quiz'
            : (newLayout === 'audio_lab' ? 'interactive_audio' : 'content');
        setSlides(prev =>
            prev.map(s => (s.index === slideIndex ? { ...s, layoutType: newLayout, slideType: autoSlideType } : s)),
        );
        try {
            await api.put(`/pptx-audio-tool/${sessionId}/slides/${slideIndex}/content`, {
                layoutType: newLayout,
                slideType: autoSlideType,
            });
        } catch (err) {
            console.error('Failed to update slide layout:', err);
        }
    };

    const handleRegenerateSlideContent = async (slideIndex: number) => {
        if (!sessionId) return;
        try {
            setRegeneratingContentSlides(prev => new Set(prev).add(slideIndex));
            const res = await api.post(`/pptx-audio-tool/${sessionId}/slides/${slideIndex}/regenerate-content`);
            setSlides(prev => prev.map(s => (s.index === slideIndex ? { ...s, ...res.data } : s)));
        } catch (err: any) {
            alert(err.response?.data?.message || 'Không thể tạo nội dung slide bằng AI.');
        } finally {
            setRegeneratingContentSlides(prev => {
                const next = new Set(prev);
                next.delete(slideIndex);
                return next;
            });
        }
    };

    const handleRegenerateSlideImage = async (slideIndex: number) => {
        if (!sessionId) return;
        try {
            setRegeneratingImageSlides(prev => new Set(prev).add(slideIndex));
            const res = await api.post(`/pptx-audio-tool/${sessionId}/slides/${slideIndex}/regenerate-image`);
            setSlides(prev =>
                prev.map(s =>
                    s.index === slideIndex
                        ? { ...s, ...res.data, imageUrl: res.data.imageUrl ? `${res.data.imageUrl}?t=${Date.now()}` : null }
                        : s,
                ),
            );
        } catch (err: any) {
            alert(err.response?.data?.message || 'Không thể tạo lại hình ảnh bằng AI.');
        } finally {
            setRegeneratingImageSlides(prev => {
                const next = new Set(prev);
                next.delete(slideIndex);
                return next;
            });
        }
    };

    const handleSelectImageForCrop = (slideIndex: number, file: File) => {
        const reader = new FileReader();
        reader.onload = () => {
            setCropModalImageSrc(reader.result as string);
            setCropModalSlideIndex(slideIndex);
        };
        reader.readAsDataURL(file);
    };

    const handleUploadCroppedImage = async (croppedBlob: Blob) => {
        if (cropModalSlideIndex === null || !sessionId) return;
        const slideIndex = cropModalSlideIndex;
        setCropModalImageSrc(null);
        setCropModalSlideIndex(null);

        try {
            setUploadingSlideImage(slideIndex);
            const formData = new FormData();
            formData.append('image', croppedBlob, `slide_${slideIndex + 1}_cropped.png`);
            const res = await api.post(
                `/pptx-audio-tool/${sessionId}/slides/${slideIndex}/upload-image`,
                formData,
                { headers: { 'Content-Type': 'multipart/form-data' } },
            );
            setSlides(prev =>
                prev.map(s =>
                    s.index === slideIndex
                        ? { ...s, imageUrl: `${res.data.imageUrl}?t=${Date.now()}` }
                        : s,
                ),
            );
        } catch (err: any) {
            alert(err.response?.data?.message || 'Không thể tải ảnh lên.');
        } finally {
            setUploadingSlideImage(null);
        }
    };

    const handleUploadExtraAudio = async (slideIndex: number, file: File) => {
        if (!sessionId) return;
        try {
            setUploadingExtraAudioSlide(slideIndex);
            const formData = new FormData();
            formData.append('audio', file);
            const res = await api.post(
                `/pptx-audio-tool/${sessionId}/slides/${slideIndex}/extra-audio`,
                formData,
                { headers: { 'Content-Type': 'multipart/form-data' } },
            );
            setSlides(prev =>
                prev.map(s =>
                    s.index === slideIndex
                        ? {
                              ...s,
                              extraAudioUrl: `${res.data.extraAudioUrl}?t=${Date.now()}`,
                              extraAudioName: res.data.extraAudioName || file.name,
                          }
                        : s,
                ),
            );
        } catch (err: any) {
            alert(err.response?.data?.message || 'Không thể tải audio mẫu lên.');
        } finally {
            setUploadingExtraAudioSlide(null);
        }
    };

    const handleDeleteExtraAudio = async (slideIndex: number) => {
        if (!sessionId || !confirm('Xóa file âm thanh mẫu của slide này?')) return;
        try {
            await api.delete(`/pptx-audio-tool/${sessionId}/slides/${slideIndex}/extra-audio`);
            setSlides(prev =>
                prev.map(s =>
                    s.index === slideIndex
                        ? { ...s, extraAudioUrl: null, extraAudioName: null, extraAudioDuration: null }
                        : s,
                ),
            );
        } catch (err: any) {
            alert(err.response?.data?.message || 'Không thể xóa audio mẫu.');
        }
    };

    const openAddSlideModal = (insertAfter: number = -1) => {
        setAddSlideInsertAfter(insertAfter);
        setNewSlideTitle('');
        setNewSlideContent('');
        setNewSlideSpeakerNote('');
        setShowAddSlideModal(true);
    };

    const handleCreateSlide = async () => {
        if (!sessionId) return;
        try {
            setCreatingSlide(true);
            const payload: any = {
                title: newSlideTitle.trim() || undefined,
                content: newSlideContent.trim(),
                speakerNote: newSlideSpeakerNote.trim(),
                slideType: 'content',
                layoutType: 'split_standard',
            };
            if (addSlideInsertAfter >= 0) {
                payload.insertAfterIndex = addSlideInsertAfter;
            }
            const res = await api.post(`/pptx-audio-tool/${sessionId}/slides`, payload);
            if (res.data?.slides) {
                setSlides(res.data.slides);
            } else {
                await reloadSlidesOnly(sessionId);
            }
            await loadSessionHistory();
            setShowAddSlideModal(false);
        } catch (err: any) {
            alert(err.response?.data?.message || 'Không thể thêm slide mới.');
        } finally {
            setCreatingSlide(false);
        }
    };

    const handleDeleteSlide = async (slideIndex: number) => {
        if (!sessionId) return;
        if (slides.length <= 1) {
            alert('Không thể xóa slide duy nhất trong bài giảng.');
            return;
        }
        if (!confirm(`Bạn có chắc chắn muốn xóa Slide ${slideIndex + 1}? Các slide phía sau sẽ tự động đánh lại số thứ tự.`)) {
            return;
        }
        try {
            setDeletingSlideIndex(slideIndex);
            const res = await api.delete(`/pptx-audio-tool/${sessionId}/slides/${slideIndex}`);
            if (res.data?.slides) {
                setSlides(res.data.slides);
            } else {
                await reloadSlidesOnly(sessionId);
            }
            await loadSessionHistory();
        } catch (err: any) {
            alert(err.response?.data?.message || 'Không thể xóa slide.');
        } finally {
            setDeletingSlideIndex(null);
        }
    };

    const handleMoveSlide = async (slideIndex: number, direction: 'up' | 'down') => {
        if (!sessionId) return;
        try {
            setMovingSlideIndex(slideIndex);
            const res = await api.post(`/pptx-audio-tool/${sessionId}/slides/${slideIndex}/move`, { direction });
            if (Array.isArray(res.data)) {
                setSlides(res.data);
            } else {
                await reloadSlidesOnly(sessionId);
            }
        } catch (err: any) {
            alert(err.response?.data?.message || 'Không thể di chuyển slide.');
        } finally {
            setMovingSlideIndex(null);
        }
    };

    // Interactive Slide Config Modal Handlers
    const openInteractiveModalForInsert = (insertAfterOneBased: number = -1) => {
        const effectiveAfter = insertAfterOneBased >= 0 ? insertAfterOneBased : slides.length;
        const defaultTo = Math.max(1, effectiveAfter);
        const defaultFrom = Math.max(1, defaultTo - 2);
        setExtractedInteractiveFileName('');
        setInteractiveConfigModal({
            isOpen: true,
            mode: 'insert',
            insertAfterIndex: insertAfterOneBased,
            targetSlideIndex: null,
            generationMode: 'generate_new',
            sourceType: 'slide_range',
            fromSlideIndex: defaultFrom,
            toSlideIndex: defaultTo,
            customContent: '',
            imageBase64: '',
            imageFileName: '',
            audioFile: null,
            existingAudioUrl: '',
            existingAudioName: '',
            selectedQuestionTypes: ['MC', 'TF', 'MR'],
            questionCount: 5,
            passScore: 4,
            fallbackSlideIndex: defaultFrom,
            allowContinueWithoutPass: false,
            slideTitle: `Điểm kiểm tra kiến thức (Sau Slide ${defaultTo})`,
        });
    };

    const openInteractiveModalForSlide = (slide: ParsedSlide) => {
        const parsed = parseInteractiveData(slide);
        const oneBased = slide.index + 1;
        const defaultTo = Math.max(1, oneBased - 1);
        const defaultFrom = Math.max(1, defaultTo - 2);
        setExtractedInteractiveFileName('');
        setInteractiveConfigModal({
            isOpen: true,
            mode: 'configure',
            insertAfterIndex: slide.index,
            targetSlideIndex: slide.index,
            generationMode: 'generate_new',
            sourceType: slide.extraAudioUrl ? 'audio' : 'slide_range',
            fromSlideIndex: defaultFrom,
            toSlideIndex: defaultTo,
            customContent: Array.isArray(slide.content) ? slide.content.join('\n') : '',
            imageBase64: '',
            imageFileName: '',
            audioFile: null,
            existingAudioUrl: slide.extraAudioUrl || '',
            existingAudioName: slide.extraAudioName || '',
            selectedQuestionTypes: ['MC', 'TF', 'MR'],
            questionCount: parsed?.totalQuestions || parsed?.questions?.length || 5,
            passScore: parsed?.passScore ?? 4,
            fallbackSlideIndex: parsed?.fallbackSlideIndex ?? defaultFrom,
            allowContinueWithoutPass: parsed?.allowContinueWithoutPass === true,
            slideTitle: slide.title || `Điểm kiểm tra kiến thức (Slide ${oneBased})`,
        });
    };

    const handleExtractInteractiveDocFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try {
            setIsExtractingInteractiveFile(true);
            const formData = new FormData();
            formData.append('file', file);
            const res = await api.post('/pptx-audio-tool/extract-context-file', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            const text = res.data?.text || '';
            setExtractedInteractiveFileName(res.data?.fileName || file.name);
            setInteractiveConfigModal(prev => ({
                ...prev,
                customContent: prev.customContent.trim()
                    ? `${prev.customContent.trim()}\n\n${text}`
                    : text,
            }));
        } catch (err: any) {
            alert(err.response?.data?.message || 'Không thể đọc file tài liệu.');
        } finally {
            setIsExtractingInteractiveFile(false);
        }
    };

    const handleSelectInteractiveImage = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            setInteractiveConfigModal(prev => ({
                ...prev,
                imageBase64: reader.result as string,
                imageFileName: file.name,
            }));
        };
        reader.readAsDataURL(file);
    };

    const toggleInteractiveQuestionType = (qType: string) => {
        setInteractiveConfigModal(prev => {
            const exists = prev.selectedQuestionTypes.includes(qType);
            if (exists && prev.selectedQuestionTypes.length <= 1) return prev;
            return {
                ...prev,
                selectedQuestionTypes: exists
                    ? prev.selectedQuestionTypes.filter(t => t !== qType)
                    : [...prev.selectedQuestionTypes, qType],
            };
        });
    };

    const handleSubmitInteractiveConfigModal = async () => {
        if (!sessionId) return;
        try {
            setIsSubmittingInteractiveModal(true);
            let targetIndex = interactiveConfigModal.targetSlideIndex;

            // Step 1: If inserting a new slide, create it first
            if (interactiveConfigModal.mode === 'insert') {
                const isAudioSource = interactiveConfigModal.sourceType === 'audio' && (interactiveConfigModal.audioFile || interactiveConfigModal.existingAudioUrl);
                const payload: any = {
                    title: interactiveConfigModal.slideTitle.trim() || 'Điểm kiểm tra kiến thức',
                    content: interactiveConfigModal.customContent.trim() || `Hoạt động tương tác kiểm tra kiến thức từ Slide ${interactiveConfigModal.fromSlideIndex} đến Slide ${interactiveConfigModal.toSlideIndex}.`,
                    speakerNote: 'Hãy hoàn thành bài tập tương tác trên màn hình trước khi tiếp tục nội dung tiếp theo.',
                    slideType: isAudioSource ? 'interactive_audio' : 'checkpoint_quiz',
                    layoutType: isAudioSource ? 'audio_lab' : 'checkpoint_gate',
                };
                if (interactiveConfigModal.insertAfterIndex >= 0) {
                    payload.insertAfterIndex = interactiveConfigModal.insertAfterIndex;
                }
                const createRes = await api.post(`/pptx-audio-tool/${sessionId}/slides`, payload);
                targetIndex = createRes.data?.slide?.index ?? (slides.length);
            }

            if (targetIndex === null || targetIndex === undefined) {
                throw new Error('Không xác định được slide đích.');
            }

            setGeneratingInteractionSlide(targetIndex);

            // Step 2: Upload audio file if teacher selected one in the modal
            if (interactiveConfigModal.audioFile) {
                const formData = new FormData();
                formData.append('audio', interactiveConfigModal.audioFile);
                await api.post(
                    `/pptx-audio-tool/${sessionId}/slides/${targetIndex}/extra-audio`,
                    formData,
                    { headers: { 'Content-Type': 'multipart/form-data' } },
                );
            }

            // Step 3: Call AI to generate interactive questions
            const isAudioActivity = interactiveConfigModal.sourceType === 'audio' || Boolean(interactiveConfigModal.audioFile || interactiveConfigModal.existingAudioUrl);
            await api.post(`/pptx-audio-tool/${sessionId}/slides/${targetIndex}/generate-interactions`, {
                activityType: isAudioActivity ? 'listening_comprehension' : 'checkpoint_quiz',
                mode: interactiveConfigModal.generationMode,
                sourceType: interactiveConfigModal.sourceType,
                fromSlideIndex: interactiveConfigModal.fromSlideIndex,
                toSlideIndex: interactiveConfigModal.toSlideIndex,
                customContent: interactiveConfigModal.customContent,
                imageBase64: interactiveConfigModal.imageBase64 || undefined,
                selectedQuestionTypes: interactiveConfigModal.selectedQuestionTypes,
                questionCount: interactiveConfigModal.questionCount,
                passScore: interactiveConfigModal.passScore,
                fallbackSlideIndex: interactiveConfigModal.fallbackSlideIndex,
                allowContinueWithoutPass: interactiveConfigModal.allowContinueWithoutPass,
            });

            await reloadSlidesOnly(sessionId);
            await loadSessionHistory();
            setExpandedInteractiveSlide(targetIndex);
            setInteractiveConfigModal(prev => ({ ...prev, isOpen: false }));
        } catch (err: any) {
            alert(err.response?.data?.message || err.message || 'Không thể tạo hoạt động tương tác.');
        } finally {
            setIsSubmittingInteractiveModal(false);
            setGeneratingInteractionSlide(null);
        }
    };

    const startEditingInteractiveQuestions = (slide: ParsedSlide) => {
        const parsed = parseInteractiveData(slide);
        if (!parsed) return;
        setEditingInteractiveSlide(slide.index);
        setEditingInteractiveForm(JSON.parse(JSON.stringify(parsed)));
        setExpandedInteractiveSlide(slide.index);
    };

    const saveInteractiveQuestions = async (slideIndex: number) => {
        if (!sessionId || !editingInteractiveForm) return;
        try {
            setSavingInteractiveSlide(true);
            const updatedForm = {
                ...editingInteractiveForm,
                totalQuestions: Array.isArray(editingInteractiveForm.questions)
                    ? editingInteractiveForm.questions.length
                    : editingInteractiveForm.totalQuestions,
            };
            const res = await api.put(`/pptx-audio-tool/${sessionId}/slides/${slideIndex}/content`, {
                interactiveData: updatedForm,
            });
            setSlides(prev => prev.map(s => (s.index === slideIndex ? { ...s, ...res.data } : s)));
            setEditingInteractiveSlide(null);
            setEditingInteractiveForm(null);
        } catch (err: any) {
            alert(err.response?.data?.message || 'Không thể lưu câu hỏi tương tác.');
        } finally {
            setSavingInteractiveSlide(false);
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
            const disposition = res.headers?.['content-disposition'] || res.headers?.['Content-Disposition'];
            let filename = `${session?.fileName?.replace(/\.pptx$/i, '') || 'pptx'}_english_moodle.xml`;
            filename = filenameFromDisposition(disposition, filename, '.xml');
            const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/xml; charset=utf-8' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
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
        setSelectedQuestionTypes(['MC', 'MR', 'MATCH', 'CLOZE', 'TRUEFALSE']);
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
    const slidesWithImagesCount = slides.filter(s => s.imageUrl).length;
    const hasDualLanguage = slides.some(s => s.hasDual);
    const filteredReviewQuestions = reviewQuestions.filter(q => {
        if (reviewFilter === 'ALL') return true;
        return q.level === reviewFilter;
    });

    const uncategorizedCount = sessionHistory.filter(s => !s.pptxSubjectId).length;
    const filteredHistory = sessionHistory.filter(s => {
        if (selectedSubjectFilter === 'ALL') return true;
        if (selectedSubjectFilter === 'UNCATEGORIZED') return !s.pptxSubjectId;
        return s.pptxSubjectId === selectedSubjectFilter;
    });
    const activeFilterSubject = subjects.find(sub => sub.id === selectedSubjectFilter) || null;
    const hasActiveContext = Boolean(session?.contextText && session.contextText.trim().length > 0);

    // ═══════════════════════════════════════════════════════════════
    // RENDER
    // ═══════════════════════════════════════════════════════════════
    return (
        <div className="pptx-audio-tool">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                <div>
                    <h1 className="page-title">🎙️ PPTX Audio & E-Learning Studio</h1>
                    <p className="page-subtitle" style={{ marginBottom: 0 }}>
                        Quản lý Môn học & Bài giảng PPTX → Nạp Context Giáo trình (Word/PDF/Text) → Tạo Lời giảng & Audio → Xuất PPTX, SCORM 1.2 & H5P
                    </p>
                </div>
                <button
                    type="button"
                    className="btn-create-subject-top"
                    onClick={openCreateSubjectModal}
                >
                    ➕ Tạo Môn học mới
                </button>
            </div>

            {/* Active Session Context Bar */}
            {sessionId && session && (
                <div className="active-lesson-banner">
                    <div className="active-lesson-info">
                        <span className="subject-pill">
                            📚 {session.pptxSubject?.name || 'Chưa phân loại môn'}
                        </span>
                        <span className="banner-sep">›</span>
                        <strong className="lesson-title-text">
                            {session.lessonTitle || session.fileName.replace(/\.pptx$/i, '')}
                        </strong>
                        <span className="lesson-meta-tag">
                            ({slides.length} slides · {completedCount} audio)
                        </span>
                        {hasActiveContext ? (
                            <span className="context-status-badge attached" onClick={openSessionContextModal} title="Nhấn để xem hoặc sửa ngữ cảnh bài học">
                                📄 Đã nạp Context ({session.contextFileName || `${Math.round((session.contextText?.length || 0) / 1000)}k ký tự`})
                            </span>
                        ) : (
                            <span className="context-status-badge empty" onClick={openSessionContextModal} title="Nhấn để nạp file Word/PDF hoặc văn bản bổ sung context cho AI">
                                ⚠️ Chưa có Context bổ sung
                            </span>
                        )}
                    </div>
                    <div className="active-lesson-actions">
                        <button
                            type="button"
                            className="btn-context-Action"
                            onClick={openSessionContextModal}
                        >
                            📚 {hasActiveContext ? 'Sửa Context / Thông tin bài' : '➕ Nạp Context (Word/PDF/Text)'}
                        </button>
                        {activeStep !== 0 && (
                            <button
                                type="button"
                                className="btn-switch-lesson"
                                onClick={() => setActiveStep(0)}
                            >
                                📂 Đổi bài / Môn học
                            </button>
                        )}
                    </div>
                </div>
            )}

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
                {/* ════════════ STEP 1: SUBJECTS, LESSONS & UPLOAD ════════════ */}
                {activeStep === 0 && (
                    <div className="step-upload">
                        {/* 1. SUBJECTS MANAGEMENT SECTION */}
                        <div className="subjects-workspace-section">
                            <div className="section-header-row">
                                <div>
                                    <h3 className="workspace-section-title">📚 1. Chọn Môn học (Độc lập cho PPTX Tool)</h3>
                                    <p className="workspace-section-desc">
                                        Tạo môn học để cung cấp bối cảnh chuyên ngành, đối tượng sinh viên và chuẩn đầu ra giúp AI soạn lời giảng & câu hỏi chính xác.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    className="btn-add-subject"
                                    onClick={openCreateSubjectModal}
                                >
                                    ➕ Thêm Môn học
                                </button>
                            </div>

                            <div className="pptx-subject-cards-grid">
                                {/* All Lessons Card */}
                                <div
                                    className={`pptx-subject-card ${selectedSubjectFilter === 'ALL' ? 'selected' : ''}`}
                                    onClick={() => setSelectedSubjectFilter('ALL')}
                                >
                                    <div className="subject-card-top">
                                        <span className="subject-card-icon">🗂️</span>
                                        <span className="subject-lesson-count">{sessionHistory.length} bài</span>
                                    </div>
                                    <div className="subject-card-name">Tất cả bài giảng</div>
                                    <div className="subject-card-meta">Toàn bộ các bài PPTX đã tải lên</div>
                                </div>

                                {/* Subject Cards */}
                                {subjects.map(sub => (
                                    <div
                                        key={sub.id}
                                        className={`pptx-subject-card ${selectedSubjectFilter === sub.id ? 'selected' : ''}`}
                                        onClick={() => {
                                            setSelectedSubjectFilter(sub.id);
                                            setNewLessonSubjectId(sub.id);
                                        }}
                                    >
                                        <div className="subject-card-top">
                                            <span className="subject-card-icon">📘</span>
                                            <div className="subject-card-top-right">
                                                <span className="subject-lesson-count">{sub.sessionCount ?? 0} bài</span>
                                                <button
                                                    type="button"
                                                    className="subject-icon-btn"
                                                    onClick={(e) => openEditSubjectModal(sub, e)}
                                                    title="Chỉnh sửa môn học"
                                                >
                                                    ✏️
                                                </button>
                                                <button
                                                    type="button"
                                                    className="subject-icon-btn danger"
                                                    onClick={(e) => handleDeleteSubject(sub, e)}
                                                    title="Xóa môn học"
                                                >
                                                    🗑️
                                                </button>
                                            </div>
                                        </div>
                                        <div className="subject-card-name">{sub.name}</div>
                                        <div className="subject-card-meta">
                                            {sub.major || sub.majorName || sub.expertiseArea || 'Chưa gắn chuyên ngành'}
                                            {' · '}
                                            {sub.language === 'en' ? '🇬🇧 EN' : '🇻🇳 VN'}
                                        </div>
                                    </div>
                                ))}

                                {/* Uncategorized Card */}
                                {uncategorizedCount > 0 && (
                                    <div
                                        className={`pptx-subject-card ${selectedSubjectFilter === 'UNCATEGORIZED' ? 'selected' : ''}`}
                                        onClick={() => {
                                            setSelectedSubjectFilter('UNCATEGORIZED');
                                            setNewLessonSubjectId('');
                                        }}
                                    >
                                        <div className="subject-card-top">
                                            <span className="subject-card-icon">📁</span>
                                            <span className="subject-lesson-count">{uncategorizedCount} bài</span>
                                        </div>
                                        <div className="subject-card-name">Chưa phân loại</div>
                                        <div className="subject-card-meta">Các file PPTX tải lên trước đây</div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* 2. CREATE NEW LESSON + CONTEXT + UPLOAD PPTX */}
                        <div className="create-lesson-upload-card">
                            <div className="section-header-row" style={{ marginBottom: 14 }}>
                                <div>
                                    <h3 className="workspace-section-title">
                                        📤 2. Tạo Bài học mới & Upload Slide PPTX
                                        {activeFilterSubject && (
                                            <span style={{ color: '#818cf8', fontWeight: 600, marginLeft: 8 }}>
                                                (Môn: {activeFilterSubject.name})
                                            </span>
                                        )}
                                    </h3>
                                    <p className="workspace-section-desc">
                                        Đặt tên bài học, đính kèm giáo trình Word/PDF hoặc tóm tắt ngữ cảnh (nếu slide ít chữ), sau đó chọn file PPTX.
                                    </p>
                                </div>
                            </div>

                            {/* Metadata & Context Form before PPTX dropzone */}
                            <div className="lesson-prep-grid">
                                <div className="prep-field">
                                    <label className="prep-label">📚 Thuộc Môn học:</label>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <select
                                            className="prep-select"
                                            value={newLessonSubjectId}
                                            onChange={(e) => setNewLessonSubjectId(e.target.value)}
                                        >
                                            <option value="">-- Chưa phân loại môn học --</option>
                                            {subjects.map(sub => (
                                                <option key={sub.id} value={sub.id}>
                                                    📘 {sub.name} {sub.major ? `(${sub.major})` : ''}
                                                </option>
                                            ))}
                                        </select>
                                        <button
                                            type="button"
                                            className="btn-quick-subject"
                                            onClick={openCreateSubjectModal}
                                            title="Tạo môn học mới"
                                        >
                                            + Môn mới
                                        </button>
                                    </div>
                                </div>

                                <div className="prep-field">
                                    <label className="prep-label">📝 Tên bài học (Tùy chọn - Tự lấy tên file nếu để trống):</label>
                                    <input
                                        type="text"
                                        className="prep-input"
                                        placeholder="VD: Bài 3 - Cấu trúc dữ liệu mảng & Ma trận trong NumPy..."
                                        value={newLessonTitle}
                                        onChange={(e) => setNewLessonTitle(e.target.value)}
                                    />
                                </div>
                            </div>

                            {/* Context Enrichment Box (Word / PDF + Textbox) */}
                            <div className="lesson-context-enrichment-box">
                                <div className="context-box-header">
                                    <div className="context-box-title-group">
                                        <span style={{ fontSize: '1.15rem' }}>📖</span>
                                        <div>
                                            <strong>Ngữ cảnh bổ sung cho bài học (Word / PDF / Văn bản)</strong>
                                            <span className="context-optional-tag">Khuyên dùng khi slide chỉ có sơ đồ / từ khóa</span>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                        <input
                                            type="file"
                                            id="new-lesson-context-file"
                                            accept=".docx,.pdf,.txt,.md"
                                            onChange={handleExtractNewLessonContextFile}
                                            style={{ display: 'none' }}
                                            disabled={isExtractingNewContext}
                                        />
                                        <label htmlFor="new-lesson-context-file" className="btn-upload-context-doc">
                                            {isExtractingNewContext ? '⏳ Đang đọc tài liệu...' : '📎 Đính kèm Word (.docx) / PDF (.pdf)'}
                                        </label>
                                        <button
                                            type="button"
                                            className="btn-toggle-context-text"
                                            onClick={() => setShowNewLessonContextBox(prev => !prev)}
                                        >
                                            {showNewLessonContextBox || newLessonContextText ? '🔽 Ẩn ô văn bản' : '✍️ Nhập văn bản trực tiếp'}
                                        </button>
                                    </div>
                                </div>

                                {newLessonContextFileName && (
                                    <div className="context-attached-file-bar">
                                        <span>✅ Đã trích xuất văn bản từ: <strong>{newLessonContextFileName}</strong> ({newLessonContextText.length.toLocaleString()} ký tự)</span>
                                        <button
                                            type="button"
                                            className="btn-clear-context"
                                            onClick={() => {
                                                setNewLessonContextFileName('');
                                                setNewLessonContextText('');
                                            }}
                                        >
                                            ✕ Xóa
                                        </button>
                                    </div>
                                )}

                                {(showNewLessonContextBox || newLessonContextText.length > 0) && (
                                    <div style={{ marginTop: 10 }}>
                                        <textarea
                                            className="context-textarea"
                                            rows={4}
                                            placeholder="Nhập đề cương bài giảng, nội dung giáo trình, giải thích công thức/bảng biểu hoặc nội dung trích xuất từ file Word/PDF sẽ hiển thị tại đây để bạn kiểm tra..."
                                            value={newLessonContextText}
                                            onChange={(e) => setNewLessonContextText(e.target.value)}
                                        />
                                    </div>
                                )}
                            </div>

                            {/* PPTX Dropzone */}
                            <div
                                className={`drop-zone ${dragOver ? 'drag-over' : ''} ${isUploading ? 'uploading' : ''}`}
                                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                                onDragLeave={() => setDragOver(false)}
                                onDrop={handleDrop}
                            >
                                {isUploading ? (
                                    <>
                                        <div className="upload-spinner"></div>
                                        <p>{uploadStatusText || 'Đang upload và phân tích sâu cấu trúc slide, bảng biểu & hình ảnh...'}</p>
                                        <div className="progress-bar-upload">
                                            <div className="progress-fill" style={{ width: `${uploadProgress}%` }} />
                                        </div>
                                        <span style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '6px' }}>{uploadProgress}%</span>
                                    </>
                                ) : (
                                    <>
                                        <span className="drop-icon">📤</span>
                                        <h3>Kéo thả file PowerPoint (.pptx) vào đây để tạo bài giảng</h3>
                                        <p>Hệ thống tự động bóc tách tiêu đề, nội dung, bảng biểu, nhóm hình (Group) và trích xuất ảnh slide</p>
                                        <input
                                            type="file"
                                            accept=".pptx"
                                            onChange={handleFileSelect}
                                            className="file-input-hidden"
                                            id="pptx-file-input"
                                        />
                                        <label htmlFor="pptx-file-input" className="btn-choose-file">
                                            📁 Chọn File .PPTX & Bắt Đầu
                                        </label>
                                    </>
                                )}
                            </div>
                        </div>

                        {sessionId && session && (
                            <div className="upload-result">
                                <p>
                                    ✅ Bài học đang mở: <strong>{session.lessonTitle || session.fileName}</strong> ({slides.length} slides)
                                    {session.pptxSubject?.name && <> · Môn: <strong>{session.pptxSubject.name}</strong></>}
                                </p>
                                <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                                    <button className="btn-next-step" style={{ marginTop: 0 }} onClick={() => setActiveStep(1)}>
                                        ➡️ Tiếp tục: Lời giảng & Audio
                                    </button>
                                    <button
                                        type="button"
                                        className="btn-context-Action"
                                        onClick={openSessionContextModal}
                                        style={{ padding: '10px 18px' }}
                                    >
                                        📚 Nạp / Sửa Context Bài Học
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* 3. LESSONS LIST IN SELECTED SUBJECT */}
                        {sessionHistory.length > 0 && (
                            <div className="session-history">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                                    <h3 className="history-title" style={{ margin: 0 }}>
                                        📂 Danh sách bài giảng {activeFilterSubject ? `thuộc môn "${activeFilterSubject.name}"` : selectedSubjectFilter === 'UNCATEGORIZED' ? '(Chưa phân loại)' : `(${filteredHistory.length} bài)`}
                                    </h3>
                                    {selectedSubjectFilter !== 'ALL' && (
                                        <button
                                            type="button"
                                            className="btn-show-all-lessons"
                                            onClick={() => setSelectedSubjectFilter('ALL')}
                                        >
                                            Xem tất cả ({sessionHistory.length})
                                        </button>
                                    )}
                                </div>

                                {filteredHistory.length === 0 ? (
                                    <div className="empty-subject-lessons">
                                        Chưa có bài học nào trong môn học này. Hãy tải file PPTX ở khung phía trên để tạo bài học đầu tiên!
                                    </div>
                                ) : (
                                    <div className="history-list">
                                        {filteredHistory.map(s => (
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
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                                        <span className="history-name">{s.lessonTitle || s.fileName}</span>
                                                        {s.pptxSubject?.name ? (
                                                            <span className="history-subject-tag">📘 {s.pptxSubject.name}</span>
                                                        ) : (
                                                            <span className="history-subject-tag uncategorized">Chưa phân môn</span>
                                                        )}
                                                        {s.hasContext && (
                                                            <span className="history-context-tag" title={s.contextFileName || 'Đã có văn bản ngữ cảnh'}>
                                                                📄 Có Context {s.contextFileName ? `(${s.contextFileName})` : ''}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <span className="history-meta">
                                                        File: {s.fileName} · {s.totalSlides} slides · {s.audioCount} audio · {new Date(s.createdAt).toLocaleDateString('vi-VN')}
                                                    </span>
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    <button
                                                        type="button"
                                                        className="history-edit-btn"
                                                        title="Đổi tên bài / Chuyển môn học / Nạp thêm Context Word/PDF"
                                                        onClick={async (e) => {
                                                            e.stopPropagation();
                                                            await loadSession(s.id);
                                                            setShowContextModal(true);
                                                        }}
                                                    >
                                                        📚 Context / Sửa
                                                    </button>
                                                    <button
                                                        className="history-delete"
                                                        disabled={isDeletingSession === s.id}
                                                        onClick={async (e) => {
                                                            e.stopPropagation();
                                                            if (!confirm(`Xóa bài "${s.lessonTitle || s.fileName}" và toàn bộ dữ liệu?`)) return;
                                                            try {
                                                                setIsDeletingSession(s.id);
                                                                await api.delete(`/pptx-audio-tool/${s.id}`);
                                                                setSessionHistory(prev => prev.filter(h => h.id !== s.id));
                                                                loadSubjects();
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
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* 4. MULTI-LESSON EXAM GENERATOR IN PPTX SUBJECT */}
                        {activeFilterSubject && (
                            <div style={{ marginTop: 18 }}>
                                <div
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '14px 18px',
                                        borderRadius: 12,
                                        background: 'rgba(79, 70, 229, 0.14)',
                                        border: '1px solid rgba(99, 102, 241, 0.45)',
                                    }}
                                >
                                    <div>
                                        <strong style={{ color: '#f8fafc', fontSize: '0.98rem' }}>
                                            📝 Tạo Bộ Câu Hỏi Kiểm Tra Theo Nhóm Bài Học — Môn: {activeFilterSubject.name}
                                        </strong>
                                        <div style={{ fontSize: '0.82rem', color: '#cbd5e1', marginTop: 3 }}>
                                            Chọn nhóm bài (VD: Bài 1 → Bài 6) trong môn này để sinh 100% câu hỏi mới và xuất Moodle XML gom vào 1 Category duy nhất.
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        className="btn-add-subject"
                                        onClick={() => setShowSubjectExamPanel(prev => !prev)}
                                    >
                                        {showSubjectExamPanel ? '🔼 Thu gọn Bài kiểm tra' : '📝 Mở Trình Tạo Bài Kiểm Tra'}
                                    </button>
                                </div>
                                {showSubjectExamPanel && (
                                    <ExamManagerPanel
                                        mode="pptx-subject"
                                        pptxSubjectId={activeFilterSubject.id}
                                        subjectName={activeFilterSubject.name}
                                    />
                                )}
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
                                {/* Language Toggle: Always visible so user can switch between VN and EN */}
                                <div className="language-toggle">
                                    <button
                                        className={`lang-btn ${language === 'vi' ? 'active' : ''}`}
                                        onClick={() => toggleLanguage('vi')}
                                        title="Xem và chỉnh sửa lời giảng Tiếng Việt"
                                    >
                                        🇻🇳 VN
                                    </button>
                                    <button
                                        className={`lang-btn ${language === 'en' ? 'active' : ''}`}
                                        onClick={() => toggleLanguage('en')}
                                        title="Xem và chỉnh sửa lời giảng English"
                                    >
                                        🇬🇧 EN
                                    </button>
                                </div>

                                {/* Generate Speaker Notes */}
                                <button
                                    className="btn-generate-notes"
                                    onClick={() => {
                                        setNotesLanguage(language || 'vi');
                                        setShowNotesOptionsModal(true);
                                    }}
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
                                    <p style={{ color: '#94a3b8', fontSize: '0.88rem', margin: '0 0 12px 0' }}>
                                        Lựa chọn ngôn ngữ và phương thức soạn bài giảng phù hợp cho từng slide thuyết trình:
                                    </p>

                                    {/* Context Enrichment Quick Banner inside Notes Modal */}
                                    <div style={{
                                        marginBottom: 16,
                                        padding: '10px 14px',
                                        borderRadius: 10,
                                        background: hasActiveContext
                                            ? 'rgba(16, 185, 129, 0.12)'
                                            : 'rgba(245, 158, 11, 0.12)',
                                        border: `1px solid ${hasActiveContext ? 'rgba(16, 185, 129, 0.35)' : 'rgba(245, 158, 11, 0.35)'}`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        gap: 10,
                                    }}>
                                        <div style={{ fontSize: '0.82rem', color: '#e2e8f0', lineHeight: 1.4 }}>
                                            {hasActiveContext ? (
                                                <>
                                                    <strong style={{ color: '#34d399' }}>✅ Đã có tài liệu ngữ cảnh ({(session?.contextText?.length || 0).toLocaleString()} ký tự)</strong>
                                                    <div style={{ color: '#94a3b8', fontSize: '0.78rem' }}>
                                                        AI sẽ kết hợp nội dung slide + mạch toàn bài + tài liệu bổ sung để soạn lời giảng sâu sắc.
                                                    </div>
                                                </>
                                            ) : (
                                                <>
                                                    <strong style={{ color: '#fbbf24' }}>💡 Gợi ý: Slide ít chữ hoặc nhiều hình/bảng?</strong>
                                                    <div style={{ color: '#94a3b8', fontSize: '0.78rem' }}>
                                                        Nạp thêm file Word/PDF giáo trình hoặc ghi chú để AI hiểu sâu ngữ cảnh bài học.
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setShowNotesOptionsModal(false);
                                                openSessionContextModal();
                                            }}
                                            style={{
                                                padding: '6px 12px',
                                                borderRadius: 8,
                                                border: '1px solid rgba(148, 163, 184, 0.3)',
                                                background: 'rgba(15, 23, 42, 0.7)',
                                                color: '#f8fafc',
                                                fontSize: '0.78rem',
                                                fontWeight: 600,
                                                cursor: 'pointer',
                                                whiteSpace: 'nowrap',
                                            }}
                                        >
                                            📎 {hasActiveContext ? 'Xem / Sửa Context' : 'Nạp Context'}
                                        </button>
                                    </div>

                                    {/* Language Selection */}
                                    <div style={{ marginBottom: 18 }}>
                                        <label style={{ display: 'block', fontSize: '0.86rem', fontWeight: 600, color: '#cbd5e1', marginBottom: 8 }}>
                                            🌐 Ngôn ngữ lời giảng bạn muốn soạn:
                                        </label>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                            <div
                                                onClick={() => setNotesLanguage('vi')}
                                                style={{
                                                    padding: '12px 14px',
                                                    borderRadius: 10,
                                                    cursor: 'pointer',
                                                    border: `2px solid ${notesLanguage === 'vi' ? '#6366f1' : 'rgba(148, 163, 184, 0.2)'}`,
                                                    background: notesLanguage === 'vi' ? 'rgba(99, 102, 241, 0.15)' : 'rgba(15, 23, 42, 0.6)',
                                                    boxShadow: notesLanguage === 'vi' ? '0 0 12px rgba(99, 102, 241, 0.25)' : 'none',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 10,
                                                    transition: 'all 0.2s',
                                                }}
                                            >
                                                <span style={{ fontSize: '1.5rem' }}>🇻🇳</span>
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ fontWeight: 700, fontSize: '0.92rem', color: notesLanguage === 'vi' ? '#c7d2fe' : '#f1f5f9' }}>
                                                        Tiếng Việt <span style={{ fontSize: '0.7rem', background: 'rgba(99, 102, 241, 0.25)', color: '#a5b4fc', padding: '1px 6px', borderRadius: 4, fontWeight: 500, whiteSpace: 'nowrap' }}>Mặc định</span>
                                                    </div>
                                                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 2 }}>
                                                        Khẩu ngữ sư phạm tự nhiên
                                                    </div>
                                                </div>
                                                {notesLanguage === 'vi' && (
                                                    <span style={{ color: '#818cf8', fontWeight: 'bold', fontSize: '1.1rem' }}>✓</span>
                                                )}
                                            </div>

                                            <div
                                                onClick={() => setNotesLanguage('en')}
                                                style={{
                                                    padding: '12px 14px',
                                                    borderRadius: 10,
                                                    cursor: 'pointer',
                                                    border: `2px solid ${notesLanguage === 'en' ? '#6366f1' : 'rgba(148, 163, 184, 0.2)'}`,
                                                    background: notesLanguage === 'en' ? 'rgba(99, 102, 241, 0.15)' : 'rgba(15, 23, 42, 0.6)',
                                                    boxShadow: notesLanguage === 'en' ? '0 0 12px rgba(99, 102, 241, 0.25)' : 'none',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 10,
                                                    transition: 'all 0.2s',
                                                }}
                                            >
                                                <span style={{ fontSize: '1.5rem' }}>🇬🇧</span>
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ fontWeight: 700, fontSize: '0.92rem', color: notesLanguage === 'en' ? '#c7d2fe' : '#f1f5f9' }}>
                                                        English
                                                    </div>
                                                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 2 }}>
                                                        Academic spoken lecture
                                                    </div>
                                                </div>
                                                {notesLanguage === 'en' && (
                                                    <span style={{ color: '#818cf8', fontWeight: 'bold', fontSize: '1.1rem' }}>✓</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {(() => {
                                        const currentLangNotesCount = slides.filter(s => {
                                            const note = notesLanguage === 'en' ? s.noteEN : s.noteVN;
                                            return note && note.trim().length > 0;
                                        }).length;
                                        const currentLangMissingCount = Math.max(0, slides.length - currentLangNotesCount);

                                        return (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                                {/* Option 1: All slides */}
                                                <div
                                                    onClick={() => startGenerateNotes('all', notesLanguage)}
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
                                                        <span>🎯 Tạo lại cho TẤT CẢ các slide ({slides.length} slide - {notesLanguage === 'en' ? 'English' : 'Tiếng Việt'})</span>
                                                        {currentLangNotesCount > 0 && (
                                                            <span style={{ fontSize: '0.72rem', background: 'rgba(2, 132, 199, 0.2)', color: '#38bdf8', padding: '2px 8px', borderRadius: 999 }}>
                                                                Khuyên dùng
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div style={{ color: '#94a3b8', fontSize: '0.84rem', marginTop: 6, lineHeight: 1.45 }}>
                                                        AI sẽ đọc đồng thời cả <strong>nội dung trên slide</strong> VÀ <strong>ghi chú hiện có (nếu có)</strong> để mở rộng, viết lại thành lời giảng chuẩn mực sư phạm (180 – 220 từ) bằng {notesLanguage === 'en' ? 'tiếng Anh' : 'tiếng Việt'}.
                                                    </div>
                                                </div>

                                                {/* Option 2: Missing slides */}
                                                <div
                                                    onClick={() => {
                                                        if (currentLangMissingCount > 0) {
                                                            startGenerateNotes('missing', notesLanguage);
                                                        }
                                                    }}
                                                    style={{
                                                        padding: '16px 18px',
                                                        border: '2px solid rgba(148, 163, 184, 0.2)',
                                                        borderRadius: 10,
                                                        cursor: currentLangMissingCount === 0 ? 'not-allowed' : 'pointer',
                                                        opacity: currentLangMissingCount === 0 ? 0.5 : 1,
                                                        transition: 'all 0.2s',
                                                        background: 'rgba(15, 23, 42, 0.6)',
                                                    }}
                                                    onMouseEnter={e => {
                                                        if (currentLangMissingCount > 0) {
                                                            e.currentTarget.style.borderColor = '#10b981';
                                                        }
                                                    }}
                                                    onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.2)')}
                                                >
                                                    <div style={{ fontWeight: 600, color: '#f1f5f9', fontSize: '0.98rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                                                        <span>➕ Chỉ tạo cho các slide THIẾU ({currentLangMissingCount} slide)</span>
                                                    </div>
                                                    <div style={{ color: '#94a3b8', fontSize: '0.84rem', marginTop: 6, lineHeight: 1.45 }}>
                                                        {currentLangMissingCount === 0
                                                            ? `Tất cả ${slides.length} slide đã có lời giảng ${notesLanguage === 'en' ? 'English' : 'tiếng Việt'}.`
                                                            : `Chỉ soạn bài giảng cho ${currentLangMissingCount} slide chưa có lời giảng ${notesLanguage === 'en' ? 'English' : 'tiếng Việt'}. Giữ nguyên ${currentLangNotesCount} slide đã có.`
                                                        }
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })()}

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

                {/* ════════════ STEP 3: SLIDE WORKSPACE & EXPORT (STEP 5 PARITY) ════════════ */}
                {activeStep === 2 && sessionId && (
                    <div className="step5-generate-pptx">
                        {/* Step Header */}
                        <div className="step-header">
                            <div className="step-title-group">
                                <h2>📊 Nội Dung Slide & Xuất Học Liệu ({slides.length} slides)</h2>
                                <p className="step-description">
                                    Chỉnh sửa nội dung & hình ảnh từng slide, chèn slide lý thuyết / câu hỏi kiểm tra chặn bài (Mastery Gate) và xuất PPTX, SCORM 1.2, H5P, Moodle XML.
                                </p>
                            </div>
                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                                <ModelSelector taskType="SLIDES" compact />
                                <ModelSelector taskType="IMAGE" compact />
                                <span className="exp-stat-pill">🔊 {completedCount}/{slides.length} audio</span>
                                <span className="exp-stat-pill">🖼️ {slidesWithImagesCount} ảnh</span>
                                <button
                                    type="button"
                                    className="btn-secondary btn-sm"
                                    onClick={openSessionContextModal}
                                >
                                    📎 {hasActiveContext ? `Context (${Math.round((session?.contextText?.length || 0) / 1000)}k ký tự)` : '+ Bổ sung Word/PDF Context'}
                                </button>
                            </div>
                        </div>

                        {/* Template Selector with Preview (Exact Step 5 structure) */}
                        <div className="template-selector-section">
                            <div className="template-selector-row">
                                <div className="template-picker-group">
                                    <label htmlFor="pptx-tool-template-select">🎨 Mẫu giao diện PowerPoint:</label>
                                    <select
                                        id="pptx-tool-template-select"
                                        value={selectedTemplateId}
                                        onChange={(e) => {
                                            const newId = e.target.value;
                                            setSelectedTemplateId(newId);
                                            const tpl = templates.find(t => t.id === newId);
                                            if (tpl && !tpl.isSystem) {
                                                setExportBgOption('custom');
                                            } else if (exportBgOption === 'custom') {
                                                setExportBgOption('tuaf_clean');
                                            }
                                        }}
                                        className="template-dropdown"
                                    >
                                        <option value="blank">-- Không dùng mẫu (Giữ nền PPTX gốc) --</option>
                                        {templates.filter(t => t.isSystem).length > 0 && (
                                            <optgroup label="Mẫu hệ thống">
                                                {templates.filter(t => t.isSystem).map((template) => (
                                                    <option key={template.id} value={template.id}>
                                                        {template.name} {template.isDefault ? '⭐' : ''}
                                                    </option>
                                                ))}
                                            </optgroup>
                                        )}
                                        {templates.filter(t => !t.isSystem).length > 0 && (
                                            <optgroup label="Mẫu của tôi">
                                                {templates.filter(t => !t.isSystem).map((template) => (
                                                    <option key={template.id} value={template.id}>
                                                        {template.name}
                                                    </option>
                                                ))}
                                            </optgroup>
                                        )}
                                    </select>
                                </div>

                                <div className="template-picker-group">
                                    <label htmlFor="pptx-tool-scorm-bg-select">🌐 Giao diện xuất SCORM & H5P:</label>
                                    <select
                                        id="pptx-tool-scorm-bg-select"
                                        value={exportBgOption}
                                        onChange={(e) => setExportBgOption(e.target.value as any)}
                                        className="template-dropdown"
                                        title="Tùy chọn hình nền và nhận diện thương hiệu khi xuất SCORM / H5P"
                                    >
                                        <option value="tuaf_clean">🌿 Nhận diện TUAF Tối ưu (Khuyên dùng - Logo Player, viền xanh, tối đa diện tích slide)</option>
                                        <option value="tuaf_full">🖼️ Áp dụng ảnh nền gốc TUAF (Dùng cả 2 ảnh bìa & nội dung)</option>
                                        <option value="minimal">📄 Nền tối giản (Nền phẳng, không ảnh & không logo)</option>
                                        {(() => {
                                            const tpl = templates.find(t => t.id === selectedTemplateId);
                                            if (tpl && !tpl.isSystem) {
                                                return <option value="custom">🎨 Đồng bộ theo mẫu đã chọn ({tpl.name})</option>;
                                            }
                                            return <option value="custom">🎨 Đồng bộ theo mẫu PPTX đã chọn ở trên</option>;
                                        })()}
                                    </select>
                                </div>

                                <div className="template-picker-group">
                                    <label htmlFor="pptx-tool-theme-select">🌓 Chủ đề màu sắc (Theme):</label>
                                    <select
                                        id="pptx-tool-theme-select"
                                        value={exportTheme}
                                        onChange={(e) => setExportTheme(e.target.value as 'light' | 'dark')}
                                        className="template-dropdown"
                                        title="Lựa chọn tông màu sáng học thuật hoặc tông màu tối cho gói xuất"
                                    >
                                        <option value="light">☀️ Giao diện Sáng (Học thuật TUAF - Khuyên dùng cho LMS & Giảng đường)</option>
                                        <option value="dark">🌙 Giao diện Tối (Modern Slate Dark - Tối ưu ban đêm)</option>
                                    </select>
                                </div>

                                {selectedTemplateId && selectedTemplateId !== 'blank' && (() => {
                                    const selectedTpl = templates.find(t => t.id === selectedTemplateId);
                                    if (!selectedTpl) return null;
                                    return (
                                        <div className="template-preview-small" title={`Xem trước mẫu: ${selectedTpl.name}`}>
                                            {selectedTpl.titleBgUrl && (
                                                <img src={getFullAudioUrl(selectedTpl.titleBgUrl)} alt="Title" title="Ảnh bìa (Title)" />
                                            )}
                                            {selectedTpl.contentBgUrl && (
                                                <img src={getFullAudioUrl(selectedTpl.contentBgUrl)} alt="Content" title="Ảnh nội dung (Content)" />
                                            )}
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>

                        {/* Main Export Action Buttons (Exact Step 5 classes) */}
                        <div className="action-buttons-row">
                            <button
                                type="button"
                                onClick={downloadPptx}
                                disabled={isDownloading || completedCount === 0}
                                className="btn-primary"
                                title={completedCount === 0 ? 'Cần tạo ít nhất 1 audio ở Bước 2 để tải PPTX kèm Audio' : 'Tải file PowerPoint gốc đã nhúng Audio thuyết giảng'}
                            >
                                {isDownloading
                                    ? '⏳ Đang ghép Audio vào PPTX...'
                                    : `📥 Tải PPTX (có Audio · ${completedCount}/${slides.length})`}
                            </button>

                            <button
                                type="button"
                                className="btn-moodle-export btn-scorm"
                                onClick={handleExportScorm}
                                disabled={isExportingScorm || slides.length === 0}
                                title="Đóng gói chuẩn SCORM 1.2: Tự động chạy audio, trình chiếu slide, chấm điểm tương tác trên Moodle"
                            >
                                {isExportingScorm ? '⏳ Đang đóng gói...' : '📦 Xuất SCORM (.zip)'}
                            </button>

                            <button
                                type="button"
                                className="btn-moodle-export btn-h5p"
                                onClick={handleExportH5p}
                                disabled={isExportingH5p || slides.length === 0}
                                title="Đóng gói chuẩn H5P Course Presentation cho Moodle"
                            >
                                {isExportingH5p ? '⏳ Đang xuất...' : '🌟 Xuất H5P (.h5p)'}
                            </button>

                            <button
                                type="button"
                                className="btn-moodle-export btn-xml"
                                onClick={handleExportMoodleXml}
                                disabled={isExportingMoodleXml || slides.length === 0}
                                title="Xuất ngân hàng câu hỏi tương tác & kiểm tra nhanh vào Ngân hàng câu hỏi Moodle"
                            >
                                {isExportingMoodleXml ? '⏳ Đang xuất...' : '📋 Xuất Moodle Quiz XML'}
                            </button>

                            <button
                                type="button"
                                className="btn-moodle-guide-trigger"
                                onClick={() => setShowMoodleGuide(true)}
                                title="Xem hướng dẫn đưa học liệu tương tác vào Moodle"
                            >
                                ❓ Hướng dẫn Moodle
                            </button>
                        </div>

                        {/* Slide Preview List (Exact Step 5 structure) */}
                        <div className="slide-preview-section">
                            <div className="slide-preview-header">
                                <h4>📋 Nội dung slides ({slides.length})</h4>
                                <div className="add-slide-btn-group">
                                    <button
                                        type="button"
                                        className="btn-add-slide-theory"
                                        onClick={() => openAddSlideModal(-1)}
                                        title="Thêm slide lý thuyết (Nội dung, gạch đầu dòng, ảnh minh họa)"
                                    >
                                        📖 + Thêm slide lý thuyết
                                    </button>
                                    <button
                                        type="button"
                                        className="btn-add-slide-interactive"
                                        onClick={() => openInteractiveModalForInsert(-1)}
                                        title="Thêm slide tương tác độc lập (Kiểm tra nhanh hoặc Bài tập nghe hiểu)"
                                    >
                                        🎯 + Thêm slide tương tác
                                    </button>
                                </div>
                            </div>

                            <div className="slide-preview-grid">
                                {/* Insert divider before Slide 1 */}
                                {slides.length > 0 && (
                                    <div className="slide-insert-divider top" title="Chèn slide vào đầu bài giảng">
                                        <div className="slide-insert-btn-pair">
                                            <button
                                                type="button"
                                                className="btn-slide-insert-mini theory"
                                                onClick={() => openAddSlideModal(0)}
                                                title="Chèn slide lý thuyết trước Slide 1"
                                            >
                                                📖 + Lý thuyết
                                            </button>
                                            <button
                                                type="button"
                                                className="btn-slide-insert-mini interactive"
                                                onClick={() => openInteractiveModalForInsert(0)}
                                                title="Chèn slide tương tác trước Slide 1"
                                            >
                                                🎯 + Tương tác
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {slides.map((slide, arrIdx) => {
                                    const oneBasedIdx = slide.index + 1;
                                    const bullets = parseBulletsFromSlide(slide);
                                    const hasOptimizedBullets = Array.isArray(slide.optimizedContent) && slide.optimizedContent.length > 0;
                                    const hasAudio = slide.audioStatus === 'done' && Boolean(slide.audioUrl);
                                    const isRegenContent = regeneratingContentSlides.has(slide.index);
                                    const isRegenImage = regeneratingImageSlides.has(slide.index);
                                    const isUploadingImg = uploadingSlideImage === slide.index;
                                    const isEditingThisContent = editingContentSlideIndex === slide.index;
                                    const interactiveObj = parseInteractiveData(slide);
                                    const isCheckpointSlide = slide.slideType === 'checkpoint_quiz' || slide.layoutType === 'checkpoint_gate';
                                    const isAudioLabSlide = slide.slideType === 'interactive_audio' || slide.layoutType === 'audio_lab';
                                    const isInteractiveSlide = isCheckpointSlide || isAudioLabSlide || Boolean(interactiveObj);
                                    const fullImageUrl = slide.imageUrl ? getFullAudioUrl(slide.imageUrl) : undefined;
                                    const fullExtraAudioUrl = slide.extraAudioUrl ? getFullAudioUrl(slide.extraAudioUrl) : undefined;
                                    const slidePhase = (isRegenContent || isRegenImage || isUploadingImg)
                                        ? 'optimizing_content'
                                        : (bullets.length > 0 || fullImageUrl || isInteractiveSlide ? 'complete' : 'pending');

                                    return (
                                        <div key={`slide-wrap-${slide.index}`} className="slide-item-wrapper">
                                            <div className={`slide-card ${slidePhase} ${(isRegenContent || isRegenImage) ? 'regenerating' : ''} ${isEditingThisContent ? 'editing' : ''}`}>
                                                {/* Slide Header */}
                                                <div className="slide-card-header">
                                                    <div className="slide-header-left">
                                                        <span className="slide-number">Slide {oneBasedIdx}</span>
                                                        {isAudioLabSlide ? (
                                                            <span className="slide-type-badge badge-audio-interactive" title="Slide có âm thanh mẫu và bài tập tương tác">
                                                                🎧 Nghe & Tương tác
                                                            </span>
                                                        ) : isCheckpointSlide ? (
                                                            <span className="slide-type-badge badge-quiz-interactive" title="Slide câu hỏi củng cố kiến thức">
                                                                🧩 Kiểm tra nhanh
                                                            </span>
                                                        ) : (
                                                            <span className="slide-type-badge badge-content" title="Slide học lý thuyết">
                                                                📘 Lý thuyết
                                                            </span>
                                                        )}

                                                        <div className="slide-layout-selector-wrapper">
                                                            <select
                                                                className="slide-layout-select"
                                                                value={slide.layoutType || 'split_standard'}
                                                                onChange={(e) => handleChangeSlideLayout(slide.index, e.target.value)}
                                                                title="Chọn bố cục hiển thị cho slide này"
                                                            >
                                                                <option value="split_standard">📐 Chuẩn (Text trái, Visual phải)</option>
                                                                <option value="split_reversed">🔄 Bố cục đảo (Visual trái, Text phải)</option>
                                                                <option value="comparison_3col">📊 So sánh 3 cột (Bảng/phân tích)</option>
                                                                <option value="hero_infographic">🖼️ Infographic lớn (Trung tâm)</option>
                                                                <option value="process_steps">📋 Quy trình tiến trình (Timeline)</option>
                                                                <option value="audio_lab">🎧 Lab thực hành âm thanh</option>
                                                                <option value="checkpoint_gate">🎯 Kiểm tra chặn bài (Mastery Gate)</option>
                                                            </select>
                                                        </div>

                                                        {isEditingThisContent ? (
                                                            <span className="slide-title-edit-badge">✏️ Đang chỉnh sửa nội dung</span>
                                                        ) : (
                                                            <span className="slide-title" title={slide.title}>{slide.title || '(Chưa có tiêu đề)'}</span>
                                                        )}
                                                    </div>

                                                    <div className="slide-header-actions">
                                                        <button
                                                            type="button"
                                                            className="btn-header-action btn-header-move"
                                                            disabled={arrIdx === 0 || movingSlideIndex !== null}
                                                            onClick={() => handleMoveSlide(slide.index, 'up')}
                                                            title="Di chuyển slide lên trên"
                                                        >
                                                            ⬆️
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="btn-header-action btn-header-move"
                                                            disabled={arrIdx === slides.length - 1 || movingSlideIndex !== null}
                                                            onClick={() => handleMoveSlide(slide.index, 'down')}
                                                            title="Di chuyển slide xuống dưới"
                                                        >
                                                            ⬇️
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="btn-header-action btn-header-delete"
                                                            disabled={slides.length <= 1 || deletingSlideIndex === slide.index}
                                                            onClick={() => handleDeleteSlide(slide.index)}
                                                            title="Xóa slide này"
                                                        >
                                                            {deletingSlideIndex === slide.index ? '⏳' : '🗑️'}
                                                        </button>
                                                        <span
                                                            className="slide-status"
                                                            title={hasAudio ? 'Đã tạo audio thuyết giảng' : 'Nhấn để sang Bước 2 tạo Audio cho slide này'}
                                                            style={{ cursor: hasAudio ? 'default' : 'pointer' }}
                                                            onClick={() => !hasAudio && setActiveStep(1)}
                                                        >
                                                            {hasAudio ? '🔊' : '⏳'}
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Slide Body: Interactive Standalone OR 2-Column Theory Slide */}
                                                {(() => {
                                                    const questions: any[] = interactiveObj && Array.isArray(interactiveObj.questions) ? interactiveObj.questions : [];

                                                    if (isInteractiveSlide && !isEditingThisContent && bullets.length === 0 && !fullImageUrl) {
                                                        return (
                                                            <div className="slide-interactive-standalone-container">
                                                                {slide.extraAudioUrl && fullExtraAudioUrl && (
                                                                    <div className="slide-extra-audio-bar">
                                                                        <div className="extra-audio-info">
                                                                            <span className="extra-audio-icon">🎧</span>
                                                                            <span className="extra-audio-label">Audio mẫu bài giảng:</span>
                                                                            <span className="extra-audio-name" title={slide.extraAudioName || 'Audio mẫu'}>
                                                                                {slide.extraAudioName || 'Audio mẫu'}
                                                                            </span>
                                                                        </div>
                                                                        <div className="extra-audio-controls">
                                                                            <audio controls src={fullExtraAudioUrl} className="extra-audio-player" preload="none" />
                                                                            <button
                                                                                type="button"
                                                                                className="btn-extra-audio-delete"
                                                                                onClick={() => handleDeleteExtraAudio(slide.index)}
                                                                                title="Xóa file audio mẫu"
                                                                            >
                                                                                🗑️ Xóa
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                )}

                                                                {interactiveObj && questions.length > 0 ? (
                                                                    <div className="slide-interactive-preview-box">
                                                                        <div className="interactive-preview-header">
                                                                            <div className="interactive-header-title">
                                                                                <span className="interactive-icon">{isAudioLabSlide ? '🎧' : '🎯'}</span>
                                                                                <strong>{interactiveObj.badgeLabel || (isAudioLabSlide ? 'Hoạt động Nghe & Tương tác' : 'Trạm Kiểm Soát Kiến Thức')}</strong>
                                                                                <span className="interactive-count-pill">{questions.length} câu hỏi</span>
                                                                            </div>
                                                                            <div className="interactive-header-actions">
                                                                                <button
                                                                                    type="button"
                                                                                    className="btn-text-reconfig"
                                                                                    onClick={() => openInteractiveModalForSlide(slide)}
                                                                                >
                                                                                    ✨ Cấu hình / Tạo lại (AI)
                                                                                </button>
                                                                                <button
                                                                                    type="button"
                                                                                    className="btn-text-reconfig"
                                                                                    onClick={() => startEditingInteractiveQuestions(slide)}
                                                                                >
                                                                                    ✏️ Sửa câu hỏi
                                                                                </button>
                                                                            </div>
                                                                        </div>

                                                                        <div className="gate-config-card">
                                                                            <div className="gate-config-header">
                                                                                <span>🎯</span>
                                                                                <strong>
                                                                                    Chuẩn qua bài: Đúng {interactiveObj.passScore || 1}/{questions.length} câu · Trượt quay về Slide {interactiveObj.fallbackSlideIndex || 1} · {interactiveObj.allowContinueWithoutPass ? '🔓 Cho phép học tiếp nếu chưa đạt' : '🔒 Bắt buộc đạt mới mở khóa slide sau'}
                                                                                </strong>
                                                                            </div>
                                                                        </div>

                                                                        <div className="interactive-questions-list">
                                                                            {questions.map((q: any, qIdx: number) => {
                                                                                const qType = (q.type || 'MC').toUpperCase();
                                                                                const correctAnswersList: string[] = Array.isArray(q.correctAnswers)
                                                                                    ? q.correctAnswers
                                                                                    : [q.correctAnswer || ''];
                                                                                return (
                                                                                    <div key={q.id || qIdx} className="interactive-q-item">
                                                                                        <div className="interactive-q-title">
                                                                                            <strong>Câu {qIdx + 1}:</strong> {q.question}
                                                                                            <span className={`qtype-badge qtype-${qType.toLowerCase()}`}>
                                                                                                {qType}
                                                                                            </span>
                                                                                        </div>
                                                                                        {Array.isArray(q.options) && q.options.length > 0 && (
                                                                                            <div className="interactive-q-options">
                                                                                                {q.options.map((opt: string, optIdx: number) => {
                                                                                                    const isCorrect = correctAnswersList.some(ca => (ca || '').trim().toLowerCase() === opt.trim().toLowerCase());
                                                                                                    return (
                                                                                                        <div key={optIdx} className={`interactive-opt ${isCorrect ? 'opt-correct' : ''}`}>
                                                                                                            <span className="opt-marker">{isCorrect ? '✅' : '⚪'}</span>
                                                                                                            <span className="opt-text">{opt}</span>
                                                                                                        </div>
                                                                                                    );
                                                                                                })}
                                                                                            </div>
                                                                                        )}
                                                                                        {q.explanation && (
                                                                                            <div className="interactive-q-explanation">
                                                                                                <strong>Giải thích:</strong> {q.explanation}
                                                                                            </div>
                                                                                        )}
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    </div>
                                                                ) : (
                                                                    <div className="slide-interactive-empty-state">
                                                                        <div className="empty-interactive-icon">{isAudioLabSlide ? '🎧' : '🎯'}</div>
                                                                        <div className="empty-interactive-text">
                                                                            <h5>{isAudioLabSlide ? 'Slide Bài Tập Nghe Hiểu (Độc lập)' : 'Slide Kiểm Tra Kiến Thức Độc Lập'}</h5>
                                                                            <p>Hãy bấm nút dưới đây để chọn dạng câu hỏi, phạm vi slide và tạo bộ câu hỏi kiểm tra bằng AI.</p>
                                                                        </div>
                                                                        <div className="empty-interactive-actions">
                                                                            <button
                                                                                type="button"
                                                                                className="btn-empty-interactive-ai"
                                                                                onClick={() => openInteractiveModalForSlide(slide)}
                                                                                disabled={generatingInteractionSlide === slide.index}
                                                                            >
                                                                                ✨ Tạo câu hỏi bằng AI (Chọn dạng & nguồn)
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    }

                                                    // Standard 2-Column Slide Card Body (Content Left + Image Right)
                                                    return (
                                                        <>
                                                            <div className={`slide-card-body layout-${slide.layoutType || 'split_standard'}`}>
                                                                {/* Content Column */}
                                                                <div className="slide-content-col">
                                                                    {isEditingThisContent ? (
                                                                        <div className="slide-inline-edit-container">
                                                                            <div className="inline-edit-field">
                                                                                <label>📌 Tiêu đề Slide:</label>
                                                                                <input
                                                                                    type="text"
                                                                                    className="inline-input-title"
                                                                                    value={editingTitle}
                                                                                    onChange={(e) => setEditingTitle(e.target.value)}
                                                                                    placeholder="Nhập tiêu đề slide..."
                                                                                />
                                                                            </div>

                                                                            <div className="inline-edit-field">
                                                                                <label>📝 Ý chính / Văn bản thô (Mỗi dòng 1 ý):</label>
                                                                                <textarea
                                                                                    rows={3}
                                                                                    className="inline-input-desc"
                                                                                    value={editingRawContent}
                                                                                    onChange={(e) => setEditingRawContent(e.target.value)}
                                                                                    placeholder="Nội dung văn bản thô của slide..."
                                                                                />
                                                                            </div>

                                                                            <div className="inline-edit-bullets-section">
                                                                                <label>📋 Các ý hiển thị trên slide (bullet points):</label>
                                                                                {editingBullets.map((b, bIdx) => (
                                                                                    <div key={bIdx} className="inline-bullet-row">
                                                                                        <input
                                                                                            type="text"
                                                                                            className="inline-input-emoji"
                                                                                            value={b.emoji}
                                                                                            onChange={(e) => updateEditingBullet(bIdx, 'emoji', e.target.value)}
                                                                                            title="Icon / Emoji"
                                                                                            maxLength={4}
                                                                                        />
                                                                                        <div className="inline-bullet-fields">
                                                                                            <input
                                                                                                type="text"
                                                                                                className="inline-input-point"
                                                                                                value={b.point}
                                                                                                onChange={(e) => updateEditingBullet(bIdx, 'point', e.target.value)}
                                                                                                placeholder="Ý chính..."
                                                                                            />
                                                                                            <textarea
                                                                                                rows={2}
                                                                                                className="inline-input-desc"
                                                                                                value={b.description}
                                                                                                onChange={(e) => updateEditingBullet(bIdx, 'description', e.target.value)}
                                                                                                placeholder="Mô tả chi tiết..."
                                                                                            />
                                                                                        </div>
                                                                                        <button
                                                                                            type="button"
                                                                                            className="btn-inline-delete"
                                                                                            onClick={() => removeEditingBullet(bIdx)}
                                                                                            disabled={editingBullets.length <= 1}
                                                                                            title="Xóa ý này"
                                                                                        >
                                                                                            🗑️
                                                                                        </button>
                                                                                    </div>
                                                                                ))}

                                                                                <button
                                                                                    type="button"
                                                                                    className="btn-inline-add-bullet"
                                                                                    onClick={addEditingBullet}
                                                                                >
                                                                                    ➕ Thêm ý mới
                                                                                </button>
                                                                            </div>

                                                                            <div className="inline-edit-bottom-actions">
                                                                                <button
                                                                                    type="button"
                                                                                    className="btn-save-inline"
                                                                                    onClick={() => saveSlideContent(slide.index)}
                                                                                    disabled={savingContent}
                                                                                >
                                                                                    {savingContent ? '⏳ Đang lưu...' : '💾 Lưu thay đổi'}
                                                                                </button>
                                                                                <button
                                                                                    type="button"
                                                                                    className="btn-cancel-inline"
                                                                                    onClick={cancelEditingSlideContent}
                                                                                    disabled={savingContent}
                                                                                >
                                                                                    ❌ Hủy
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    ) : bullets.length > 0 ? (
                                                                        <div className="optimized-content-wrapper">
                                                                            <ul className="bullet-list">
                                                                                {bullets.map((b, bIdx) => (
                                                                                    <li key={bIdx}>
                                                                                        <span className="emoji">{b.emoji || '📌'}</span>
                                                                                        <strong>{b.point}</strong>
                                                                                        {b.description && (
                                                                                            <span className="description"> - {b.description}</span>
                                                                                        )}
                                                                                    </li>
                                                                                ))}
                                                                            </ul>
                                                                        </div>
                                                                    ) : slide.content ? (
                                                                        <div className="slide-raw-content-box">
                                                                            <div className="raw-content-header">
                                                                                <span className="raw-content-label">📝 Nội dung bóc tách từ PPTX:</span>
                                                                                <button
                                                                                    type="button"
                                                                                    className="btn-quick-ai"
                                                                                    onClick={() => handleRegenerateSlideContent(slide.index)}
                                                                                    disabled={isRegenContent}
                                                                                >
                                                                                    ✨ AI tối ưu nội dung
                                                                                </button>
                                                                            </div>
                                                                            <p className="raw-content-text">{slide.content}</p>
                                                                        </div>
                                                                    ) : (
                                                                        <div className="placeholder-content-box">
                                                                            <p className="placeholder">Slide này chưa có nội dung văn bản chi tiết.</p>
                                                                            <div className="placeholder-actions">
                                                                                <button
                                                                                    type="button"
                                                                                    className="btn-small btn-action-edit"
                                                                                    onClick={() => startEditingSlideContent(slide)}
                                                                                >
                                                                                    ✏️ Bổ sung ý chính
                                                                                </button>
                                                                                <button
                                                                                    type="button"
                                                                                    className="btn-small btn-highlight-ai"
                                                                                    onClick={() => handleRegenerateSlideContent(slide.index)}
                                                                                    disabled={isRegenContent}
                                                                                >
                                                                                    ✨ AI tạo theo tiêu đề
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </div>

                                                                {/* Image Column (Fixed 220px width via Steps.css + PptxAudioTool.css) */}
                                                                <div className="slide-image-col">
                                                                    <div className="slide-image-wrapper">
                                                                        {fullImageUrl ? (
                                                                            <img src={fullImageUrl} alt={`Slide ${oneBasedIdx}`} />
                                                                        ) : (
                                                                            <div className="image-placeholder">🖼️</div>
                                                                        )}

                                                                        <label
                                                                            className="btn-image-overlay-upload"
                                                                            title="Tải ảnh mới từ máy tính (tự động căn chỉnh & cắt tỷ lệ 1:1)"
                                                                            style={{ cursor: (isUploadingImg || isRegenImage) ? 'not-allowed' : 'pointer', margin: 0 }}
                                                                        >
                                                                            📤 Đổi ảnh
                                                                            <input
                                                                                type="file"
                                                                                accept="image/png,image/jpeg,image/jpg,image/webp"
                                                                                style={{ display: 'none' }}
                                                                                disabled={isUploadingImg || isRegenImage}
                                                                                onChange={(e) => {
                                                                                    const file = e.target.files?.[0];
                                                                                    if (file) {
                                                                                        handleSelectImageForCrop(slide.index, file);
                                                                                        e.target.value = '';
                                                                                    }
                                                                                }}
                                                                            />
                                                                        </label>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* Extra Audio Bar if attached */}
                                                            {slide.extraAudioUrl && fullExtraAudioUrl && (
                                                                <div className="slide-extra-audio-bar">
                                                                    <div className="extra-audio-info">
                                                                        <span className="extra-audio-icon">🎧</span>
                                                                        <span className="extra-audio-label">Audio mẫu:</span>
                                                                        <span className="extra-audio-name" title={slide.extraAudioName || 'Audio mẫu'}>
                                                                            {slide.extraAudioName || 'Audio mẫu'}
                                                                        </span>
                                                                    </div>
                                                                    <div className="extra-audio-controls">
                                                                        <audio
                                                                            controls
                                                                            src={fullExtraAudioUrl}
                                                                            className="extra-audio-player"
                                                                            preload="none"
                                                                        />
                                                                        <button
                                                                            type="button"
                                                                            className="btn-extra-audio-delete"
                                                                            onClick={() => handleDeleteExtraAudio(slide.index)}
                                                                            title="Xóa file audio mẫu"
                                                                        >
                                                                            🗑️ Xóa
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {/* Expanded Interactive Questions Preview & Inline Editor when attached to a theory slide */}
                                                            {interactiveObj && expandedInteractiveSlide === slide.index && (
                                                                <div className="slide-interactive-preview-box" style={{ margin: '0 16px 12px 16px' }}>
                                                                    <div className="interactive-preview-header">
                                                                        <div className="interactive-header-title">
                                                                            <span className="interactive-icon">🎯</span>
                                                                            <strong>{interactiveObj.badgeLabel || 'Hoạt động tương tác trên Slide'}</strong>
                                                                            <span className="interactive-count-pill">{questions.length} câu hỏi</span>
                                                                        </div>
                                                                        <div className="interactive-header-actions">
                                                                            {editingInteractiveSlide !== slide.index ? (
                                                                                <button
                                                                                    type="button"
                                                                                    className="btn-text-reconfig"
                                                                                    onClick={() => startEditingInteractiveQuestions(slide)}
                                                                                >
                                                                                    ✏️ Sửa bộ câu hỏi
                                                                                </button>
                                                                            ) : (
                                                                                <>
                                                                                    <button
                                                                                        type="button"
                                                                                        className="btn-save-inline"
                                                                                        onClick={() => saveInteractiveQuestions(slide.index)}
                                                                                        disabled={savingInteractiveSlide}
                                                                                    >
                                                                                        {savingInteractiveSlide ? '⏳ Đang lưu...' : '💾 Lưu câu hỏi'}
                                                                                    </button>
                                                                                    <button
                                                                                        type="button"
                                                                                        className="btn-cancel-inline"
                                                                                        onClick={() => {
                                                                                            setEditingInteractiveSlide(null);
                                                                                            setEditingInteractiveForm(null);
                                                                                        }}
                                                                                    >
                                                                                        Hủy
                                                                                    </button>
                                                                                </>
                                                                            )}
                                                                        </div>
                                                                    </div>

                                                                    {editingInteractiveSlide === slide.index && editingInteractiveForm ? (
                                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                                                            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                                                                                <label style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>
                                                                                    Số câu đạt tối thiểu:{' '}
                                                                                    <input
                                                                                        type="number"
                                                                                        min={1}
                                                                                        max={editingInteractiveForm.questions?.length || 10}
                                                                                        value={editingInteractiveForm.passScore || 1}
                                                                                        onChange={(e) => setEditingInteractiveForm({ ...editingInteractiveForm, passScore: Number(e.target.value) })}
                                                                                        className="gate-config-input"
                                                                                    />
                                                                                </label>
                                                                                <label style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>
                                                                                    Quay về Slide số:{' '}
                                                                                    <input
                                                                                        type="number"
                                                                                        min={1}
                                                                                        max={slides.length}
                                                                                        value={editingInteractiveForm.fallbackSlideIndex || 1}
                                                                                        onChange={(e) => setEditingInteractiveForm({ ...editingInteractiveForm, fallbackSlideIndex: Number(e.target.value) })}
                                                                                        className="gate-config-input"
                                                                                    />
                                                                                </label>
                                                                            </div>
                                                                            {(editingInteractiveForm.questions || []).map((qItem: any, qIdx: number) => (
                                                                                <div key={qIdx} className="interactive-q-item">
                                                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                                                                                        <strong style={{ fontSize: '0.82rem', color: '#93c5fd' }}>Câu {qIdx + 1} ({qItem.type || 'MC'})</strong>
                                                                                        <button
                                                                                            type="button"
                                                                                            className="btn-text-danger"
                                                                                            onClick={() => {
                                                                                                const nextQs = editingInteractiveForm.questions.filter((_: any, i: number) => i !== qIdx);
                                                                                                setEditingInteractiveForm({ ...editingInteractiveForm, questions: nextQs });
                                                                                            }}
                                                                                        >
                                                                                            🗑️ Xóa câu
                                                                                        </button>
                                                                                    </div>
                                                                                    <input
                                                                                        type="text"
                                                                                        value={qItem.question || ''}
                                                                                        onChange={(e) => {
                                                                                            const nextQs = [...editingInteractiveForm.questions];
                                                                                            nextQs[qIdx] = { ...nextQs[qIdx], question: e.target.value };
                                                                                            setEditingInteractiveForm({ ...editingInteractiveForm, questions: nextQs });
                                                                                        }}
                                                                                        placeholder="Nội dung câu hỏi..."
                                                                                        className="inline-input-point"
                                                                                        style={{ marginBottom: 6 }}
                                                                                    />
                                                                                    {Array.isArray(qItem.options) && (
                                                                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
                                                                                            {qItem.options.map((optVal: string, oIdx: number) => (
                                                                                                <input
                                                                                                    key={oIdx}
                                                                                                    type="text"
                                                                                                    value={optVal}
                                                                                                    onChange={(e) => {
                                                                                                        const nextQs = [...editingInteractiveForm.questions];
                                                                                                        const nextOpts = [...nextQs[qIdx].options];
                                                                                                        nextOpts[oIdx] = e.target.value;
                                                                                                        nextQs[qIdx] = { ...nextQs[qIdx], options: nextOpts };
                                                                                                        setEditingInteractiveForm({ ...editingInteractiveForm, questions: nextQs });
                                                                                                    }}
                                                                                                    className="inline-input-point"
                                                                                                />
                                                                                            ))}
                                                                                        </div>
                                                                                    )}
                                                                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                                                                        <input
                                                                                            type="text"
                                                                                            value={qItem.correctAnswer || ''}
                                                                                            onChange={(e) => {
                                                                                                const nextQs = [...editingInteractiveForm.questions];
                                                                                                nextQs[qIdx] = { ...nextQs[qIdx], correctAnswer: e.target.value };
                                                                                                setEditingInteractiveForm({ ...editingInteractiveForm, questions: nextQs });
                                                                                            }}
                                                                                            placeholder="Đáp án đúng..."
                                                                                            className="inline-input-point"
                                                                                            style={{ flex: 1 }}
                                                                                        />
                                                                                        <input
                                                                                            type="text"
                                                                                            value={qItem.explanation || ''}
                                                                                            onChange={(e) => {
                                                                                                const nextQs = [...editingInteractiveForm.questions];
                                                                                                nextQs[qIdx] = { ...nextQs[qIdx], explanation: e.target.value };
                                                                                                setEditingInteractiveForm({ ...editingInteractiveForm, questions: nextQs });
                                                                                            }}
                                                                                            placeholder="Giải thích đáp án..."
                                                                                            className="inline-input-point"
                                                                                            style={{ flex: 2 }}
                                                                                        />
                                                                                    </div>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    ) : (
                                                                        <div className="interactive-questions-list">
                                                                            {questions.map((qItem: any, qIdx: number) => (
                                                                                <div key={qIdx} className="interactive-q-item">
                                                                                    <div className="interactive-q-title">
                                                                                        <strong>Câu {qIdx + 1}:</strong> {qItem.question}
                                                                                        <span className="qtype-badge">{qItem.type || 'MC'}</span>
                                                                                    </div>
                                                                                    {Array.isArray(qItem.options) && qItem.options.length > 0 && (
                                                                                        <div className="interactive-q-options">
                                                                                            {qItem.options.map((opt: string, oIdx: number) => {
                                                                                                const isCorr = opt === qItem.correctAnswer || (Array.isArray(qItem.correctAnswers) && qItem.correctAnswers.includes(opt));
                                                                                                return (
                                                                                                    <div key={oIdx} className={`interactive-opt ${isCorr ? 'opt-correct' : ''}`}>
                                                                                                        <span className="opt-marker">{isCorr ? '✅' : '⚪'}</span>
                                                                                                        <span className="opt-text">{opt}</span>
                                                                                                    </div>
                                                                                                );
                                                                                            })}
                                                                                        </div>
                                                                                    )}
                                                                                    {qItem.explanation && (
                                                                                        <div className="interactive-q-explanation">
                                                                                            <strong>Giải thích:</strong> {qItem.explanation}
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </>
                                                    );
                                                })()}

                                                {/* Slide Card Footer Actions (Exact Step 5 classes) */}
                                                {!isEditingThisContent && (
                                                    <div className="slide-card-actions">
                                                        <button
                                                            type="button"
                                                            className="btn-small btn-action-edit"
                                                            onClick={() => startEditingSlideContent(slide)}
                                                            disabled={isRegenContent}
                                                            title="Chỉnh sửa trực tiếp tiêu đề, ý chính và các ý trong slide"
                                                        >
                                                            ✏️ Sửa nội dung
                                                        </button>

                                                        <label
                                                            className="btn-small btn-action-upload"
                                                            title="Tải ảnh từ máy tính (tự động căn chỉnh & resize 1:1)"
                                                            style={{ cursor: (isUploadingImg || isRegenImage) ? 'not-allowed' : 'pointer', margin: 0 }}
                                                        >
                                                            {isUploadingImg ? '⏳ Đang tải...' : '📤 Đổi ảnh'}
                                                            <input
                                                                type="file"
                                                                accept="image/png,image/jpeg,image/jpg,image/webp"
                                                                style={{ display: 'none' }}
                                                                disabled={isUploadingImg || isRegenImage}
                                                                onChange={(e) => {
                                                                    const file = e.target.files?.[0];
                                                                    if (file) {
                                                                        handleSelectImageForCrop(slide.index, file);
                                                                        e.target.value = '';
                                                                    }
                                                                }}
                                                            />
                                                        </label>

                                                        {!slide.extraAudioUrl && (
                                                            <label
                                                                className="btn-small btn-action-audio"
                                                                title="Tải audio mẫu bài giảng"
                                                                style={{ cursor: uploadingExtraAudioSlide === slide.index ? 'not-allowed' : 'pointer', margin: 0 }}
                                                            >
                                                                {uploadingExtraAudioSlide === slide.index ? '⏳ Đang tải...' : '🎧 Tải audio mẫu'}
                                                                <input
                                                                    type="file"
                                                                    accept="audio/*"
                                                                    style={{ display: 'none' }}
                                                                    disabled={uploadingExtraAudioSlide === slide.index}
                                                                    onChange={(e) => {
                                                                        const f = e.target.files?.[0];
                                                                        if (f) {
                                                                            handleUploadExtraAudio(slide.index, f);
                                                                            e.target.value = '';
                                                                        }
                                                                    }}
                                                                />
                                                            </label>
                                                        )}

                                                        <button
                                                            type="button"
                                                            className={`btn-small ${!hasOptimizedBullets ? 'btn-highlight-ai' : ''}`}
                                                            onClick={() => handleRegenerateSlideContent(slide.index)}
                                                            disabled={isRegenContent}
                                                            title="Dùng AI phân tích ý chính hoặc tiêu đề để tạo/viết lại nội dung slide"
                                                        >
                                                            {isRegenContent ? '⏳ Đang tối ưu...' : !hasOptimizedBullets ? '✨ AI tối ưu nội dung' : '🔄 Tạo lại nội dung'}
                                                        </button>

                                                        <button
                                                            type="button"
                                                            className="btn-small"
                                                            onClick={() => handleRegenerateSlideImage(slide.index)}
                                                            disabled={isRegenImage || isUploadingImg}
                                                            title="Dùng AI vẽ hình minh họa mới cho slide này"
                                                        >
                                                            {isRegenImage ? '⏳ Đang vẽ...' : '🖼️ Tạo lại ảnh'}
                                                        </button>

                                                        {interactiveObj && Array.isArray(interactiveObj.questions) && interactiveObj.questions.length > 0 && (
                                                            <button
                                                                type="button"
                                                                className="btn-small btn-action-interactive-active"
                                                                onClick={() => setExpandedInteractiveSlide(expandedInteractiveSlide === slide.index ? null : slide.index)}
                                                            >
                                                                🎯 {interactiveObj.questions.length} câu hỏi ({expandedInteractiveSlide === slide.index ? 'Ẩn' : 'Xem'})
                                                            </button>
                                                        )}

                                                        <button
                                                            type="button"
                                                            className="btn-small btn-action-interactive-active"
                                                            onClick={() => openInteractiveModalForSlide(slide)}
                                                            disabled={generatingInteractionSlide === slide.index}
                                                            title="Tạo hoặc cấu hình bộ câu hỏi tương tác / kiểm tra chặn bài trên slide này"
                                                        >
                                                            {generatingInteractionSlide === slide.index
                                                                ? '⏳ Đang tạo câu hỏi...'
                                                                : interactiveObj
                                                                    ? '⚙️ Cấu hình Tương tác'
                                                                    : '🎯 + Gắn câu hỏi tương tác'}
                                                        </button>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Insert divider after this slide with 2 hover buttons (Exact Step 5 classes) */}
                                            <div
                                                className="slide-insert-divider"
                                                title={`Chèn slide mới vào sau Slide ${oneBasedIdx}`}
                                            >
                                                <div className="slide-insert-btn-pair">
                                                    <button
                                                        type="button"
                                                        className="btn-slide-insert-mini theory"
                                                        onClick={() => openAddSlideModal(oneBasedIdx)}
                                                        title={`Chèn slide lý thuyết sau Slide ${oneBasedIdx}`}
                                                    >
                                                        📖 + Lý thuyết
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="btn-slide-insert-mini interactive"
                                                        onClick={() => openInteractiveModalForInsert(oneBasedIdx)}
                                                        title={`Chèn slide tương tác sau Slide ${oneBasedIdx}`}
                                                    >
                                                        🎯 + Tương tác
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {slides.length > 0 && (
                                <div className="add-slide-bottom-bar">
                                    <div className="add-slide-btn-group">
                                        <button
                                            type="button"
                                            className="btn-add-slide-theory"
                                            onClick={() => openAddSlideModal(-1)}
                                        >
                                            📖 + Thêm slide lý thuyết
                                        </button>
                                        <button
                                            type="button"
                                            className="btn-add-slide-interactive"
                                            onClick={() => openInteractiveModalForInsert(-1)}
                                        >
                                            🎯 + Thêm slide tương tác
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* ── MODALS FOR STEP 3 (SLIDE WORKSPACE) ── */}

                        {/* 1. Image Crop 1:1 Modal */}
                        {cropModalImageSrc && cropModalSlideIndex !== null && (
                            <ImageCropModal
                                isOpen={true}
                                imageSrc={cropModalImageSrc}
                                slideIndex={cropModalSlideIndex + 1}
                                onClose={() => {
                                    setCropModalImageSrc(null);
                                    setCropModalSlideIndex(null);
                                }}
                                onCropComplete={handleUploadCroppedImage}
                                isUploading={uploadingSlideImage !== null}
                            />
                        )}

                        {/* 2. Add Theory Slide Modal */}
                        {showAddSlideModal && (
                            <div
                                className="modal-backdrop"
                                onClick={() => !creatingSlide && setShowAddSlideModal(false)}
                                style={{
                                    position: 'fixed',
                                    inset: 0,
                                    background: 'rgba(0, 0, 0, 0.72)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    zIndex: 9999,
                                    padding: '20px',
                                }}
                            >
                                <div
                                    onClick={(e) => e.stopPropagation()}
                                    style={{
                                        background: '#1e293b',
                                        border: '1px solid rgba(255, 255, 255, 0.15)',
                                        borderRadius: '14px',
                                        maxWidth: '580px',
                                        width: '100%',
                                        padding: '24px',
                                        color: '#f1f5f9',
                                        boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                        <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#60a5fa' }}>
                                            ➕ {addSlideInsertAfter === 0
                                                ? 'Chèn Slide Lý thuyết vào đầu bài giảng'
                                                : addSlideInsertAfter > 0
                                                    ? `Chèn Slide Lý thuyết vào sau Slide ${addSlideInsertAfter}`
                                                    : 'Thêm Slide Lý thuyết vào cuối bài giảng'}
                                        </h3>
                                        <button
                                            type="button"
                                            onClick={() => !creatingSlide && setShowAddSlideModal(false)}
                                            style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '1.25rem', cursor: 'pointer' }}
                                        >
                                            ✕
                                        </button>
                                    </div>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.85rem', color: '#cbd5e1', marginBottom: '4px', fontWeight: 600 }}>
                                                Tiêu đề Slide:
                                            </label>
                                            <input
                                                type="text"
                                                value={newSlideTitle}
                                                onChange={(e) => setNewSlideTitle(e.target.value)}
                                                placeholder="Nhập tiêu đề slide mới..."
                                                style={{
                                                    width: '100%',
                                                    padding: '9px 12px',
                                                    borderRadius: '8px',
                                                    border: '1px solid #334155',
                                                    background: '#0f172a',
                                                    color: '#f8fafc',
                                                }}
                                            />
                                        </div>

                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.85rem', color: '#cbd5e1', marginBottom: '4px', fontWeight: 600 }}>
                                                Nội dung Slide (mỗi dòng 1 ý):
                                            </label>
                                            <textarea
                                                value={newSlideContent}
                                                onChange={(e) => setNewSlideContent(e.target.value)}
                                                placeholder="Nhập các ý chính của slide (hoặc để trống rồi bấm 'AI tối ưu nội dung' sau khi tạo)..."
                                                rows={4}
                                                style={{
                                                    width: '100%',
                                                    padding: '9px 12px',
                                                    borderRadius: '8px',
                                                    border: '1px solid #334155',
                                                    background: '#0f172a',
                                                    color: '#f8fafc',
                                                }}
                                            />
                                        </div>

                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.85rem', color: '#cbd5e1', marginBottom: '4px', fontWeight: 600 }}>
                                                Lời giảng / Speaker Note (Tùy chọn):
                                            </label>
                                            <textarea
                                                value={newSlideSpeakerNote}
                                                onChange={(e) => setNewSlideSpeakerNote(e.target.value)}
                                                placeholder="Nhập lời giảng thuyết minh cho slide này..."
                                                rows={3}
                                                style={{
                                                    width: '100%',
                                                    padding: '9px 12px',
                                                    borderRadius: '8px',
                                                    border: '1px solid #334155',
                                                    background: '#0f172a',
                                                    color: '#f8fafc',
                                                }}
                                            />
                                        </div>
                                    </div>

                                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px' }}>
                                        <button
                                            type="button"
                                            onClick={() => setShowAddSlideModal(false)}
                                            disabled={creatingSlide}
                                            className="btn-cancel-edit"
                                        >
                                            Hủy
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleCreateSlide}
                                            disabled={creatingSlide}
                                            className="btn-save-edit"
                                        >
                                            {creatingSlide ? '⏳ Đang tạo...' : '➕ Tạo Slide'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* 3. Interactive Slide Configuration Modal (Mastery Gate / Audio Lab) */}
                        {interactiveConfigModal.isOpen && (
                            <div
                                className="modal-backdrop"
                                onClick={() => !isSubmittingInteractiveModal && setInteractiveConfigModal(prev => ({ ...prev, isOpen: false }))}
                                style={{
                                    position: 'fixed',
                                    inset: 0,
                                    background: 'rgba(0, 0, 0, 0.78)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    zIndex: 9999,
                                    padding: '20px',
                                }}
                            >
                                <div
                                    onClick={(e) => e.stopPropagation()}
                                    style={{
                                        background: '#1e293b',
                                        border: '1px solid rgba(245, 158, 11, 0.35)',
                                        borderRadius: '16px',
                                        maxWidth: '720px',
                                        width: '100%',
                                        maxHeight: '90vh',
                                        overflowY: 'auto',
                                        padding: '24px 28px',
                                        color: '#f1f5f9',
                                        boxShadow: '0 24px 60px rgba(0,0,0,0.65)',
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                        <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#fcd34d' }}>
                                            🎯 {interactiveConfigModal.mode === 'insert'
                                                ? 'Chèn Slide Câu Hỏi Kiểm Tra / Tương Tác (Mastery Gate)'
                                                : `Cấu Hình Câu Hỏi Tương Tác (Slide ${(interactiveConfigModal.targetSlideIndex ?? 0) + 1})`}
                                        </h3>
                                        <button
                                            type="button"
                                            onClick={() => !isSubmittingInteractiveModal && setInteractiveConfigModal(prev => ({ ...prev, isOpen: false }))}
                                            style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '1.3rem', cursor: 'pointer' }}
                                        >
                                            ✕
                                        </button>
                                    </div>

                                    {/* Mode selector: Generate New vs Extract Existing */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
                                        <button
                                            type="button"
                                            onClick={() => setInteractiveConfigModal(prev => ({ ...prev, generationMode: 'generate_new', sourceType: 'slide_range' }))}
                                            style={{
                                                padding: '10px 14px',
                                                borderRadius: '10px',
                                                border: `2px solid ${interactiveConfigModal.generationMode === 'generate_new' ? '#f59e0b' : 'rgba(148,163,184,0.2)'}`,
                                                background: interactiveConfigModal.generationMode === 'generate_new' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(15, 23, 42, 0.6)',
                                                color: '#f8fafc',
                                                cursor: 'pointer',
                                                textAlign: 'left',
                                            }}
                                        >
                                            <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>✨ AI Tự Sinh Câu Hỏi Mới</div>
                                            <div style={{ fontSize: '0.76rem', color: '#94a3b8', marginTop: 2 }}>Từ nội dung các slide trước, văn bản hoặc file nghe</div>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setInteractiveConfigModal(prev => ({ ...prev, generationMode: 'extract_existing', sourceType: 'custom_text' }))}
                                            style={{
                                                padding: '10px 14px',
                                                borderRadius: '10px',
                                                border: `2px solid ${interactiveConfigModal.generationMode === 'extract_existing' ? '#f59e0b' : 'rgba(148,163,184,0.2)'}`,
                                                background: interactiveConfigModal.generationMode === 'extract_existing' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(15, 23, 42, 0.6)',
                                                color: '#f8fafc',
                                                cursor: 'pointer',
                                                textAlign: 'left',
                                            }}
                                        >
                                            <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>📄 Trích Xuất Đề Có Sẵn</div>
                                            <div style={{ fontSize: '0.76rem', color: '#94a3b8', marginTop: 2 }}>Dán đề thi, tải file Word/PDF hoặc ảnh chụp bài tập</div>
                                        </button>
                                    </div>

                                    {interactiveConfigModal.mode === 'insert' && (
                                        <div style={{ marginBottom: '14px' }}>
                                            <label style={{ display: 'block', fontSize: '0.84rem', color: '#cbd5e1', marginBottom: 4, fontWeight: 600 }}>
                                                Tiêu đề Slide kiểm tra:
                                            </label>
                                            <input
                                                type="text"
                                                value={interactiveConfigModal.slideTitle}
                                                onChange={(e) => setInteractiveConfigModal(prev => ({ ...prev, slideTitle: e.target.value }))}
                                                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: '#f8fafc' }}
                                            />
                                        </div>
                                    )}

                                    {/* Source Type Selector */}
                                    {interactiveConfigModal.generationMode === 'generate_new' && (
                                        <div style={{ marginBottom: '14px' }}>
                                            <label style={{ display: 'block', fontSize: '0.84rem', color: '#cbd5e1', marginBottom: 6, fontWeight: 600 }}>
                                                Nguồn kiến thức để tạo câu hỏi:
                                            </label>
                                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                                {[
                                                    { id: 'slide_range', label: '📑 Khoảng Slide trước đó' },
                                                    { id: 'custom_text', label: '📝 Văn bản / Tài liệu Word-PDF' },
                                                    { id: 'audio', label: '🎧 File Nghe (Listening Lab)' },
                                                    { id: 'image', label: '🖼️ Ảnh sơ đồ / Bài tập' },
                                                ].map(src => (
                                                    <button
                                                        key={src.id}
                                                        type="button"
                                                        onClick={() => setInteractiveConfigModal(prev => ({ ...prev, sourceType: src.id as any }))}
                                                        style={{
                                                            padding: '6px 12px',
                                                            borderRadius: 8,
                                                            border: `1px solid ${interactiveConfigModal.sourceType === src.id ? '#f59e0b' : '#334155'}`,
                                                            background: interactiveConfigModal.sourceType === src.id ? 'rgba(245, 158, 11, 0.2)' : '#0f172a',
                                                            color: interactiveConfigModal.sourceType === src.id ? '#fcd34d' : '#cbd5e1',
                                                            fontSize: '0.82rem',
                                                            cursor: 'pointer',
                                                        }}
                                                    >
                                                        {src.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Source Details */}
                                    {interactiveConfigModal.generationMode === 'generate_new' && interactiveConfigModal.sourceType === 'slide_range' && (
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14, padding: 12, borderRadius: 10, background: 'rgba(15, 23, 42, 0.6)' }}>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: 4 }}>Từ Slide số:</label>
                                                <input
                                                    type="number"
                                                    min={1}
                                                    max={slides.length}
                                                    value={interactiveConfigModal.fromSlideIndex}
                                                    onChange={(e) => {
                                                        const v = Math.max(1, Number(e.target.value));
                                                        setInteractiveConfigModal(prev => ({ ...prev, fromSlideIndex: v, fallbackSlideIndex: v }));
                                                    }}
                                                    style={{ width: '100%', padding: '7px 10px', borderRadius: 6, background: '#1e293b', color: '#fff', border: '1px solid #475569' }}
                                                />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: 4 }}>Đến Slide số:</label>
                                                <input
                                                    type="number"
                                                    min={1}
                                                    max={slides.length}
                                                    value={interactiveConfigModal.toSlideIndex}
                                                    onChange={(e) => setInteractiveConfigModal(prev => ({ ...prev, toSlideIndex: Math.max(1, Number(e.target.value)) }))}
                                                    style={{ width: '100%', padding: '7px 10px', borderRadius: 6, background: '#1e293b', color: '#fff', border: '1px solid #475569' }}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {(interactiveConfigModal.generationMode === 'extract_existing' || interactiveConfigModal.sourceType === 'custom_text' || interactiveConfigModal.sourceType === 'audio' || interactiveConfigModal.sourceType === 'image') && (
                                        <div style={{ marginBottom: 14 }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
                                                <label style={{ fontSize: '0.84rem', color: '#cbd5e1', fontWeight: 600 }}>
                                                    {interactiveConfigModal.generationMode === 'extract_existing'
                                                        ? 'Nội dung đề bài có sẵn (Dán văn bản hoặc tải file Word/PDF/Ảnh):'
                                                        : 'Nội dung / Kịch bản / Transcript bổ sung:'}
                                                </label>
                                                <div style={{ display: 'flex', gap: 8 }}>
                                                    <label className="btn-regenerate-small" style={{ cursor: 'pointer', margin: 0 }}>
                                                        {isExtractingInteractiveFile ? '⏳ Đang đọc...' : '📎 Tải Word / PDF'}
                                                        <input
                                                            type="file"
                                                            accept=".docx,.pdf,.txt,.md"
                                                            style={{ display: 'none' }}
                                                            onChange={handleExtractInteractiveDocFile}
                                                            disabled={isExtractingInteractiveFile}
                                                        />
                                                    </label>
                                                    <label className="btn-regenerate-small" style={{ cursor: 'pointer', margin: 0 }}>
                                                        🖼️ Đính kèm Ảnh đề bài
                                                        <input
                                                            type="file"
                                                            accept="image/*"
                                                            style={{ display: 'none' }}
                                                            onChange={handleSelectInteractiveImage}
                                                        />
                                                    </label>
                                                </div>
                                            </div>
                                            {extractedInteractiveFileName && (
                                                <div style={{ fontSize: '0.78rem', color: '#6ee7b7', marginBottom: 4 }}>
                                                    ✅ Đã đọc nội dung từ: {extractedInteractiveFileName}
                                                </div>
                                            )}
                                            {interactiveConfigModal.imageFileName && (
                                                <div style={{ fontSize: '0.78rem', color: '#93c5fd', marginBottom: 4 }}>
                                                    🖼️ Ảnh đính kèm: {interactiveConfigModal.imageFileName}
                                                    <button
                                                        type="button"
                                                        onClick={() => setInteractiveConfigModal(prev => ({ ...prev, imageBase64: '', imageFileName: '' }))}
                                                        style={{ marginLeft: 8, background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer' }}
                                                    >
                                                        ✕
                                                    </button>
                                                </div>
                                            )}
                                            <textarea
                                                value={interactiveConfigModal.customContent}
                                                onChange={(e) => setInteractiveConfigModal(prev => ({ ...prev, customContent: e.target.value }))}
                                                rows={4}
                                                placeholder="Dán nội dung tài liệu, transcript bài nghe hoặc đề bài trắc nghiệm có sẵn vào đây..."
                                                style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: '#f8fafc' }}
                                            />
                                        </div>
                                    )}

                                    {interactiveConfigModal.sourceType === 'audio' && (
                                        <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                                            <label style={{ display: 'block', fontSize: '0.84rem', color: '#6ee7b7', marginBottom: 6, fontWeight: 600 }}>
                                                🎧 Tệp âm thanh bài nghe (Audio Lab):
                                            </label>
                                            <input
                                                type="file"
                                                accept="audio/*"
                                                onChange={(e) => {
                                                    const f = e.target.files?.[0] || null;
                                                    setInteractiveConfigModal(prev => ({ ...prev, audioFile: f }));
                                                }}
                                                style={{ fontSize: '0.82rem', color: '#cbd5e1' }}
                                            />
                                            {interactiveConfigModal.existingAudioName && !interactiveConfigModal.audioFile && (
                                                <div style={{ fontSize: '0.78rem', color: '#a7f3d0', marginTop: 4 }}>
                                                    Đang dùng audio mẫu: <strong>{interactiveConfigModal.existingAudioName}</strong>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Question Types Selection (7 Types) */}
                                    <div style={{ marginBottom: 14 }}>
                                        <label style={{ display: 'block', fontSize: '0.84rem', color: '#cbd5e1', marginBottom: 6, fontWeight: 600 }}>
                                            Các dạng câu hỏi tương tác muốn tạo:
                                        </label>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                            {[
                                                { id: 'MC', label: '🔘 Trắc nghiệm 1 đáp án (MC)' },
                                                { id: 'TF', label: '⚖️ Đúng / Sai (TF)' },
                                                { id: 'MR', label: '☑️ Nhiều đáp án đúng (MR)' },
                                                { id: 'FIB', label: '✍️ Điền từ (FIB)' },
                                                { id: 'MATCH', label: '🔄 Nối cặp (MATCH)' },
                                                { id: 'ORDER', label: '🔤 Sắp xếp câu (ORDER)' },
                                                { id: 'CLOZE', label: '📝 Điền khuyết đoạn văn (CLOZE)' },
                                            ].map(qt => {
                                                const active = interactiveConfigModal.selectedQuestionTypes.includes(qt.id);
                                                return (
                                                    <button
                                                        key={qt.id}
                                                        type="button"
                                                        onClick={() => toggleInteractiveQuestionType(qt.id)}
                                                        style={{
                                                            padding: '5px 10px',
                                                            borderRadius: 6,
                                                            border: `1px solid ${active ? '#8b5cf6' : '#334155'}`,
                                                            background: active ? 'rgba(139, 92, 246, 0.22)' : '#0f172a',
                                                            color: active ? '#ddd6fe' : '#94a3b8',
                                                            fontSize: '0.78rem',
                                                            cursor: 'pointer',
                                                        }}
                                                    >
                                                        {qt.label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Mastery Gate Settings: Question Count, Pass Score, Fallback Slide, Allow Continue */}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, padding: 14, borderRadius: 10, background: 'rgba(15, 23, 42, 0.65)', border: '1px solid rgba(148, 163, 184, 0.2)', marginBottom: 14 }}>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.78rem', color: '#94a3b8', marginBottom: 4 }}>Số lượng câu hỏi:</label>
                                            <input
                                                type="number"
                                                min={1}
                                                max={20}
                                                value={interactiveConfigModal.questionCount}
                                                onChange={(e) => {
                                                    const cnt = Math.max(1, Number(e.target.value));
                                                    setInteractiveConfigModal(prev => ({
                                                        ...prev,
                                                        questionCount: cnt,
                                                        passScore: Math.min(prev.passScore, cnt),
                                                    }));
                                                }}
                                                style={{ width: '100%', padding: '6px 10px', borderRadius: 6, background: '#1e293b', color: '#fff', border: '1px solid #475569' }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.78rem', color: '#94a3b8', marginBottom: 4 }}>Số câu đạt tối thiểu (Pass):</label>
                                            <input
                                                type="number"
                                                min={1}
                                                max={interactiveConfigModal.questionCount}
                                                value={interactiveConfigModal.passScore}
                                                onChange={(e) => setInteractiveConfigModal(prev => ({ ...prev, passScore: Math.max(1, Number(e.target.value)) }))}
                                                style={{ width: '100%', padding: '6px 10px', borderRadius: 6, background: '#1e293b', color: '#fff', border: '1px solid #475569' }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.78rem', color: '#94a3b8', marginBottom: 4 }}>Trượt quay lại ôn từ Slide:</label>
                                            <input
                                                type="number"
                                                min={1}
                                                max={slides.length}
                                                value={interactiveConfigModal.fallbackSlideIndex}
                                                onChange={(e) => setInteractiveConfigModal(prev => ({ ...prev, fallbackSlideIndex: Math.max(1, Number(e.target.value)) }))}
                                                style={{ width: '100%', padding: '6px 10px', borderRadius: 6, background: '#1e293b', color: '#fff', border: '1px solid #475569' }}
                                            />
                                        </div>
                                    </div>

                                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.84rem', color: '#cbd5e1', cursor: 'pointer', marginBottom: 18 }}>
                                        <input
                                            type="checkbox"
                                            checked={interactiveConfigModal.allowContinueWithoutPass}
                                            onChange={(e) => setInteractiveConfigModal(prev => ({ ...prev, allowContinueWithoutPass: e.target.checked }))}
                                        />
                                        Cho phép sinh viên tiếp tục qua slide tiếp theo kể cả khi chưa đạt điểm chuẩn (Chế độ luyện tập không chặn bài)
                                    </label>

                                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                                        <button
                                            type="button"
                                            onClick={() => setInteractiveConfigModal(prev => ({ ...prev, isOpen: false }))}
                                            disabled={isSubmittingInteractiveModal}
                                            className="btn-cancel-edit"
                                        >
                                            Hủy
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleSubmitInteractiveConfigModal}
                                            disabled={isSubmittingInteractiveModal}
                                            className="btn-save-edit"
                                            style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}
                                        >
                                            {isSubmittingInteractiveModal
                                                ? '⏳ AI đang thiết kế hoạt động tương tác...'
                                                : interactiveConfigModal.mode === 'insert'
                                                    ? '🎯 Chèn Slide & Tạo Câu Hỏi Ngay'
                                                    : '✨ Tạo Bộ Câu Hỏi Tương Tác'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* 4. Moodle LMS Guide Modal */}
                        {showMoodleGuide && (
                            <div
                                className="modal-backdrop"
                                onClick={() => setShowMoodleGuide(false)}
                                style={{
                                    position: 'fixed',
                                    inset: 0,
                                    background: 'rgba(0, 0, 0, 0.72)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    zIndex: 9999,
                                    padding: '20px',
                                }}
                            >
                                <div
                                    onClick={(e) => e.stopPropagation()}
                                    style={{
                                        background: '#1e293b',
                                        border: '1px solid rgba(255, 255, 255, 0.15)',
                                        borderRadius: '14px',
                                        maxWidth: '720px',
                                        width: '100%',
                                        maxHeight: '85vh',
                                        overflowY: 'auto',
                                        padding: '24px 28px',
                                        color: '#f1f5f9',
                                        boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                        <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#60a5fa' }}>
                                            🎓 Hướng dẫn Đưa Học Liệu Tương Tác lên LMS Moodle
                                        </h3>
                                        <button
                                            type="button"
                                            onClick={() => setShowMoodleGuide(false)}
                                            style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '1.3rem', cursor: 'pointer' }}
                                        >
                                            ✕
                                        </button>
                                    </div>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', fontSize: '0.92rem', lineHeight: 1.6 }}>
                                        <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '10px', padding: '14px 16px' }}>
                                            <h4 style={{ margin: '0 0 8px 0', color: '#34d399' }}>
                                                Cách 1: Dùng Gói SCORM 1.2 (.zip) — KHUYÊN DÙNG NHẤT ⭐
                                            </h4>
                                            <p style={{ margin: '0 0 8px 0', color: '#cbd5e1' }}>
                                                Đóng gói toàn bộ <strong>Slide + Hình ảnh + Giọng đọc giảng bài + Audio mẫu + Bài tập tương tác chặn qua bài</strong> vào 1 file <code>.zip</code> duy nhất, tự động lưu điểm vào Sổ điểm (Gradebook) của Moodle:
                                            </p>
                                            <ol style={{ margin: 0, paddingLeft: '20px', color: '#e2e8f0' }}>
                                                <li>Bấm nút <strong>📦 Xuất SCORM (.zip)</strong> trên thanh công cụ để tải gói học liệu về máy.</li>
                                                <li>Mở khóa học trên <strong>Moodle</strong> → Bật <strong>Chế độ chỉnh sửa (Turn editing on)</strong>.</li>
                                                <li>Bấm <strong>Thêm hoạt động hoặc tài nguyên (Add an activity or resource)</strong> → Chọn <strong>Gói SCORM (SCORM package)</strong>.</li>
                                                <li>Đặt tên bài học và kéo thả file <code>_SCORM_1.2.zip</code> vừa tải vào ô <strong>Package file</strong>.</li>
                                                <li>Bấm <strong>Lưu và hiển thị (Save and display)</strong>.</li>
                                            </ol>
                                        </div>

                                        <div style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.35)', borderRadius: '10px', padding: '14px 16px' }}>
                                            <h4 style={{ margin: '0 0 8px 0', color: '#fbbf24' }}>
                                                Cách 2: Dùng Gói H5P Tương tác (.h5p) — Tương thích H5P Moodle
                                            </h4>
                                            <ol style={{ margin: 0, paddingLeft: '20px', color: '#e2e8f0' }}>
                                                <li>Bấm nút <strong>🌟 Xuất H5P (.h5p)</strong> để tải file <code>.h5p</code> về máy.</li>
                                                <li>Trên <strong>Moodle</strong> → Chọn hoạt động <strong>H5P</strong> → Kéo thả file <code>_H5P.h5p</code> vào.</li>
                                            </ol>
                                        </div>

                                        <div style={{ background: 'rgba(139, 92, 246, 0.1)', border: '1px solid rgba(139, 92, 246, 0.3)', borderRadius: '10px', padding: '14px 16px' }}>
                                            <h4 style={{ margin: '0 0 8px 0', color: '#c4b5fd' }}>
                                                Cách 3: Dùng Moodle Quiz XML (.xml) — Tạo đề kiểm tra độc lập
                                            </h4>
                                            <ol style={{ margin: 0, paddingLeft: '20px', color: '#e2e8f0' }}>
                                                <li>Bấm nút <strong>📋 Xuất Moodle Quiz XML</strong> để tải file <code>_moodle_quiz.xml</code>.</li>
                                                <li>Trên Moodle → Vào <strong>Ngân hàng câu hỏi (Question bank) → Nhập (Import)</strong> → Chọn <strong>Moodle XML format</strong>.</li>
                                            </ol>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* ════════════ STEP 4: QUESTION BANK ════════════ */}
                {activeStep === 3 && sessionId && (
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
                            <button
                                className={`tab ${activeQuestionTab === 'exam' ? 'active' : ''}`}
                                onClick={() => setActiveQuestionTab('exam')}
                            >
                                📋 Bài kiểm tra (Nhiều bài học)
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
                                        Tạo câu hỏi chuyên sâu ngành Ngôn ngữ Anh & Ngôn ngữ học, hỗ trợ đa dạng cấu trúc chấm điểm tự động 100% chuẩn Moodle XML (Multiple Choice, Multiple Response, Matching, Cloze, True/False).
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
                                                            {(() => {
                                                                const isMatch = q.questionType === 'MATCH' || q.questionType === 'MATCHING' ||
                                                                    (q.questionText && (q.questionText.startsWith('Ghép') || q.questionText.startsWith('Nối') || q.questionText.startsWith('Match')));
                                                                const rawPairs = Array.isArray(parsedData?.pairs) ? parsedData.pairs
                                                                    : Array.isArray(parsedData?.matchingPairs) ? parsedData.matchingPairs
                                                                    : Array.isArray(parsedData?.matches) ? parsedData.matches
                                                                    : Array.isArray(parsedData?.items) ? parsedData.items
                                                                    : Array.isArray(parsedData?.subquestions) ? parsedData.subquestions
                                                                    : Array.isArray(parsedData) ? parsedData
                                                                    : [];
                                                                if (!isMatch || rawPairs.length === 0) return null;
                                                                return (
                                                                    <div className="matching-preview-box">
                                                                        <table className="matching-table">
                                                                            <thead>
                                                                                <tr>
                                                                                    <th>Thuật ngữ / Vế A</th>
                                                                                    <th></th>
                                                                                    <th>Định nghĩa / Ghép đôi Vế B</th>
                                                                                </tr>
                                                                            </thead>
                                                                            <tbody>
                                                                                {rawPairs.map((pair: any, pIdx: number) => {
                                                                                    const leftVal = pair.left ?? pair.subquestion ?? pair.question ?? pair.term ?? pair.item ?? pair.component ?? pair.statement ?? pair.A ?? '';
                                                                                    const rightVal = pair.right ?? pair.answer ?? pair.match ?? pair.definition ?? pair.target ?? pair.function ?? pair.description ?? pair.B ?? '';
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
                                                                );
                                                            })()}

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

                        {/* ════════════ TAB: MULTI-LESSON EXAM GENERATOR ════════════ */}
                        {activeQuestionTab === 'exam' && (
                            <div className="question-section">
                                {session?.pptxSubject?.id ? (
                                    <ExamManagerPanel
                                        mode="pptx-subject"
                                        pptxSubjectId={session.pptxSubject.id}
                                        subjectName={session.pptxSubject.name}
                                    />
                                ) : (
                                    <div className="empty-state" style={{ padding: '32px', textAlign: 'center' }}>
                                        <h3>⚠️ Bài giảng này chưa được gắn vào Môn học PPTX</h3>
                                        <p style={{ color: '#94a3b8', marginBottom: 14 }}>
                                            Để tạo đề kiểm tra tổng hợp từ nhiều bài học (VD: Bài 1 → Bài 6), vui lòng gắn bài giảng này vào một Môn học.
                                        </p>
                                        <button
                                            type="button"
                                            className="btn-primary"
                                            onClick={openSessionContextModal}
                                        >
                                            📚 Gắn vào Môn học ngay
                                        </button>
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

            {/* ════════════ MODAL: TẠO / SỬA MÔN HỌC PPTX ════════════ */}
            {showSubjectModal && (
                <div className="pptx-modal-backdrop" onClick={() => !isSavingSubject && setShowSubjectModal(false)}>
                    <div className="pptx-modal-dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="pptx-modal-header">
                            <h3>{editingSubject ? '✏️ Chỉnh sửa Môn học (PPTX)' : '➕ Tạo Môn học Mới (PPTX)'}</h3>
                            <button
                                type="button"
                                className="btn-close-modal"
                                onClick={() => !isSavingSubject && setShowSubjectModal(false)}
                            >
                                ✕
                            </button>
                        </div>
                        <div className="pptx-modal-body">
                            <p className="modal-desc-text">
                                Môn học độc lập trong PPTX Tool giúp nhóm các bài giảng theo học phần và cung cấp ngữ cảnh chuyên ngành cho AI.
                            </p>

                            <div className="pptx-form-group">
                                <label>📚 Tên môn học / Học phần <span style={{ color: '#f87171' }}>*</span></label>
                                <input
                                    type="text"
                                    value={subjectForm.name}
                                    onChange={(e) => setSubjectForm(prev => ({ ...prev, name: e.target.value }))}
                                    placeholder="VD: Chăn nuôi đại cương, Bệnh truyền nhiễm thú y, Kinh tế nông nghiệp..."
                                    className="form-input-dark"
                                    autoFocus
                                />
                            </div>

                            <div className="pptx-form-row-2">
                                <div className="pptx-form-group">
                                    <label>🎓 Ngành đào tạo (Major)</label>
                                    <input
                                        type="text"
                                        value={subjectForm.major}
                                        onChange={(e) => setSubjectForm(prev => ({ ...prev, major: e.target.value }))}
                                        placeholder="VD: Thú y, Chăn nuôi, Nông học..."
                                        className="form-input-dark"
                                    />
                                </div>
                                <div className="pptx-form-group">
                                    <label>🎯 Đối tượng người học</label>
                                    <input
                                        type="text"
                                        value={subjectForm.targetAudience}
                                        onChange={(e) => setSubjectForm(prev => ({ ...prev, targetAudience: e.target.value }))}
                                        placeholder="VD: Sinh viên đại học, Học viên cao học..."
                                        className="form-input-dark"
                                    />
                                </div>
                            </div>

                            <div className="pptx-form-group">
                                <label>📝 Mô tả môn học & Mục tiêu học phần (Ngữ cảnh chung cho AI)</label>
                                <textarea
                                    rows={3}
                                    value={subjectForm.description}
                                    onChange={(e) => setSubjectForm(prev => ({ ...prev, description: e.target.value }))}
                                    placeholder="Mô tả tóm tắt nội dung môn học, đối tượng sinh viên, chuẩn đầu ra hoặc định hướng thuật ngữ chuyên ngành..."
                                    className="form-textarea-dark"
                                />
                            </div>
                        </div>
                        <div className="pptx-modal-footer">
                            <button
                                type="button"
                                className="btn-modal-cancel"
                                onClick={() => setShowSubjectModal(false)}
                                disabled={isSavingSubject}
                            >
                                Hủy
                            </button>
                            <button
                                type="button"
                                className="btn-modal-confirm"
                                onClick={handleSaveSubject}
                                disabled={isSavingSubject || !subjectForm.name.trim()}
                            >
                                {isSavingSubject ? 'Đang lưu...' : (editingSubject ? '💾 Cập nhật Môn học' : '✨ Tạo Môn học')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ════════════ MODAL: CẤU HÌNH BÀI HỌC & NẠP CONTEXT (WORD / PDF / TEXT) ════════════ */}
            {showContextModal && sessionId && (
                <div className="pptx-modal-backdrop" onClick={() => !isSavingMeta && setShowContextModal(false)}>
                    <div className="pptx-modal-dialog modal-lg" onClick={(e) => e.stopPropagation()}>
                        <div className="pptx-modal-header">
                            <h3>📎 Cấu hình Bài học & Tài liệu Ngữ cảnh (Word / PDF / Text)</h3>
                            <button
                                type="button"
                                className="btn-close-modal"
                                onClick={() => !isSavingMeta && setShowContextModal(false)}
                            >
                                ✕
                            </button>
                        </div>
                        <div className="pptx-modal-body">
                            <p className="modal-desc-text">
                                Gán bài học vào môn học và nạp thêm giáo trình / đề cương (.docx, .pdf) hoặc ghi chú để AI hiểu sâu nội dung khi các slide PowerPoint ít chữ hoặc chỉ có sơ đồ/hình ảnh.
                            </p>

                            <div className="pptx-form-row-2">
                                <div className="pptx-form-group">
                                    <label>📝 Tên bài giảng</label>
                                    <input
                                        type="text"
                                        value={metaLessonTitle}
                                        onChange={(e) => setMetaLessonTitle(e.target.value)}
                                        placeholder="Nhập tên bài giảng..."
                                        className="form-input-dark"
                                    />
                                </div>
                                <div className="pptx-form-group">
                                    <label>📚 Thuộc Môn học</label>
                                    <select
                                        value={metaSubjectId}
                                        onChange={(e) => setMetaSubjectId(e.target.value)}
                                        className="form-select-dark"
                                    >
                                        <option value="">-- Chưa phân loại --</option>
                                        {subjects.map(sub => (
                                            <option key={sub.id} value={sub.id}>
                                                {sub.name} {sub.major ? `(${sub.major})` : ''}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="pptx-form-group">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                                    <label style={{ margin: 0 }}>
                                        📄 Tài liệu ngữ cảnh bổ sung cho bài học ({metaContextText.length.toLocaleString()} ký tự)
                                    </label>
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                        <input
                                            type="file"
                                            ref={sessionContextFileInputRef}
                                            accept=".docx,.pdf,.txt,.md"
                                            onChange={handleUploadSessionContextFile}
                                            style={{ display: 'none' }}
                                        />
                                        <button
                                            type="button"
                                            className="btn-upload-context-doc"
                                            onClick={() => sessionContextFileInputRef.current?.click()}
                                            disabled={isUploadingSessionContext}
                                        >
                                            {isUploadingSessionContext ? '⏳ Đang trích xuất...' : '📤 Tải file Word (.docx) / PDF (.pdf)'}
                                        </button>
                                        {metaContextText && (
                                            <button
                                                type="button"
                                                className="btn-clear-context-inline"
                                                onClick={() => setMetaContextText('')}
                                            >
                                                Xóa nội dung
                                            </button>
                                        )}
                                    </div>
                                </div>
                                {metaContextFileName && (
                                    <div className="context-file-badge" style={{ marginBottom: 8 }}>
                                        📎 File đã nạp gần nhất: <strong>{metaContextFileName}</strong>
                                    </div>
                                )}
                                <textarea
                                    rows={9}
                                    value={metaContextText}
                                    onChange={(e) => setMetaContextText(e.target.value)}
                                    placeholder="Dán nội dung giáo trình, đề cương bài giảng, giải thích các sơ đồ/bảng biểu trong slide hoặc tải file Word (.docx) / PDF (.pdf) ở nút phía trên..."
                                    className="form-textarea-dark"
                                />
                            </div>
                        </div>
                        <div className="pptx-modal-footer">
                            <button
                                type="button"
                                className="btn-modal-cancel"
                                onClick={() => setShowContextModal(false)}
                                disabled={isSavingMeta}
                            >
                                Đóng
                            </button>
                            <button
                                type="button"
                                className="btn-modal-confirm"
                                onClick={handleSaveSessionMeta}
                                disabled={isSavingMeta}
                            >
                                {isSavingMeta ? 'Đang lưu...' : '💾 Lưu Cấu hình & Ngữ cảnh'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
