import { useState, useEffect } from 'react';
import { useLessonEditor } from '../../contexts/LessonEditorContext';
import { api } from '../../lib/api';
import { ModelSelector } from '../ModelSelector';
import './Steps.css';

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

    // UI state
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [editingReviewId, setEditingReviewId] = useState<string | null>(null);
    const [editingInteractiveId, setEditingInteractiveId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'review' | 'interactive'>('review');

    const hasOutline = !!lessonData?.detailedOutline;

    // Load existing questions on mount
    useEffect(() => {
        if (lessonId) {
            loadQuestions();
        }
    }, [lessonId]);

    const loadQuestions = async () => {
        try {
            const [reviewRes, interactiveRes] = await Promise.all([
                api.get(`/lessons/${lessonId}/review-questions`),
                api.get(`/lessons/${lessonId}/interactive-questions`),
            ]);
            setReviewQuestions(reviewRes.data || []);
            setInteractiveQuestions(interactiveRes.data || []);
        } catch (err) {
            console.error('Failed to load questions', err);
        }
    };

    // ========== REVIEW QUESTIONS ==========
    const handleGenerateReview = async () => {
        if (reviewQuestions.length > 0 && !confirm('⚠️ Thao tác này sẽ XÓA toàn bộ câu hỏi cũ và tạo mới. Tiếp tục?')) return;
        setIsGeneratingReview(true);
        setMessage(null);
        try {
            const response = await api.post(`/lessons/${lessonId}/review-questions/generate`, levelCounts);
            const questions = response.data.questions || response.data || [];
            setReviewQuestions(questions);
            setMessage({ type: 'success', text: `✓ Đã tạo ${questions.length} câu hỏi ôn tập!` });
        } catch (err: any) {
            setMessage({ type: 'error', text: err.response?.data?.message || 'Không thể tạo câu hỏi ôn tập' });
        } finally {
            setIsGeneratingReview(false);
        }
    };

    const handleAppendReview = async () => {
        setIsAppendingReview(true);
        setMessage(null);
        try {
            const response = await api.post(`/lessons/${lessonId}/review-questions/append`, levelCounts);
            const allQuestions = response.data.questions || response.data || [];
            setReviewQuestions(allQuestions);
            setMessage({ type: 'success', text: `✓ Đã thêm câu hỏi! Tổng: ${allQuestions.length} câu` });
        } catch (err: any) {
            setMessage({ type: 'error', text: err.response?.data?.message || 'Không thể tạo thêm câu hỏi ôn tập' });
        } finally {
            setIsAppendingReview(false);
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
                    {interactiveQuestions.length > 0 && (
                        <button className="btn-secondary" onClick={handleExportInteractiveExcel}>
                            📊 Xuất Excel Tương tác
                        </button>
                    )}
                    {reviewQuestions.length > 0 && (
                        <button className="btn-secondary" onClick={handleExportReviewExcel}>
                            📊 Xuất Excel Ôn tập
                        </button>
                    )}
                </div>
            </div>

            <ModelSelector taskType="QUESTIONS" compact />

            <p className="step-description">
                Tạo câu hỏi tương tác (kiểm tra tập trung) và câu hỏi ôn tập (theo Bloom Taxonomy).
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
                            <p>{isAppendingReview ? 'Đang tạo thêm câu hỏi...' : 'Đang tạo câu hỏi ôn tập...'}</p>
                            <p className="hint">Tổng số: {levelCounts.level1 + levelCounts.level2 + levelCounts.level3} câu</p>
                        </div>
                    )}

                    {!isGeneratingReview && !isAppendingReview && reviewQuestions.length > 0 && (
                        <div className="questions-preview">
                            <h3>Câu hỏi Ôn tập ({reviewQuestions.length})</h3>
                            <div className="questions-table-wrapper">
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
                        </div>
                    )}
                </div>
            )
            }
        </div >
    );
}
