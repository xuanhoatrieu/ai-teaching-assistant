import { useState, useMemo } from 'react';
import { useLessonEditor } from '../../contexts/LessonEditorContext';
import { api } from '../../lib/api';
import { ModelSelector } from '../ModelSelector';
import './Steps.css';

// Types for parsed outline JSON
interface ContentSection {
    section: number;
    title: string;
    subsections?: { id: string; title: string; description?: string }[];
}

interface InteractiveQuestion {
    type: 'MC' | 'MR';
    question: string;
    answers: { text: string; correct: boolean }[];
    correctFeedback?: string;
    incorrectFeedback?: string;
    points?: number;
}

interface ParsedOutline {
    title?: string;
    agenda?: string[];
    objectives?: string[];
    studyGuide?: {
        equipment?: string[];
        materials?: string[];
        methods?: string[];
    };
    scenario?: {
        story?: string;
        question?: string;
    };
    content?: ContentSection[];
    scenarioResolution?: string;
    summary?: string[];
    reviewQuestions?: { type: string; question: string }[];
    closingMessage?: string;
    interactiveQuestions?: InteractiveQuestion[];
    // Legacy support
    sections?: { id: string; title: string; subsections?: { title: string; points?: string[] }[] }[];
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

            {outline.studyGuide && (
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

            {outline.scenario && (outline.scenario.story || outline.scenario.question) && (
                <div className="outline-block scenario-block">
                    <h4>💡 Tình huống mở đầu</h4>
                    {outline.scenario.story && <p className="scenario-story">{outline.scenario.story}</p>}
                    {outline.scenario.question && <p className="scenario-question"><strong>❓ Câu hỏi:</strong> {outline.scenario.question}</p>}
                </div>
            )}

            {/* New content structure */}
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

            {/* Legacy sections support */}
            {!outline.content && outline.sections && outline.sections.length > 0 && (
                <div className="outline-block">
                    <h4>📖 Chi tiết các phần</h4>
                    {outline.sections.map((section) => (
                        <div key={section.id} className="outline-section">
                            <h5>{section.id}. {section.title}</h5>
                            {section.subsections && section.subsections.length > 0 && (
                                <ul>
                                    {section.subsections.map((sub, i) => (
                                        <li key={i}>
                                            <strong>{sub.title}</strong>
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

            {outline.scenarioResolution && (
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

            {outline.reviewQuestions && outline.reviewQuestions.length > 0 && (
                <div className="outline-block">
                    <h4>❓ Câu hỏi ôn tập</h4>
                    <ol>
                        {outline.reviewQuestions.map((q, i) => (
                            <li key={i}>{q.question}</li>
                        ))}
                    </ol>
                </div>
            )}

            {outline.interactiveQuestions && outline.interactiveQuestions.length > 0 && (
                <div className="outline-block">
                    <h4>🎮 Câu hỏi tương tác ({outline.interactiveQuestions.length} câu)</h4>
                    {outline.interactiveQuestions.map((q, i) => (
                        <div key={i} className="interactive-question">
                            <p className="q-header">
                                <span className={`q-type ${q.type}`}>{q.type}</span>
                                <strong>{q.question}</strong>
                            </p>
                            <ul className="q-answers">
                                {q.answers.map((a, j) => (
                                    <li key={j} className={a.correct ? 'correct' : ''}>
                                        {a.correct ? '✓ ' : ''}{a.text}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
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
    const [isGenerating, setIsGenerating] = useState(false);
    const [editMode, setEditMode] = useState(false);
    const [detailedOutline, setDetailedOutline] = useState(lessonData?.detailedOutline || '');
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // Parse outline JSON for preview
    const parsedOutline = useMemo(() => {
        const content = lessonData?.detailedOutline || '';
        return parseOutlineJson(content);
    }, [lessonData?.detailedOutline]);

    const handleGenerate = async () => {
        setIsGenerating(true);
        setMessage(null);

        try {
            const response = await api.post(`/lessons/${lessonId}/outline/generate`);
            const content = response.data.content || response.data.detailedOutline || response.data;
            setDetailedOutline(typeof content === 'string' ? content : JSON.stringify(content, null, 2));
            await refreshLessonData();

            // Show coverage info if available
            if (response.data.coveragePercent !== undefined) {
                const warnings = response.data.warnings?.join(' ') || '';
                setMessage({
                    type: 'success',
                    text: `✓ Đã tạo outline! Coverage: ${response.data.coveragePercent}% ${warnings}`
                });
            } else {
                setMessage({ type: 'success', text: '✓ Đã tạo outline chi tiết thành công!' });
            }
        } catch (err: any) {
            setMessage({ type: 'error', text: err.response?.data?.message || 'Không thể tạo outline' });
        } finally {
            setIsGenerating(false);
        }
    };

    const handleSaveEdit = async () => {
        // Validate JSON before saving
        try {
            JSON.parse(detailedOutline);
        } catch {
            setMessage({ type: 'error', text: '❌ JSON không hợp lệ. Vui lòng kiểm tra lại.' });
            return;
        }

        try {
            await updateDetailedOutline(detailedOutline);
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
                    <p>Đang tạo outline chi tiết với AI...</p>
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
                                onChange={(e) => setDetailedOutline(e.target.value)}
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

