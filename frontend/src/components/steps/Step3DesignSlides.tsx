import { useState, useEffect, useMemo } from 'react';
import { useLessonEditor } from '../../contexts/LessonEditorContext';
import { api } from '../../lib/api';
import { ModelSelector } from '../ModelSelector';
import './Steps.css';

interface Slide {
    id: string;
    slideIndex: number;
    slideType: string;
    title: string;
    content: string | null;
    visualIdea: string | null;
    speakerNote: string | null;
    imageUrl: string | null;
    audioUrl: string | null;
    status: string;
}

// Types for parsed slide JSON
interface ParsedSlide {
    slideIndex: number;
    slideType: string;
    title: string;
    content?: string[];
    visualIdea?: string | null;
    speakerNote?: string;
}

interface ParsedSlideScript {
    title?: string;
    slides?: ParsedSlide[];
}

// Parse JSON from AI response (handles ```json blocks with nested code)
function parseSlideJson(raw: string): ParsedSlideScript | null {
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

// Readable slide preview component (for JSON view mode)
function SlideScriptPreview({ script }: { script: ParsedSlideScript }) {
    return (
        <div className="slides-preview-list">
            {script.title && (
                <h3 className="slides-title">🎬 {script.title}</h3>
            )}

            {script.slides?.map((slide, idx) => (
                <div key={idx} className={`slide-preview-card slide-type-${slide.slideType}`}>
                    <div className="slide-preview-header">
                        <span className="slide-number">Slide {slide.slideIndex}</span>
                        <span className={`slide-type-badge ${slide.slideType}`}>{slide.slideType}</span>
                    </div>

                    <h4 className="slide-preview-title">{slide.title}</h4>

                    {slide.content && slide.content.length > 0 && (
                        <ul className="slide-preview-content">
                            {slide.content.map((item, i) => (
                                <li key={i}>{item}</li>
                            ))}
                        </ul>
                    )}

                    {slide.visualIdea && (
                        <div className="slide-visual-hint">
                            <span className="label">🎨 Gợi ý hình ảnh:</span>
                            <span>{slide.visualIdea}</span>
                        </div>
                    )}

                    {slide.speakerNote && (
                        <div className="slide-speaker-hint">
                            <span className="label">🎤 Lời giảng:</span>
                            <p>{slide.speakerNote}</p>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}

export function Step3DesignSlides() {
    const { lessonId, lessonData, updateSlideScript, refreshLessonData } = useLessonEditor();
    const [isGenerating, setIsGenerating] = useState(false);
    const [isGeneratingImages, setIsGeneratingImages] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [editMode, setEditMode] = useState(false);
    const [slideScript, setSlideScript] = useState(lessonData?.slideScript || '');
    const [slides, setSlides] = useState<Slide[]>([]);
    const [viewMode, setViewMode] = useState<'table' | 'cards' | 'preview'>('table');
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // Parse slide JSON for preview
    const parsedScript = useMemo(() => {
        const content = lessonData?.slideScript || '';
        return parseSlideJson(content);
    }, [lessonData?.slideScript]);

    // Fetch structured slides on mount
    useEffect(() => {
        if (lessonId) {
            fetchSlides();
        }
    }, [lessonId]);

    const fetchSlides = async () => {
        try {
            const response = await api.get(`/lessons/${lessonId}/slides`);
            setSlides(response.data || []);
        } catch (err) {
            setSlides([]);
        }
    };

    const handleGenerate = async () => {
        setIsGenerating(true);
        setMessage(null);

        try {
            const response = await api.post(`/lessons/${lessonId}/slides/generate-script`);
            const content = response.data.content || response.data.slideScript || response.data;
            setSlideScript(typeof content === 'string' ? content : JSON.stringify(content, null, 2));
            await refreshLessonData();
            await fetchSlides();

            // Show coverage info if available
            if (response.data.coveragePercent !== undefined) {
                const warnings = response.data.warnings?.join(' ') || '';
                setMessage({
                    type: 'success',
                    text: `✓ Đã tạo kịch bản! Coverage: ${response.data.coveragePercent}% ${warnings}`
                });
            } else {
                setMessage({ type: 'success', text: '✓ Đã tạo kịch bản slide thành công!' });
            }
        } catch (err: any) {
            setMessage({ type: 'error', text: err.response?.data?.message || 'Không thể tạo kịch bản' });
        } finally {
            setIsGenerating(false);
        }
    };

    const handleGenerateImages = async () => {
        setIsGeneratingImages(true);
        setMessage(null);

        try {
            const response = await api.post(`/lessons/${lessonId}/slides/generate-all-images`);
            await fetchSlides();
            setMessage({
                type: 'success',
                text: `✓ Đã tạo ${response.data.successCount}/${response.data.totalCount} hình ảnh!`
            });
        } catch (err: any) {
            setMessage({ type: 'error', text: err.response?.data?.message || 'Không thể tạo hình ảnh' });
        } finally {
            setIsGeneratingImages(false);
        }
    };

    const handleSaveEdit = async () => {
        setIsSaving(true);

        // Auto-clean markdown code blocks if present (handles nested code)
        let cleanedScript = slideScript.trim();
        const jsonStartTag = cleanedScript.indexOf('```json');
        if (jsonStartTag !== -1) {
            const contentStart = jsonStartTag + '```json'.length;
            const lastBackticks = cleanedScript.lastIndexOf('```');
            if (lastBackticks > contentStart) {
                cleanedScript = cleanedScript.substring(contentStart, lastBackticks).trim();
            }
        } else {
            const plainStart = cleanedScript.indexOf('```');
            if (plainStart !== -1 && plainStart < 10) {
                const contentStart = cleanedScript.indexOf('\n', plainStart) + 1;
                const lastBackticks = cleanedScript.lastIndexOf('```');
                if (lastBackticks > contentStart) {
                    cleanedScript = cleanedScript.substring(contentStart, lastBackticks).trim();
                }
            }
        }

        // Validate JSON before saving
        try {
            JSON.parse(cleanedScript);
        } catch {
            setMessage({ type: 'error', text: '❌ JSON không hợp lệ. Vui lòng kiểm tra lại cú pháp.' });
            setIsSaving(false);
            return;
        }

        try {
            // Save the cleaned JSON
            await updateSlideScript(cleanedScript);
            setSlideScript(cleanedScript); // Update local state with cleaned version
            setEditMode(false);
            await fetchSlides();
            setMessage({ type: 'success', text: '✓ Đã lưu thay đổi!' });
        } catch (err: any) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setIsSaving(false);
        }
    };

    const slidesArray = Array.isArray(slides) ? slides : [];
    const hasSlides = slidesArray.length > 0;
    const hasScript = !!lessonData?.slideScript;
    const hasOutline = !!lessonData?.detailedOutline;
    const hasVisualIdeas = slidesArray.some(s => s.visualIdea);

    return (
        <div className="step-content">
            {/* Model Selection */}
            <ModelSelector taskType="SLIDES" compact />

            <div className="step-header">
                <h2>🎨 Bước 3: Thiết Kế Slide</h2>
                <div className="header-actions">
                    {!hasScript ? (
                        <button
                            className="btn-primary"
                            onClick={handleGenerate}
                            disabled={isGenerating || !hasOutline}
                        >
                            {isGenerating ? '🔄 Đang tạo...' : '🤖 Tạo Kịch Bản'}
                        </button>
                    ) : (
                        <>
                            {!editMode && (
                                <div className="view-toggle">
                                    <button
                                        className={viewMode === 'table' ? 'active' : ''}
                                        onClick={() => setViewMode('table')}
                                    >
                                        📋 Bảng
                                    </button>
                                    <button
                                        className={viewMode === 'cards' ? 'active' : ''}
                                        onClick={() => setViewMode('cards')}
                                    >
                                        📊 Cards
                                    </button>
                                    <button
                                        className={viewMode === 'preview' ? 'active' : ''}
                                        onClick={() => setViewMode('preview')}
                                    >
                                        📝 Preview
                                    </button>
                                </div>
                            )}
                            {hasVisualIdeas && (
                                <button
                                    className="btn-secondary"
                                    onClick={handleGenerateImages}
                                    disabled={isGeneratingImages}
                                >
                                    {isGeneratingImages ? '🔄 Đang tạo...' : '🖼️ Tạo Hình Ảnh'}
                                </button>
                            )}
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

            <p className="step-description">
                AI sẽ thiết kế nội dung cho từng slide bao gồm: Tiêu đề, Nội dung, Ý tưởng hình ảnh [Visual Idea],
                và Lời giảng [Speaker Notes].
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

            {(isGenerating || isGeneratingImages) && (
                <div className="generating-state">
                    <div className="loading-spinner"></div>
                    <p>{isGeneratingImages ? 'Đang tạo hình ảnh...' : 'Đang thiết kế kịch bản slide...'}</p>
                    <p className="hint">Quá trình này có thể mất 1-2 phút</p>
                </div>
            )}

            {!isGenerating && !isGeneratingImages && hasScript && (
                <>
                    {editMode ? (
                        <>
                            <div className="edit-mode-header">
                                <span className="edit-badge">⚙️ Chế độ JSON</span>
                                <span className="hint">Sửa trực tiếp JSON và lưu</span>
                            </div>
                            <textarea
                                className="content-textarea json-editor"
                                value={slideScript}
                                onChange={(e) => setSlideScript(e.target.value)}
                                rows={30}
                                spellCheck={false}
                            />
                            <div className="edit-actions">
                                <button className="btn-primary" onClick={handleSaveEdit} disabled={isSaving}>
                                    {isSaving ? '🔄 Đang lưu...' : '💾 Lưu thay đổi'}
                                </button>
                                <button className="btn-secondary" onClick={() => setEditMode(false)}>
                                    Hủy
                                </button>
                            </div>
                        </>
                    ) : viewMode === 'table' && hasSlides ? (
                        <div className="slides-table-wrapper">
                            <table className="slides-table">
                                <thead>
                                    <tr>
                                        <th style={{ width: '60px' }}>Slide</th>
                                        <th style={{ width: '80px' }}>Loại</th>
                                        <th style={{ minWidth: '150px' }}>Tiêu đề</th>
                                        <th style={{ minWidth: '200px' }}>Nội dung</th>
                                        <th style={{ minWidth: '150px' }}>Visual Idea</th>
                                        <th style={{ minWidth: '250px' }}>Lời giảng</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {slidesArray.map((slide) => (
                                        <tr key={slide.id} className={`slide-row slide-type-${slide.slideType}`}>
                                            <td className="slide-index">{slide.slideIndex}</td>
                                            <td><span className={`slide-type-badge ${slide.slideType}`}>{slide.slideType}</span></td>
                                            <td className="slide-title-cell">{slide.title}</td>
                                            <td className="slide-content-cell">{slide.content || '-'}</td>
                                            <td className="slide-visual-cell">{slide.visualIdea || '-'}</td>
                                            <td className="slide-speaker-cell">{slide.speakerNote || '-'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : viewMode === 'cards' && hasSlides ? (
                        <div className="slides-grid">
                            {slidesArray.map((slide) => (
                                <div key={slide.id} className={`slide-card slide-type-${slide.slideType}`}>
                                    <div className="slide-header">
                                        <span className="slide-number">Slide {slide.slideIndex}</span>
                                        <span className="slide-type">{slide.slideType}</span>
                                    </div>
                                    <h3 className="slide-title">{slide.title}</h3>
                                    {slide.content && (
                                        <div className="slide-content">
                                            <p>{slide.content}</p>
                                        </div>
                                    )}
                                    {slide.visualIdea && (
                                        <div className="slide-visual-idea">
                                            <span className="label">🎨 Visual Idea:</span>
                                            <p>{slide.visualIdea}</p>
                                        </div>
                                    )}
                                    {slide.imageUrl && (
                                        <div className="slide-image">
                                            <img src={slide.imageUrl} alt={slide.title} />
                                        </div>
                                    )}
                                    {slide.speakerNote && (
                                        <div className="slide-speaker-note">
                                            <span className="label">🎤 Speaker Note:</span>
                                            <p>{slide.speakerNote.substring(0, 200)}...</p>
                                        </div>
                                    )}
                                    <div className="slide-status">
                                        <span className={`status-badge status-${slide.status}`}>
                                            {slide.status}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <>
                            {parsedScript ? (
                                <SlideScriptPreview script={parsedScript} />
                            ) : (
                                <div className="markdown-preview">
                                    <pre className="raw-content">{lessonData.slideScript}</pre>
                                    <p className="hint">⚠️ Không parse được JSON. Click "Sửa JSON" để xem/sửa raw data.</p>
                                </div>
                            )}
                        </>
                    )}
                </>
            )}

            {!isGenerating && !hasScript && hasOutline && (
                <div className="empty-state">
                    <span className="empty-icon">🎨</span>
                    <p>Chưa có kịch bản slide</p>
                    <p className="hint">Click "Tạo Kịch Bản" để AI thiết kế nội dung slide</p>
                </div>
            )}
        </div>
    );
}

