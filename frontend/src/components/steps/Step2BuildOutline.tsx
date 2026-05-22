import { useState, useMemo, useEffect, useRef } from 'react';
import { useLessonEditor } from '../../contexts/LessonEditorContext';
import { api } from '../../lib/api';
import { useJobPolling } from '../../hooks/useJobPolling';
import { ModelSelector } from '../ModelSelector';
import './Steps.css';

// Types for parsed outline JSON
interface ContentSection {
    section: number;
    title: string;
    subsections?: { id: string; title: string; description?: string }[];
}

interface ReviewQuestion {
    questionId?: string;
    type?: string;
    question: string;
    correctAnswer?: string;
    optionB?: string;
    optionC?: string;
    optionD?: string;
    explanation?: string;
    level?: number;
}

interface ParsedOutline {
    title?: string;
    agenda?: string[];
    objectives?: string[];
    // New structure from prompt
    learningGuide?: string;
    situation?: string;
    situationSolution?: string;
    // Legacy structure (also supported)
    studyGuide?: {
        equipment?: string[];
        materials?: string[];
        methods?: string[];
    };
    scenario?: {
        story?: string;
        question?: string;
    };
    scenarioResolution?: string;
    // Main content sections
    content?: ContentSection[];
    sections?: {
        id: string;
        title: string;
        subsections?: {
            id?: string;
            title: string;
            content?: string;
            points?: string[];
        }[]
    }[];
    summary?: string[];
    // Discussion questions (strings only, not object with options)
    reviewQuestions?: (string | ReviewQuestion)[];
    closingMessage?: string;
}

// Parse JSON from AI response (handles ```json blocks with nested code)
function parseOutlineJson(raw: string): ParsedOutline | null {
    try {
        let jsonStr = raw;

        // Use indexOf/lastIndexOf to handle nested code blocks
        const jsonStartTag = raw.indexOf('```json');
        if (jsonStartTag !== -1) {
            const contentStart = jsonStartTag + '```json'.length;
            const lastBackticks = raw.lastIndexOf('```');
            if (lastBackticks > contentStart) {
                jsonStr = raw.substring(contentStart, lastBackticks);
            }
        } else {
            // Try plain ``` at start
            const plainStart = raw.indexOf('```');
            if (plainStart !== -1 && plainStart < 10) {
                const contentStart = raw.indexOf('\n', plainStart) + 1;
                const lastBackticks = raw.lastIndexOf('```');
                if (lastBackticks > contentStart) {
                    jsonStr = raw.substring(contentStart, lastBackticks);
                }
            }
        }

        return JSON.parse(jsonStr.trim());
    } catch {
        return null;
    }
}

// Readable outline preview component
function OutlinePreview({ outline }: { outline: ParsedOutline }) {
    return (
        <div className="outline-preview">
            {outline.title && (
                <h3 className="outline-title">📚 {outline.title}</h3>
            )}

            {outline.objectives && outline.objectives.length > 0 && (
                <div className="outline-block">
                    <h4>🎯 Mục tiêu bài học</h4>
                    <ul>
                        {outline.objectives.map((obj, i) => (
                            <li key={i}>{obj}</li>
                        ))}
                    </ul>
                </div>
            )}

            {outline.agenda && outline.agenda.length > 0 && (
                <div className="outline-block">
                    <h4>📋 Nội dung chính</h4>
                    <ol>
                        {outline.agenda.map((item, i) => (
                            <li key={i}>{item}</li>
                        ))}
                    </ol>
                </div>
            )}

            {/* New learningGuide field (string) */}
            {outline.learningGuide && (
                <div className="outline-block">
                    <h4>📖 Hướng dẫn học tập</h4>
                    <p>{outline.learningGuide}</p>
                </div>
            )}

            {/* Legacy studyGuide field (object) */}
            {!outline.learningGuide && outline.studyGuide && (
                <div className="outline-block">
                    <h4>📖 Hướng dẫn học tập</h4>
                    {outline.studyGuide.equipment && outline.studyGuide.equipment.length > 0 && (
                        <p><strong>Thiết bị:</strong> {outline.studyGuide.equipment.join(', ')}</p>
                    )}
                    {outline.studyGuide.materials && outline.studyGuide.materials.length > 0 && (
                        <p><strong>Tài liệu:</strong> {outline.studyGuide.materials.join(', ')}</p>
                    )}
                    {outline.studyGuide.methods && outline.studyGuide.methods.length > 0 && (
                        <p><strong>Phương pháp:</strong> {outline.studyGuide.methods.join(', ')}</p>
                    )}
                </div>
            )}

            {/* New situation field (string) */}
            {outline.situation && (
                <div className="outline-block scenario-block">
                    <h4>💡 Tình huống mở đầu</h4>
                    <p className="scenario-story">{outline.situation}</p>
                </div>
            )}

            {/* Legacy scenario field (object) */}
            {!outline.situation && outline.scenario && (outline.scenario.story || outline.scenario.question) && (
                <div className="outline-block scenario-block">
                    <h4>💡 Tình huống mở đầu</h4>
                    {outline.scenario.story && <p className="scenario-story">{outline.scenario.story}</p>}
                    {outline.scenario.question && <p className="scenario-question"><strong>❓ Câu hỏi:</strong> {outline.scenario.question}</p>}
                </div>
            )}

            {/* New content format */}
            {outline.content && outline.content.length > 0 && (
                <div className="outline-block">
                    <h4>📖 Chi tiết các phần</h4>
                    {outline.content.map((section) => (
                        <div key={section.section} className="outline-section">
                            <h5>{section.section}. {section.title}</h5>
                            {section.subsections && section.subsections.length > 0 && (
                                <ul>
                                    {section.subsections.map((sub) => (
                                        <li key={sub.id}>
                                            <strong>{sub.id} {sub.title}</strong>
                                            {sub.description && <span className="sub-desc"> - {sub.description}</span>}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Sections from prompt format (with content field) */}
            {!outline.content && outline.sections && outline.sections.length > 0 && (
                <div className="outline-block">
                    <h4>📖 Chi tiết các phần</h4>
                    {outline.sections.map((section) => (
                        <div key={section.id} className="outline-section">
                            <h5>{section.id}. {section.title}</h5>
                            {section.subsections && section.subsections.length > 0 && (
                                <ul>
                                    {section.subsections.map((sub, i) => (
                                        <li key={sub.id || i}>
                                            <strong>{sub.id || `${section.id}.${i + 1}`} {sub.title}</strong>
                                            {sub.content && <p className="sub-content">{sub.content}</p>}
                                            {sub.points && sub.points.length > 0 && (
                                                <ul className="sub-points">
                                                    {sub.points.map((p, j) => (
                                                        <li key={j}>{p}</li>
                                                    ))}
                                                </ul>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* New situationSolution field */}
            {outline.situationSolution && (
                <div className="outline-block">
                    <h4>✅ Giải quyết tình huống</h4>
                    <p>{outline.situationSolution}</p>
                </div>
            )}

            {/* Legacy scenarioResolution field */}
            {!outline.situationSolution && outline.scenarioResolution && (
                <div className="outline-block">
                    <h4>✅ Giải quyết tình huống</h4>
                    <p>{outline.scenarioResolution}</p>
                </div>
            )}

            {outline.summary && outline.summary.length > 0 && (
                <div className="outline-block">
                    <h4>📝 Tóm tắt</h4>
                    <ul>
                        {outline.summary.map((item, i) => (
                            <li key={i}>{item}</li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Discussion questions - handles both string[] and object[] */}
            {outline.reviewQuestions && outline.reviewQuestions.length > 0 && (
                <div className="outline-block">
                    <h4>💬 Câu hỏi thảo luận ({outline.reviewQuestions.length} câu)</h4>
                    <ol className="discussion-questions">
                        {outline.reviewQuestions.map((q, i) => (
                            <li key={i} className="discussion-question">
                                {typeof q === 'string' ? q : q.question}
                            </li>
                        ))}
                    </ol>
                </div>
            )}

            {outline.closingMessage && (
                <div className="outline-block closing-block">
                    <h4>🎬 Kết thúc bài học</h4>
                    <p className="closing-message">{outline.closingMessage}</p>
                </div>
            )}
        </div>
    );
}

export function Step2BuildOutline() {
    const { lessonId, lessonData, updateDetailedOutline, refreshLessonData } = useLessonEditor();
    const [editMode, setEditMode] = useState(false);
    const [detailedOutline, setDetailedOutline] = useState(lessonData?.detailedOutline || '');
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // Async job polling for outline generation
    const outlineJob = useJobPolling({
        onComplete: async (jobStatus) => {
            await refreshLessonData();
            const result = jobStatus as any;
            // result field from completeJob may contain coveragePercent & warnings
            const resultData = (result as any)?.result || {};
            const coveragePercent = resultData?.coveragePercent;
            const warnings = resultData?.warnings;
            if (coveragePercent !== undefined) {
                const warningText = warnings?.join(' ') || '';
                setMessage({
                    type: 'success',
                    text: `✓ Đã tạo outline! Coverage: ${coveragePercent}% ${warningText}`
                });
            } else {
                setMessage({ type: 'success', text: '✓ Đã tạo outline chi tiết thành công!' });
            }
        },
        onError: (msg) => {
            setMessage({ type: 'error', text: msg });
        },
    });

    const isGenerating = outlineJob.isRunning;

    // Track unsaved edits for auto-save on unmount
    const isDirtyRef = useRef(false);
    const outlineRef = useRef(detailedOutline);

    // Keep refs in sync with state
    useEffect(() => {
        outlineRef.current = detailedOutline;
    }, [detailedOutline]);

    // Sync local state when lessonData changes (after generate/refresh)
    useEffect(() => {
        if (lessonData?.detailedOutline) {
            setDetailedOutline(lessonData.detailedOutline);
            isDirtyRef.current = false;
        }
    }, [lessonData?.detailedOutline]);

    // Auto-save on unmount if there are unsaved edits
    useEffect(() => {
        return () => {
            if (isDirtyRef.current && outlineRef.current) {
                try {
                    JSON.parse(outlineRef.current);
                    // Fire-and-forget save
                    api.put(`/lessons/${lessonId}/outline/detailed`, {
                        detailedOutline: outlineRef.current,
                    }).catch(err => console.error('Auto-save outline failed:', err));
                } catch {
                    // JSON invalid, skip auto-save
                    console.warn('Outline JSON invalid, skipping auto-save');
                }
            }
        };
    }, [lessonId]);

    // Parse outline JSON for preview
    const parsedOutline = useMemo(() => {
        const content = lessonData?.detailedOutline || '';
        return parseOutlineJson(content);
    }, [lessonData?.detailedOutline]);

    const handleGenerate = async () => {
        setMessage(null);

        try {
            const response = await api.post(`/lessons/${lessonId}/outline/generate`);
            const { jobId } = response.data;
            outlineJob.startPolling(jobId);
        } catch (err: any) {
            setMessage({ type: 'error', text: err.response?.data?.message || 'Không thể tạo outline' });
        }
    };

    const handleSaveEdit = async () => {
        // Auto-clean markdown code blocks if present (handles nested code)
        let cleanedOutline = detailedOutline.trim();
        const jsonStartTag = cleanedOutline.indexOf('```json');
        if (jsonStartTag !== -1) {
            const contentStart = jsonStartTag + '```json'.length;
            const lastBackticks = cleanedOutline.lastIndexOf('```');
            if (lastBackticks > contentStart) {
                cleanedOutline = cleanedOutline.substring(contentStart, lastBackticks).trim();
            }
        } else {
            const plainStart = cleanedOutline.indexOf('```');
            if (plainStart !== -1 && plainStart < 10) {
                const contentStart = cleanedOutline.indexOf('\n', plainStart) + 1;
                const lastBackticks = cleanedOutline.lastIndexOf('```');
                if (lastBackticks > contentStart) {
                    cleanedOutline = cleanedOutline.substring(contentStart, lastBackticks).trim();
                }
            }
        }

        // Validate JSON before saving
        try {
            JSON.parse(cleanedOutline);
        } catch {
            setMessage({ type: 'error', text: '❌ JSON không hợp lệ. Vui lòng kiểm tra lại.' });
            return;
        }

        try {
            await updateDetailedOutline(cleanedOutline);
            setDetailedOutline(cleanedOutline); // Update local state with cleaned version
            isDirtyRef.current = false;
            setEditMode(false);
            setMessage({ type: 'success', text: '✓ Đã lưu thay đổi!' });
        } catch (err: any) {
            setMessage({ type: 'error', text: err.message });
        }
    };

    const hasOutline = !!lessonData?.detailedOutline;

    return (
        <div className="step-content">
            <div className="step-header">
                <h2>📋 Bước 2: Tạo Outline Chi Tiết</h2>
                <div className="header-actions">
                    {!hasOutline ? (
                        <button
                            className="btn-primary"
                            onClick={handleGenerate}
                            disabled={isGenerating || !lessonData?.outlineRaw}
                        >
                            {isGenerating ? '🔄 Đang tạo...' : '🤖 Tạo với AI'}
                        </button>
                    ) : (
                        <>
                            <button
                                className={`btn-toggle ${editMode ? 'active' : ''}`}
                                onClick={() => setEditMode(!editMode)}
                            >
                                {editMode ? '👁️ Xem đẹp' : '⚙️ Sửa JSON'}
                            </button>
                            <button
                                className="btn-secondary"
                                onClick={handleGenerate}
                                disabled={isGenerating}
                            >
                                🔄 Tạo lại
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Model Selection */}
            <ModelSelector taskType="OUTLINE" compact />

            <p className="step-description">
                AI sẽ phân tích outline thô và tạo ra một dàn bài chi tiết bao gồm: Mục tiêu bài học,
                Nội dung chi tiết, Câu hỏi ôn tập, và Câu hỏi tương tác.
            </p>

            {!lessonData?.outlineRaw && (
                <div className="warning-message">
                    ⚠️ Vui lòng nhập Outline Thô ở Bước 1 trước khi tiếp tục.
                </div>
            )}

            {message && (
                <div className={`${message.type}-message`}>
                    {message.text}
                </div>
            )}

            {isGenerating && (
                <div className="generating-state">
                    <div className="loading-spinner"></div>
                    <p>{outlineJob.jobStatus?.message || 'Đang tạo outline chi tiết với AI...'}</p>
                    <p className="hint">Quá trình này có thể mất 30-60 giây</p>
                </div>
            )}

            {!isGenerating && hasOutline && (
                <>
                    {editMode ? (
                        <>
                            <div className="edit-mode-header">
                                <span className="edit-badge">⚙️ Chế độ JSON</span>
                                <span className="hint">Sửa trực tiếp JSON và lưu</span>
                            </div>
                            <textarea
                                className="content-textarea json-editor"
                                value={detailedOutline}
                                onChange={(e) => {
                                    setDetailedOutline(e.target.value);
                                    isDirtyRef.current = true;
                                }}
                                rows={25}
                                spellCheck={false}
                            />
                            <div className="edit-actions">
                                <button className="btn-primary" onClick={handleSaveEdit}>
                                    💾 Lưu thay đổi
                                </button>
                                <button className="btn-secondary" onClick={() => setEditMode(false)}>
                                    Hủy
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            {parsedOutline ? (
                                <OutlinePreview outline={parsedOutline} />
                            ) : (
                                <div className="markdown-preview">
                                    <pre className="raw-content">{lessonData.detailedOutline}</pre>
                                    <p className="hint">⚠️ Không parse được JSON. Click "Sửa JSON" để xem/sửa raw data.</p>
                                </div>
                            )}
                        </>
                    )}
                </>
            )}

            {!isGenerating && !hasOutline && lessonData?.outlineRaw && (
                <div className="empty-state">
                    <span className="empty-icon">📋</span>
                    <p>Chưa có outline chi tiết</p>
                    <p className="hint">Click "Tạo với AI" để bắt đầu</p>
                </div>
            )}
        </div>
    );
}

