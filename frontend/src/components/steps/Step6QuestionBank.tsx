import { useState, useEffect, useRef, Component, type ErrorInfo, type ReactNode } from 'react';
import { useLessonEditor } from '../../contexts/LessonEditorContext';
import { api } from '../../lib/api';
import { useJobPolling } from '../../hooks/useJobPolling';
import { ModelSelector } from '../ModelSelector';
import './Steps.css';

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
                    <p style={{ margin: 0, fontWeight: 600 }}>⚠️ {this.props.fallbackText || 'Định dạng câu hỏi này gặp lỗi hiển thị'}: {this.state.error?.message}</p>
                </div>
            );
        }
        return this.props.children;
    }
}

// Review Question structure (matches prompt)
interface ReviewQuestion {
    id: string;
    questionId: string; // B1-1-01 format
    question: string;
    correctAnswer: string;
    optionB: string;
    optionC: string;
    optionD: string;
    explanation: string;
    level: number;
}

// Interactive Question structure (matches prompt)
interface InteractiveQuestion {
    id: string;
    questionOrder: number;
    questionType: string; // MC or MR
    questionText: string;
    answers: string[]; // Array with * prefix for correct answers
    correctFeedback: string;
    incorrectFeedback: string;
    points: number;
}

// English Question structure
interface EnglishQuestion {
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

export function Step6QuestionBank() {
    const { lessonId, lessonData } = useLessonEditor();

    // Review Questions state
    const [levelCounts, setLevelCounts] = useState({ level1: 20, level2: 20, level3: 10 });
    const [isGeneratingReview, setIsGeneratingReview] = useState(false);
    const [isAppendingReview, setIsAppendingReview] = useState(false);
    const [reviewQuestions, setReviewQuestions] = useState<ReviewQuestion[]>([]);

    // Interactive Questions state
    const [interactiveCount, setInteractiveCount] = useState(5);
    const [isGeneratingInteractive, setIsGeneratingInteractive] = useState(false);
    const [interactiveQuestions, setInteractiveQuestions] = useState<InteractiveQuestion[]>([]);

    // English Questions state
    const [englishQuestions, setEnglishQuestions] = useState<EnglishQuestion[]>([]);
    const [englishLevelCounts, setEnglishLevelCounts] = useState({ level1: 20, level2: 20, level3: 10 });
    const [selectedSubDiscipline, setSelectedSubDiscipline] = useState('ALL');
    const [selectedQuestionTypes, setSelectedQuestionTypes] = useState<string[]>([
        'MC', 'MR', 'MATCH', 'CLOZE', 'SHORTANSWER', 'TRUEFALSE', 'ESSAY'
    ]);
    const [isGeneratingEnglish, setIsGeneratingEnglish] = useState(false);
    const [isAppendingEnglish, setIsAppendingEnglish] = useState(false);
    const [editingEnglishId, setEditingEnglishId] = useState<string | null>(null);

    // UI state
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [editingReviewId, setEditingReviewId] = useState<string | null>(null);
    const [editingInteractiveId, setEditingInteractiveId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'review' | 'interactive' | 'english'>('review');

    // Excel import (review questions)
    const reviewImportInputRef = useRef<HTMLInputElement>(null);
    const [isImportingReview, setIsImportingReview] = useState(false);

    const hasOutline = !!lessonData?.detailedOutline;

    // Load existing questions on mount
    useEffect(() => {
        if (lessonId) {
            loadQuestions();
        }
    }, [lessonId]);

    const loadQuestions = async () => {
        try {
            const [reviewRes, interactiveRes, englishRes] = await Promise.all([
                api.get(`/lessons/${lessonId}/review-questions`),
                api.get(`/lessons/${lessonId}/interactive-questions`),
                api.get(`/lessons/${lessonId}/english-questions`),
            ]);
            setReviewQuestions(reviewRes.data || []);
            setInteractiveQuestions(interactiveRes.data || []);
            setEnglishQuestions(englishRes.data || []);
        } catch (err) {
            console.error('Failed to load questions', err);
        }
    };

    // ========== REVIEW QUESTIONS ==========
    const generateJob = useJobPolling({
        onComplete: async () => {
            setIsGeneratingReview(false);
            // Reload questions from DB
            const res = await api.get(`/lessons/${lessonId}/review-questions`);
            const questions = res.data || [];
            setReviewQuestions(questions);
            setMessage({ type: 'success', text: `✓ Đã tạo ${questions.length} câu hỏi ôn tập!` });
        },
        onError: (msg) => {
            setIsGeneratingReview(false);
            setMessage({ type: 'error', text: msg });
        },
    });

    const appendJob = useJobPolling({
        onComplete: async () => {
            setIsAppendingReview(false);
            const res = await api.get(`/lessons/${lessonId}/review-questions`);
            const questions = res.data || [];
            setReviewQuestions(questions);
            setMessage({ type: 'success', text: `✓ Đã thêm câu hỏi! Tổng: ${questions.length} câu` });
        },
        onError: (msg) => {
            setIsAppendingReview(false);
            setMessage({ type: 'error', text: msg });
        },
    });

    const handleGenerateReview = async () => {
        if (reviewQuestions.length > 0 && !confirm('⚠️ Thao tác này sẽ XÓA toàn bộ câu hỏi cũ và tạo mới. Tiếp tục?')) return;
        setIsGeneratingReview(true);
        setMessage(null);
        try {
            const response = await api.post(`/lessons/${lessonId}/review-questions/generate`, levelCounts);
            if (response.data?.jobId) {
                generateJob.startPolling(response.data.jobId);
            }
        } catch (err: any) {
            setIsGeneratingReview(false);
            setMessage({ type: 'error', text: err.response?.data?.message || 'Không thể tạo câu hỏi ôn tập' });
        }
    };

    const handleAppendReview = async () => {
        setIsAppendingReview(true);
        setMessage(null);
        try {
            const response = await api.post(`/lessons/${lessonId}/review-questions/append`, levelCounts);
            if (response.data?.jobId) {
                appendJob.startPolling(response.data.jobId);
            }
        } catch (err: any) {
            setIsAppendingReview(false);
            setMessage({ type: 'error', text: err.response?.data?.message || 'Không thể tạo thêm câu hỏi ôn tập' });
        }
    };

    const handleUpdateReview = async (q: ReviewQuestion) => {
        try {
            await api.put(`/lessons/${lessonId}/review-questions/${q.id}`, {
                question: q.question,
                correctAnswer: q.correctAnswer,
                optionB: q.optionB,
                optionC: q.optionC,
                optionD: q.optionD,
                explanation: q.explanation,
            });
            setEditingReviewId(null);
            setMessage({ type: 'success', text: '✓ Đã lưu câu hỏi!' });
        } catch (err: any) {
            setMessage({ type: 'error', text: 'Không thể lưu câu hỏi' });
        }
    };

    const handleDeleteReview = async (id: string) => {
        if (!confirm('Xóa câu hỏi này?')) return;
        try {
            await api.delete(`/lessons/${lessonId}/review-questions/${id}`);
            setReviewQuestions(prev => prev.filter(q => q.id !== id));
            setMessage({ type: 'success', text: '✓ Đã xóa câu hỏi!' });
        } catch (err: any) {
            setMessage({ type: 'error', text: 'Không thể xóa câu hỏi' });
        }
    };

    // ========== INTERACTIVE QUESTIONS ==========
    const handleGenerateInteractive = async () => {
        setIsGeneratingInteractive(true);
        setMessage(null);
        try {
            const response = await api.post(`/lessons/${lessonId}/interactive-questions/generate`, { count: interactiveCount });
            const questions = response.data.questions || response.data || [];
            setInteractiveQuestions(questions);
            setMessage({ type: 'success', text: `✓ Đã tạo ${questions.length} câu hỏi tương tác!` });
        } catch (err: any) {
            setMessage({ type: 'error', text: err.response?.data?.message || 'Không thể tạo câu hỏi tương tác' });
        } finally {
            setIsGeneratingInteractive(false);
        }
    };

    const handleUpdateInteractive = async (q: InteractiveQuestion) => {
        try {
            await api.put(`/lessons/${lessonId}/interactive-questions/${q.id}`, {
                questionText: q.questionText,
                answers: q.answers,
                correctFeedback: q.correctFeedback,
                incorrectFeedback: q.incorrectFeedback,
            });
            setEditingInteractiveId(null);
            setMessage({ type: 'success', text: '✓ Đã lưu câu hỏi!' });
        } catch (err: any) {
            setMessage({ type: 'error', text: 'Không thể lưu câu hỏi' });
        }
    };

    const handleDeleteInteractive = async (id: string) => {
        if (!confirm('Xóa câu hỏi này?')) return;
        try {
            await api.delete(`/lessons/${lessonId}/interactive-questions/${id}`);
            setInteractiveQuestions(prev => prev.filter(q => q.id !== id));
            setMessage({ type: 'success', text: '✓ Đã xóa câu hỏi!' });
        } catch (err: any) {
            setMessage({ type: 'error', text: 'Không thể xóa câu hỏi' });
        }
    };

    const handleExportReviewExcel = async () => {
        try {
            const response = await api.get(`/lessons/${lessonId}/review-questions/export/excel`, {
                responseType: 'blob',
            });
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `${lessonData?.title || 'lesson'}_review.xlsx`);
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (err) {
            setMessage({ type: 'error', text: 'Không thể xuất Excel câu hỏi ôn tập' });
        }
    };

    const handleExportInteractiveExcel = async () => {
        try {
            const response = await api.get(`/lessons/${lessonId}/interactive-questions/export/excel`, {
                responseType: 'blob',
            });
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `${lessonData?.title || 'lesson'}_interactive.xlsx`);
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (err) {
            setMessage({ type: 'error', text: 'Không thể xuất Excel câu hỏi tương tác' });
        }
    };
    const handleExportMoodleXml = async () => {
        try {
            const response = await api.get(`/lessons/${lessonId}/review-questions/export/moodle-xml`, {
                responseType: 'blob',
            });
            const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/xml' }));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `${lessonData?.title || 'lesson'}_moodle.xml`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            setMessage({ type: 'error', text: 'Không thể xuất Moodle XML' });
        }
    };

    // ========== ENGLISH QUESTIONS HANDLERS ==========
    const generateEnglishJob = useJobPolling({
        onComplete: async () => {
            setIsGeneratingEnglish(false);
            const res = await api.get(`/lessons/${lessonId}/english-questions`);
            const questions = res.data || [];
            setEnglishQuestions(questions);
            setMessage({ type: 'success', text: `✓ Đã tạo ${questions.length} câu hỏi tiếng Anh!` });
        },
        onError: (msg) => {
            setIsGeneratingEnglish(false);
            setMessage({ type: 'error', text: msg });
        },
    });

    const appendEnglishJob = useJobPolling({
        onComplete: async () => {
            setIsAppendingEnglish(false);
            const res = await api.get(`/lessons/${lessonId}/english-questions`);
            const questions = res.data || [];
            setEnglishQuestions(questions);
            setMessage({ type: 'success', text: `✓ Đã thêm câu hỏi tiếng Anh! Tổng: ${questions.length} câu` });
        },
        onError: (msg) => {
            setIsAppendingEnglish(false);
            setMessage({ type: 'error', text: msg });
        },
    });

    // Resume active generation jobs when mounting or returning to Step 6
    useEffect(() => {
        if (!lessonId) return;

        const checkActiveJobs = async () => {
            try {
                // 1. Check English question generation job
                const resGenEng = await api.get(`/generation-jobs/active?lessonId=${lessonId}&type=generate-english-questions`);
                if (resGenEng.data?.id) {
                    setActiveTab('english');
                    setIsGeneratingEnglish(true);
                    generateEnglishJob.startPolling(resGenEng.data.id);
                    return;
                }

                // 2. Check English question append job
                const resAppEng = await api.get(`/generation-jobs/active?lessonId=${lessonId}&type=append-english-questions`);
                if (resAppEng.data?.id) {
                    setActiveTab('english');
                    setIsAppendingEnglish(true);
                    appendEnglishJob.startPolling(resAppEng.data.id);
                    return;
                }

                // 3. Check Review question generation job
                const resGenRev = await api.get(`/generation-jobs/active?lessonId=${lessonId}&type=review-questions`);
                if (resGenRev.data?.id) {
                    setActiveTab('review');
                    setIsGeneratingReview(true);
                    generateJob.startPolling(resGenRev.data.id);
                    return;
                }

                // 4. Check Review question append job
                const resAppRev = await api.get(`/generation-jobs/active?lessonId=${lessonId}&type=append-questions`);
                if (resAppRev.data?.id) {
                    setActiveTab('review');
                    setIsAppendingReview(true);
                    appendJob.startPolling(resAppRev.data.id);
                    return;
                }
            } catch (err) {
                console.error('Failed to check active jobs in Step6:', err);
            }
        };

        checkActiveJobs();
    }, [lessonId]);

    const handleGenerateEnglish = async () => {
        if (selectedQuestionTypes.length === 0) {
            setMessage({ type: 'error', text: 'Vui lòng chọn ít nhất 1 dạng câu hỏi.' });
            return;
        }
        if (englishQuestions.length > 0 && !confirm('⚠️ Thao tác này sẽ XÓA toàn bộ câu hỏi tiếng Anh cũ và tạo mới. Tiếp tục?')) return;
        setIsGeneratingEnglish(true);
        setMessage(null);
        try {
            const total = englishLevelCounts.level1 + englishLevelCounts.level2 + englishLevelCounts.level3;
            const response = await api.post(`/lessons/${lessonId}/english-questions/generate`, {
                totalCount: total,
                level1: englishLevelCounts.level1,
                level2: englishLevelCounts.level2,
                level3: englishLevelCounts.level3,
                questionTypes: selectedQuestionTypes,
                subDiscipline: selectedSubDiscipline,
            });
            if (response.data?.jobId) {
                generateEnglishJob.startPolling(response.data.jobId);
            }
        } catch (err: any) {
            setIsGeneratingEnglish(false);
            setMessage({ type: 'error', text: err.response?.data?.message || 'Không thể tạo câu hỏi tiếng Anh' });
        }
    };

    const handleAppendEnglish = async () => {
        if (selectedQuestionTypes.length === 0) {
            setMessage({ type: 'error', text: 'Vui lòng chọn ít nhất 1 dạng câu hỏi.' });
            return;
        }
        setIsAppendingEnglish(true);
        setMessage(null);
        try {
            const total = englishLevelCounts.level1 + englishLevelCounts.level2 + englishLevelCounts.level3;
            const response = await api.post(`/lessons/${lessonId}/english-questions/append`, {
                totalCount: total,
                level1: englishLevelCounts.level1,
                level2: englishLevelCounts.level2,
                level3: englishLevelCounts.level3,
                questionTypes: selectedQuestionTypes,
                subDiscipline: selectedSubDiscipline,
            });
            if (response.data?.jobId) {
                appendEnglishJob.startPolling(response.data.jobId);
            }
        } catch (err: any) {
            setIsAppendingEnglish(false);
            setMessage({ type: 'error', text: err.response?.data?.message || 'Không thể tạo thêm câu hỏi tiếng Anh' });
        }
    };

    const handleUpdateEnglish = async (q: EnglishQuestion) => {
        try {
            await api.put(`/lessons/${lessonId}/english-questions/${q.id}`, {
                questionType: q.questionType,
                subDiscipline: q.subDiscipline,
                difficulty: q.difficulty,
                title: q.title,
                questionText: q.questionText,
                dataJson: q.dataJson,
                explanation: q.explanation,
                points: q.points,
            });
            setEditingEnglishId(null);
            setMessage({ type: 'success', text: '✓ Đã lưu câu hỏi tiếng Anh!' });
        } catch (err: any) {
            setMessage({ type: 'error', text: err.response?.data?.message || 'Không thể lưu câu hỏi tiếng Anh' });
        }
    };

    const handleDeleteEnglish = async (id: string) => {
        if (!confirm('Xác nhận xóa câu hỏi này?')) return;
        try {
            await api.delete(`/lessons/${lessonId}/english-questions/${id}`);
            setEnglishQuestions(prev => prev.filter(q => q.id !== id));
            setMessage({ type: 'success', text: '✓ Đã xóa câu hỏi!' });
        } catch (err: any) {
            setMessage({ type: 'error', text: 'Không thể xóa câu hỏi' });
        }
    };

    const handleExportEnglishMoodleXml = async () => {
        try {
            const response = await api.get(`/lessons/${lessonId}/english-questions/export/moodle-xml`, {
                responseType: 'blob',
            });
            const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/xml; charset=utf-8' }));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `${lessonData?.title || 'lesson'}_english_moodle.xml`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            setMessage({ type: 'error', text: 'Không thể xuất file Moodle XML tiếng Anh' });
        }
    };

    const handleExportEnglishExcel = async () => {
        try {
            const response = await api.get(`/lessons/${lessonId}/english-questions/export/excel`, {
                responseType: 'blob',
            });
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `${lessonData?.title || 'lesson'}_english_questions.xlsx`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            setMessage({ type: 'error', text: 'Không thể xuất file Excel câu hỏi tiếng Anh' });
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

    const handleDownloadReviewTemplate = async () => {
        try {
            const response = await api.get(`/lessons/${lessonId}/review-questions/import-template`, {
                responseType: 'blob',
            });
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', 'mau_cau_hoi_on_tap.xlsx');
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (err) {
            setMessage({ type: 'error', text: 'Không thể tải file mẫu' });
        }
    };

    const handleImportReviewExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // reset so the same file can be re-selected
        if (!file) return;

        setIsImportingReview(true);
        setMessage(null);
        try {
            const formData = new FormData();
            formData.append('file', file);
            const response = await api.post(
                `/lessons/${lessonId}/review-questions/import`,
                formData,
                { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 0 },
            );
            const { imported = 0, skipped = 0, duplicates = 0 } = response.data || {};
            await loadQuestions();
            const notes: string[] = [];
            if (duplicates > 0) notes.push(`bỏ qua ${duplicates} câu trùng`);
            if (skipped > 0) notes.push(`${skipped} dòng không hợp lệ`);
            const note = notes.length > 0 ? ` (${notes.join(', ')})` : '';
            setMessage({ type: 'success', text: `✓ Đã thêm ${imported} câu hỏi ôn tập${note}` });
        } catch (err: any) {
            setMessage({ type: 'error', text: err.response?.data?.message || 'Import thất bại' });
        } finally {
            setIsImportingReview(false);
        }
    };


    // Parse answers from array with * prefix for correct
    const parseAnswers = (answers: string[]) => {
        return answers.map(a => ({
            text: a.replace(/^\*/, ''),
            isCorrect: a.startsWith('*'),
        }));
    };

    return (
        <div className="step-content">
            <div className="step-header">
                <h2>❓ Bước 6: Ngân Hàng Câu Hỏi</h2>
                <div className="header-actions">
                    {activeTab === 'review' && (
                        <>
                            <input
                                type="file"
                                ref={reviewImportInputRef}
                                accept=".xlsx"
                                style={{ display: 'none' }}
                                onChange={handleImportReviewExcel}
                            />
                            <button className="btn-secondary" onClick={handleDownloadReviewTemplate}>
                                📥 Tải file mẫu Ôn tập
                            </button>
                            <button
                                className="btn-secondary"
                                onClick={() => reviewImportInputRef.current?.click()}
                                disabled={isImportingReview}
                            >
                                {isImportingReview ? '⏳ Đang import...' : '📤 Import Excel Ôn tập'}
                            </button>
                            {reviewQuestions.length > 0 && (
                                <button className="btn-secondary" onClick={handleExportReviewExcel}>
                                    📊 Xuất Excel Ôn tập
                                </button>
                            )}
                            {reviewQuestions.length > 0 && (
                                <button className="btn-secondary" onClick={handleExportMoodleXml}>
                                    📋 Xuất Moodle XML
                                </button>
                            )}
                        </>
                    )}
                    {activeTab === 'interactive' && interactiveQuestions.length > 0 && (
                        <button className="btn-secondary" onClick={handleExportInteractiveExcel}>
                            📊 Xuất Excel Tương tác
                        </button>
                    )}
                </div>
            </div>

            <ModelSelector taskType="QUESTIONS" compact />

            <p className="step-description">
                Tạo câu hỏi tương tác (kiểm tra tập trung), câu hỏi ôn tập (Bloom Taxonomy) và câu hỏi chuyên ngành Ngôn ngữ Anh (Moodle XML).
            </p>

            {!hasOutline && (
                <div className="warning-message">
                    ⚠️ Vui lòng hoàn thành Outline Chi Tiết ở Bước 2 trước khi tiếp tục.
                </div>
            )}

            {message && (
                <div className={`${message.type}-message`}>
                    {message.text}
                </div>
            )}

            {/* Tab Navigation */}
            <div className="tabs">
                <button
                    className={`tab ${activeTab === 'interactive' ? 'active' : ''}`}
                    onClick={() => setActiveTab('interactive')}
                >
                    🎯 Câu hỏi Tương tác ({interactiveQuestions.length})
                </button>
                <button
                    className={`tab ${activeTab === 'review' ? 'active' : ''}`}
                    onClick={() => setActiveTab('review')}
                >
                    📝 Câu hỏi Ôn tập ({reviewQuestions.length})
                </button>
                <button
                    className={`tab ${activeTab === 'english' ? 'active' : ''}`}
                    onClick={() => setActiveTab('english')}
                >
                    🇬🇧 Câu hỏi Tiếng Anh ({englishQuestions.length})
                </button>
            </div>

            {/* ========== INTERACTIVE QUESTIONS TAB ========== */}
            {activeTab === 'interactive' && hasOutline && (
                <div className="question-section">
                    <div className="question-config">
                        <h3>🎯 Câu hỏi Tương tác</h3>
                        <p className="hint">Kiểm tra sự tập trung của sinh viên trong bài giảng</p>
                        <div className="level-inputs">
                            <div className="level-input">
                                <label>Số câu hỏi</label>
                                <input
                                    type="number"
                                    min="1"
                                    max="10"
                                    value={interactiveCount}
                                    onChange={(e) => setInteractiveCount(+e.target.value)}
                                />
                            </div>
                        </div>
                        <button
                            className="btn-primary"
                            onClick={handleGenerateInteractive}
                            disabled={isGeneratingInteractive}
                        >
                            {isGeneratingInteractive ? '🔄 Đang tạo...' : '🤖 Tạo Câu Hỏi Tương Tác'}
                        </button>
                    </div>

                    {isGeneratingInteractive && (
                        <div className="generating-state">
                            <div className="loading-spinner"></div>
                            <p>Đang tạo câu hỏi tương tác...</p>
                        </div>
                    )}

                    {!isGeneratingInteractive && interactiveQuestions.length > 0 && (
                        <div className="questions-preview">
                            <h3>Câu hỏi Tương tác ({interactiveQuestions.length})</h3>
                            <div className="questions-list">
                                {interactiveQuestions.map((q) => (
                                    <div key={q.id} className="question-card interactive-card">
                                        <div className="question-header">
                                            <span className="question-type">{q.questionType}</span>
                                            <span className="question-points">{q.points} điểm</span>
                                            <div className="question-actions">
                                                {editingInteractiveId === q.id ? (
                                                    <button className="btn-save" onClick={() => handleUpdateInteractive(q)}>💾 Lưu</button>
                                                ) : (
                                                    <button className="btn-edit" onClick={() => setEditingInteractiveId(q.id)}>✏️ Sửa</button>
                                                )}
                                                <button className="btn-delete" onClick={() => handleDeleteInteractive(q.id)}>🗑️ Xóa</button>
                                            </div>
                                        </div>
                                        {editingInteractiveId === q.id ? (
                                            <textarea
                                                value={q.questionText}
                                                onChange={(e) => setInteractiveQuestions(prev =>
                                                    prev.map(p => p.id === q.id ? { ...p, questionText: e.target.value } : p)
                                                )}
                                                className="edit-textarea"
                                            />
                                        ) : (
                                            <p className="question-text">{q.questionText}</p>
                                        )}
                                        <div className="answers-list">
                                            {editingInteractiveId === q.id ? (
                                                (q.answers || []).map((ans, i) => (
                                                    <div key={i} className={`answer ${ans.startsWith('*') ? 'correct' : ''}`}>
                                                        {ans.startsWith('*') ? '✅' : '⬜'}
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
                                                            style={{ flex: 1, marginLeft: 8 }}
                                                            className="edit-input"
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
                                        <div className="feedback">
                                            <div className="feedback-correct">✅ {q.correctFeedback}</div>
                                            <div className="feedback-incorrect">❌ {q.incorrectFeedback}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ========== REVIEW QUESTIONS TAB ========== */}
            {activeTab === 'review' && hasOutline && (
                <div className="question-section">
                    <div className="question-config review-config-row">
                        <h3>📝 Câu hỏi Ôn tập (Bloom Taxonomy)</h3>
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
                                    value={levelCounts.level1}
                                    onChange={(e) => setLevelCounts({ ...levelCounts, level1: +e.target.value })}
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
                                    value={levelCounts.level2}
                                    onChange={(e) => setLevelCounts({ ...levelCounts, level2: +e.target.value })}
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
                                    value={levelCounts.level3}
                                    onChange={(e) => setLevelCounts({ ...levelCounts, level3: +e.target.value })}
                                />
                            </div>
                        </div>
                        <div className="review-actions">
                            <button
                                className="btn-primary"
                                onClick={handleGenerateReview}
                                disabled={isGeneratingReview || isAppendingReview || (levelCounts.level1 + levelCounts.level2 + levelCounts.level3 === 0)}
                            >
                                {isGeneratingReview ? '🔄 Đang tạo...' : '🤖 Tạo Mới (Xóa cũ)'}
                            </button>
                            {reviewQuestions.length > 0 && (
                                <button
                                    className="btn-secondary"
                                    onClick={handleAppendReview}
                                    disabled={isGeneratingReview || isAppendingReview || (levelCounts.level1 + levelCounts.level2 + levelCounts.level3 === 0)}
                                >
                                    {isAppendingReview ? '🔄 Đang thêm...' : '➕ Tạo Thêm (Giữ cũ)'}
                                </button>
                            )}
                        </div>
                    </div>

                    {(isGeneratingReview || isAppendingReview) && (
                        <div className="generating-state">
                            <div className="loading-spinner"></div>
                            <p>{(isAppendingReview ? appendJob.jobStatus?.message : generateJob.jobStatus?.message) || 'Đang tạo câu hỏi ôn tập...'}</p>
                            <p className="hint">Tổng số: {levelCounts.level1 + levelCounts.level2 + levelCounts.level3} câu</p>
                        </div>
                    )}

                    {!isGeneratingReview && !isAppendingReview && reviewQuestions.length > 0 && (
                        <div className="questions-preview">
                            <h3>Câu hỏi Ôn tập ({reviewQuestions.length})</h3>
                            <div className="questions-table-wrapper desktop-questions-table">
                                <table className="questions-table">
                                    <thead>
                                        <tr>
                                            <th style={{ width: '80px' }}>ID</th>
                                            <th style={{ minWidth: '250px' }}>Câu hỏi</th>
                                            <th style={{ width: '120px' }}>A (Đúng)</th>
                                            <th style={{ width: '120px' }}>B</th>
                                            <th style={{ width: '120px' }}>C</th>
                                            <th style={{ width: '120px' }}>D</th>
                                            <th style={{ minWidth: '200px' }}>Giải thích</th>
                                            <th style={{ width: '80px' }}>Hành động</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {reviewQuestions.map((q) => (
                                            <tr key={q.id}>
                                                <td className="q-id">{q.questionId || q.id}</td>
                                                <td className="q-text">
                                                    {editingReviewId === q.id ? (
                                                        <input
                                                            type="text"
                                                            value={q.question}
                                                            onChange={(e) => setReviewQuestions(prev =>
                                                                prev.map(p => p.id === q.id ? { ...p, question: e.target.value } : p)
                                                            )}
                                                        />
                                                    ) : q.question}
                                                </td>
                                                <td className="q-answer">
                                                    {editingReviewId === q.id ? (
                                                        <input
                                                            type="text"
                                                            value={q.correctAnswer}
                                                            onChange={(e) => setReviewQuestions(prev =>
                                                                prev.map(p => p.id === q.id ? { ...p, correctAnswer: e.target.value } : p)
                                                            )}
                                                        />
                                                    ) : q.correctAnswer}
                                                </td>
                                                <td>
                                                    {editingReviewId === q.id ? (
                                                        <input
                                                            type="text"
                                                            value={q.optionB}
                                                            onChange={(e) => setReviewQuestions(prev =>
                                                                prev.map(p => p.id === q.id ? { ...p, optionB: e.target.value } : p)
                                                            )}
                                                        />
                                                    ) : q.optionB}
                                                </td>
                                                <td>
                                                    {editingReviewId === q.id ? (
                                                        <input
                                                            type="text"
                                                            value={q.optionC}
                                                            onChange={(e) => setReviewQuestions(prev =>
                                                                prev.map(p => p.id === q.id ? { ...p, optionC: e.target.value } : p)
                                                            )}
                                                        />
                                                    ) : q.optionC}
                                                </td>
                                                <td>
                                                    {editingReviewId === q.id ? (
                                                        <input
                                                            type="text"
                                                            value={q.optionD}
                                                            onChange={(e) => setReviewQuestions(prev =>
                                                                prev.map(p => p.id === q.id ? { ...p, optionD: e.target.value } : p)
                                                            )}
                                                        />
                                                    ) : q.optionD}
                                                </td>
                                                <td className="q-explanation">
                                                    {editingReviewId === q.id ? (
                                                        <input
                                                            type="text"
                                                            value={q.explanation || ''}
                                                            onChange={(e) => setReviewQuestions(prev =>
                                                                prev.map(p => p.id === q.id ? { ...p, explanation: e.target.value } : p)
                                                            )}
                                                        />
                                                    ) : (q.explanation || '-')}
                                                </td>
                                                <td className="q-actions">
                                                    {editingReviewId === q.id ? (
                                                        <button className="btn-save" onClick={() => handleUpdateReview(q)}>💾</button>
                                                    ) : (
                                                        <button className="btn-edit" onClick={() => setEditingReviewId(q.id)}>✏️</button>
                                                    )}
                                                    <button className="btn-delete" onClick={() => handleDeleteReview(q.id)}>🗑️</button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Mobile Review Questions Cards */}
                            <div className="mobile-review-cards">
                                {reviewQuestions.map((q) => (
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

                                        {(q.explanation || editingReviewId === q.id) && (
                                            <div className="review-card-exp">
                                                <span className="exp-label">💡 Giải thích:</span>
                                                {editingReviewId === q.id ? (
                                                    <input
                                                        type="text"
                                                        value={q.explanation || ''}
                                                        onChange={(e) => setReviewQuestions(prev =>
                                                            prev.map(p => p.id === q.id ? { ...p, explanation: e.target.value } : p)
                                                        )}
                                                        className="edit-input"
                                                    />
                                                ) : (
                                                    <span>{q.explanation}</span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ========== ENGLISH QUESTIONS TAB ========== */}
            {activeTab === 'english' && hasOutline && (
                <div className="question-section">
                    <div className="question-config english-config-container">
                        <h3>🇬🇧 Ngân Hàng Câu Hỏi Tiếng Anh (Ngành Ngôn Ngữ Anh)</h3>
                        <p className="hint">
                            Tạo câu hỏi chuyên sâu ngành Ngôn ngữ Anh & Ngôn ngữ học, hỗ trợ đa dạng cấu trúc xuất chuẩn Moodle XML (Multiple Choice, Matching, Cloze, Short Answer, True/False, Essay).
                        </p>

                        {/* Hàng 1: Số lượng câu hỏi 3 mức & Phân môn chuyên sâu (Thẳng hàng nhau) */}
                        <div className="english-config-top-row">
                            {/* Cột 1: Số lượng câu hỏi theo mức độ (Bloom Taxonomy) */}
                            <div className="english-config-col bloom-col">
                                <label className="config-section-label">📊 Số lượng câu hỏi theo mức độ (Bloom):</label>
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

                            {/* Cột 2: Phân môn chuyên sâu (Thẳng hàng với các ô số lượng) */}
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

                        {/* Hàng 2: Chọn dạng câu hỏi chia làm 3 cột */}
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

                        <div className="config-actions-row">
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

                    {message && (
                        <div className={`${message.type}-message`} style={{ marginTop: 16 }}>
                            {message.text}
                        </div>
                    )}

                    {isGeneratingEnglish && (
                        <div className="generating-state">
                            <div className="loading-spinner"></div>
                            <p>{generateEnglishJob.jobStatus?.message || 'Đang tạo câu hỏi tiếng Anh chuyên ngành với AI...'}</p>
                            <p className="hint">Tổng số: {englishLevelCounts.level1 + englishLevelCounts.level2 + englishLevelCounts.level3} câu (Biết: {englishLevelCounts.level1}, Hiểu: {englishLevelCounts.level2}, Vận dụng: {englishLevelCounts.level3})</p>
                        </div>
                    )}

                    {isAppendingEnglish && (
                        <div className="generating-state">
                            <div className="loading-spinner"></div>
                            <p>{appendEnglishJob.jobStatus?.message || 'Đang thêm câu hỏi tiếng Anh...'}</p>
                            <p className="hint">Tổng số: {englishLevelCounts.level1 + englishLevelCounts.level2 + englishLevelCounts.level3} câu</p>
                        </div>
                    )}

                    {!isGeneratingEnglish && !isAppendingEnglish && englishQuestions.length > 0 && (
                        <div className="questions-preview">
                            <div className="preview-header-english">
                                <h3>Danh sách câu hỏi Tiếng Anh ({englishQuestions.length})</h3>
                                <div className="preview-actions">
                                    <button className="btn-secondary btn-sm" onClick={handleExportEnglishExcel}>
                                        📊 Xuất Excel
                                    </button>
                                    <button className="btn-primary btn-sm" onClick={handleExportEnglishMoodleXml}>
                                        📋 Xuất Moodle XML
                                    </button>
                                </div>
                            </div>

                            <div className="questions-list">
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
                                                            <span>{typeof q.explanation === 'object' ? JSON.stringify(q.explanation) : String(q.explanation)}</span>
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
                </div>
            )}
        </div >
    );
}
