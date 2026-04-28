import { useState, useEffect, useCallback, useRef } from 'react';
import { useLessonEditor } from '../../contexts/LessonEditorContext';
import { ModelSelector } from '../ModelSelector';
import { api } from '../../lib/api';
import './Steps.css';

type GenerationStatus = 'idle' | 'generating_content' | 'generating_images' | 'generating_pptx' | 'completed' | 'error';

interface Template {
    id: string;
    name: string;
    description?: string;
    titleBgUrl?: string;
    contentBgUrl?: string;
    isSystem: boolean;
}

interface OptimizedBullet {
    emoji: string;
    point: string;
    description: string;
}

interface SlideProgress {
    slideIndex: number;
    phase: 'pending' | 'optimizing_content' | 'generating_image' | 'complete' | 'error' | 'skipped';
    imageUrl?: string;
    optimizedContent?: OptimizedBullet[];
    title?: string;
    isRegenerating?: boolean;
}


const API_BASE = import.meta.env.VITE_API_URL || '';

export function Step5GeneratePPTX() {
    const { lessonId, lessonData, stepMountCounter } = useLessonEditor();
    const [status, setStatus] = useState<GenerationStatus>('idle');
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [templates, setTemplates] = useState<Template[]>([]);
    const [selectedTemplate, setSelectedTemplate] = useState<string>('');
    const [slideProgress, setSlideProgress] = useState<SlideProgress[]>([]);
    const [currentSlide, setCurrentSlide] = useState(0);
    const [totalSlides, setTotalSlides] = useState(0);
    const [pptxBlob, setPptxBlob] = useState<Blob | null>(null);
    const [contentGenerated, setContentGenerated] = useState(false);
    const [pendingCount, setPendingCount] = useState(0);
    const shouldStopGenerating = useRef(false);

    const hasSlideScript = !!lessonData?.slideScript;

    // Load templates on mount
    useEffect(() => {
        const loadTemplates = async () => {
            try {
                const response = await api.get(`/templates`);
                const tpls = response.data || [];
                setTemplates(tpls);
                // Select first template by default
                if (tpls.length > 0 && !selectedTemplate) {
                    const defaultTpl = tpls.find((t: Template) => t.isSystem) || tpls[0];
                    setSelectedTemplate(defaultTpl.id);
                }
            } catch (err) {
                console.error('Failed to load templates:', err);
            }
        };
        loadTemplates();
    }, []);

    // Load saved optimizedContent from database on mount
    useEffect(() => {
        const loadSavedContent = async () => {
            console.log('[Step5] loadSavedContent called, lessonId:', lessonId, 'stepMountCounter:', stepMountCounter);
            try {
                const response = await api.get(`/lessons/${lessonId}/slides`);
                const slides = Array.isArray(response.data) ? response.data : [];
                console.log('[Step5] API response slides:', slides.length, 'slides');

                if (slides.length === 0) {
                    console.log('[Step5] No slides found, returning');
                    return;
                }

                // Check if any slides have optimizedContentJson OR imageUrl
                const completedSlides = slides.filter(
                    (s: any) => {
                        // A slide is complete if it has an image AND either:
                        // - has optimized content, OR
                        // - is a title/special slide that doesn't need content (no raw content)
                        const hasImage = !!s.imageUrl;
                        const hasOptContent = !!s.optimizedContentJson;
                        const isTitleSlide = !s.content || s.content.trim() === '';
                        return hasImage && (hasOptContent || isTitleSlide);
                    }
                );
                const hasAnyContent = slides.some(
                    (s: any) => (s.optimizedContentJson && s.optimizedContentJson.length > 0) || s.imageUrl
                );
                const remaining = slides.length - completedSlides.length;
                console.log('[Step5] completedSlides:', completedSlides.length, '/', slides.length, 'pending:', remaining);

                if (hasAnyContent) {
                    const loadedSlideProgress: SlideProgress[] = slides.map((s: any) => {
                        const hasImage = !!s.imageUrl;
                        const hasOptContent = !!s.optimizedContentJson;
                        const isTitleSlide = !s.content || s.content.trim() === '';
                        const isComplete = hasImage && (hasOptContent || isTitleSlide);
                        return {
                            slideIndex: s.slideIndex,
                            phase: isComplete ? 'complete' as const :
                                   (hasOptContent || hasImage) ? 'error' as const : 'pending' as const,
                            imageUrl: s.imageUrl,
                            optimizedContent: s.optimizedContentJson
                                ? (typeof s.optimizedContentJson === 'string'
                                    ? JSON.parse(s.optimizedContentJson)
                                    : s.optimizedContentJson)
                                : undefined,
                            title: s.title,
                        };
                    });

                    setSlideProgress(loadedSlideProgress);
                    setTotalSlides(slides.length);
                    setContentGenerated(true);
                    setPendingCount(remaining);
                    setProgress((completedSlides.length / slides.length) * 100);

                    if (remaining === 0) {
                        setStatus('completed');
                        setProgress(100);
                    } else {
                        // Partial progress — show completed state so buttons appear
                        setStatus('completed');
                    }
                } else {
                    console.log('[Step5] No content found in slides');
                }
            } catch (err) {
                console.error('[Step5] Failed to load saved content:', err);
            }
        };

        if (lessonId) {
            loadSavedContent();
        }
    }, [lessonId, stepMountCounter]);

    const handleGeneratePptx = useCallback(async () => {
        setStatus('generating_pptx');
        setProgress(90);
        setError(null);

        try {
            const response = await fetch(`/api/lessons/${lessonId}/pptx/generate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
                },
                body: JSON.stringify({ templateId: selectedTemplate }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => null);
                const errorMsg = errorData?.message || 'Không thể tạo file PPTX';
                throw new Error(Array.isArray(errorMsg) ? errorMsg.join(', ') : errorMsg);
            }

            const blob = await response.blob();
            setPptxBlob(blob);
            setProgress(100);
            setStatus('completed');
        } catch (err: any) {
            setStatus('error');
            setError(err.message || 'Không thể tạo file PowerPoint');
        }
    }, [lessonId, selectedTemplate]);

    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    const handleGenerateContent = useCallback(async () => {
        setStatus('generating_images');
        setProgress(0);
        setError(null);
        setContentGenerated(false);
        shouldStopGenerating.current = false;

        try {
            // Load all slides from DB
            const response = await api.get(`/lessons/${lessonId}/slides`);
            const slides = Array.isArray(response.data) ? response.data : [];

            if (slides.length === 0) {
                setError('Không tìm thấy slides');
                setStatus('error');
                return;
            }

            setTotalSlides(slides.length);

            // Initialize slide progress
            const initialProgress: SlideProgress[] = slides.map((s: any) => ({
                slideIndex: s.slideIndex,
                phase: 'pending' as const,
                title: s.title,
                // Keep existing data if available
                optimizedContent: s.optimizedContentJson
                    ? (typeof s.optimizedContentJson === 'string'
                        ? JSON.parse(s.optimizedContentJson)
                        : s.optimizedContentJson)
                    : undefined,
                imageUrl: s.imageUrl,
            }));
            setSlideProgress(initialProgress);

            // Determine which slides need processing
            // (skip slides that already have BOTH content and image)
            const slidesToProcess = slides.filter((s: any) => {
                const hasImage = !!s.imageUrl;
                const hasOptContent = !!s.optimizedContentJson;
                const isTitleSlide = !s.content || s.content.trim() === '';
                return !(hasImage && (hasOptContent || isTitleSlide));
            });

            let completedCount = slides.length - slidesToProcess.length;
            let isFirstSlide = true;

            for (const slide of slidesToProcess) {
                if (shouldStopGenerating.current) {
                    setError(`⏸️ Đã dừng. Hoàn thành ${completedCount}/${slides.length} slides.`);
                    break;
                }

                const idx = slide.slideIndex;
                setCurrentSlide(idx + 1);

                // Mark as processing
                setSlideProgress(prev => prev.map(s =>
                    s.slideIndex === idx ? { ...s, phase: 'optimizing_content' } : s
                ));

                try {
                    const result = await api.post(
                        `/lessons/${lessonId}/slides/${idx}/generate-content-image`
                    );

                    // Update progress with result
                    setSlideProgress(prev => prev.map(s =>
                        s.slideIndex === idx ? {
                            ...s,
                            phase: (result.data.imageError ? 'error' : 'complete') as any,
                            optimizedContent: result.data.optimizedContent || s.optimizedContent,
                            imageUrl: result.data.imageUrl || s.imageUrl,
                            title: result.data.title || s.title,
                        } : s
                    ));

                    if (!result.data.imageError) {
                        completedCount++;
                    }
                } catch (err: any) {
                    console.error(`Error processing slide ${idx}:`, err);
                    setSlideProgress(prev => prev.map(s =>
                        s.slideIndex === idx ? { ...s, phase: 'error' } : s
                    ));
                }

                setProgress((completedCount / slides.length) * 100);

                // Delay between slides (like audio generation)
                if (isFirstSlide) {
                    await delay(8000);
                    isFirstSlide = false;
                } else {
                    await delay(5000);
                }
            }

            setContentGenerated(true);
            setPendingCount(0);
            setStatus('completed');
            setProgress(100);
        } catch (err: any) {
            setStatus('error');
            setError(err.message || 'Không thể tạo nội dung');
        }
    }, [lessonId]);

    const stopGenerating = () => {
        shouldStopGenerating.current = true;
    };

    // Regenerate ALL slides from scratch (clear existing data first)
    const handleRegenerateAll = useCallback(async () => {
        try {
            // Bulk clear all optimizedContent + imageUrl
            await api.delete(`/lessons/${lessonId}/slides/generated-content`);
        } catch (err) {
            console.warn('Failed to clear existing content, will regenerate anyway:', err);
        }
        // Now call normal generate which will process all slides (none will be skipped)
        handleGenerateContent();
    }, [lessonId, handleGenerateContent]);

    // Regenerate content for a single slide
    const handleRegenerateContent = async (slideIndex: number) => {
        setSlideProgress(prev => prev.map(s =>
            s.slideIndex === slideIndex ? { ...s, isRegenerating: true, phase: 'optimizing_content' } : s
        ));

        try {
            const response = await api.post(`/lessons/${lessonId}/slides/${slideIndex}/regenerate-content`);
            const updatedSlide = response.data;

            setSlideProgress(prev => prev.map(s =>
                s.slideIndex === slideIndex ? {
                    ...s,
                    isRegenerating: false,
                    phase: 'complete',
                    optimizedContent: typeof updatedSlide.optimizedContentJson === 'string'
                        ? JSON.parse(updatedSlide.optimizedContentJson)
                        : updatedSlide.optimizedContentJson,
                    title: updatedSlide.title,
                } : s
            ));
        } catch (err: any) {
            setSlideProgress(prev => prev.map(s =>
                s.slideIndex === slideIndex ? { ...s, isRegenerating: false, phase: 'error' } : s
            ));
            setError(`Không thể tạo lại nội dung slide ${slideIndex + 1}`);
        }
    };

    // Regenerate image for a single slide
    const handleRegenerateImage = async (slideIndex: number) => {
        setSlideProgress(prev => prev.map(s =>
            s.slideIndex === slideIndex ? { ...s, isRegenerating: true, phase: 'generating_image' } : s
        ));

        try {
            const response = await api.post(`/lessons/${lessonId}/slides/${slideIndex}/regenerate-image`);
            const updatedSlide = response.data;

            setSlideProgress(prev => prev.map(s =>
                s.slideIndex === slideIndex ? {
                    ...s,
                    isRegenerating: false,
                    phase: 'complete',
                    imageUrl: updatedSlide.imageUrl,
                } : s
            ));
        } catch (err: any) {
            setSlideProgress(prev => prev.map(s =>
                s.slideIndex === slideIndex ? { ...s, isRegenerating: false, phase: 'error' } : s
            ));
            setError(`Không thể tạo lại hình ảnh slide ${slideIndex + 1}`);
        }
    };

    const handleDownload = () => {
        if (pptxBlob) {
            const url = URL.createObjectURL(pptxBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${lessonData?.title || 'presentation'}.pptx`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    };

    // Get selected template for preview
    const selectedTpl = templates.find(t => t.id === selectedTemplate);

    return (
        <div className="step-content">
            <div className="step-header">
                <h2>📊 Bước 5: Tạo PowerPoint</h2>
            </div>

            {/* Model Selection */}
            <div className="model-selectors-row">
                <ModelSelector taskType="SLIDES" label="📝 Model nội dung" compact />
                <ModelSelector taskType="IMAGE" label="🖼️ Model hình ảnh" compact />
            </div>

            <p className="step-description">
                Hệ thống sẽ tối ưu nội dung và tạo hình ảnh AI cho từng slide.
            </p>

            {!hasSlideScript && (
                <div className="warning-message">
                    ⚠️ Vui lòng hoàn thành Kịch Bản Slide ở Bước 3 trước khi tiếp tục.
                </div>
            )}

            {error && <div className="error-banner">{error}</div>}

            {/* Template Selector with Preview */}
            {hasSlideScript && (
                <div className="template-selector-section">
                    <label htmlFor="template-select">🎨 Chọn mẫu PowerPoint:</label>
                    <div className="template-selector-row">
                        <select
                            id="template-select"
                            value={selectedTemplate}
                            onChange={(e) => setSelectedTemplate(e.target.value)}
                            className="template-dropdown"
                        >
                            <optgroup label="Mẫu hệ thống">
                                {templates.filter(t => t.isSystem).map(t => (
                                    <option key={t.id} value={t.id}>{t.name}</option>
                                ))}
                            </optgroup>
                            {templates.filter(t => !t.isSystem).length > 0 && (
                                <optgroup label="Mẫu của tôi">
                                    {templates.filter(t => !t.isSystem).map(t => (
                                        <option key={t.id} value={t.id}>{t.name}</option>
                                    ))}
                                </optgroup>
                            )}
                        </select>

                        {/* Template Preview */}
                        {selectedTpl && (
                            <div className="template-preview-small">
                                {selectedTpl.titleBgUrl && (
                                    <img src={`${API_BASE}${selectedTpl.titleBgUrl}`} alt="Title" title="Title BG" />
                                )}
                                {selectedTpl.contentBgUrl && (
                                    <img src={`${API_BASE}${selectedTpl.contentBgUrl}`} alt="Content" title="Content BG" />
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Main Action Buttons */}
            {hasSlideScript && (status === 'idle' || status === 'completed') && (
                <div className="action-buttons-row">
                    {/* Show Continue button when there are pending slides */}
                    {pendingCount > 0 && contentGenerated && (
                        <button
                            className="btn-primary"
                            onClick={handleGenerateContent}
                            disabled={status !== 'idle' && status !== 'completed'}
                        >
                            ▶️ Tiếp tục tạo ({pendingCount} slide còn lại)
                        </button>
                    )}

                    <button
                        className={pendingCount > 0 && contentGenerated ? 'btn-secondary' : 'btn-primary'}
                        onClick={handleRegenerateAll}
                        disabled={status !== 'idle' && status !== 'completed'}
                    >
                        {contentGenerated
                            ? (pendingCount > 0 ? '🔄 Tạo lại từ đầu' : '🔄 Tạo lại nội dung')
                            : '🚀 Tạo nội dung PPTX'
                        }
                    </button>

                    {contentGenerated && (
                        <button
                            className="btn-secondary"
                            onClick={pptxBlob ? handleDownload : handleGeneratePptx}
                        >
                            {pptxBlob ? '📥 Tải PPTX' : '📦 Tạo file PPTX'}
                        </button>
                    )}
                </div>
            )}

            {/* Progress summary when partially complete */}
            {contentGenerated && pendingCount > 0 && status === 'completed' && (
                <div className="partial-progress-banner">
                    ⚠️ Đã hoàn thành {totalSlides - pendingCount}/{totalSlides} slides.
                    Nhấn "▶️ Tiếp tục tạo" để hoàn thành {pendingCount} slide còn lại.
                </div>
            )}

            {/* Generation Progress */}
            {(status === 'generating_images' || status === 'generating_pptx') && (
                <div className="generation-progress">
                    <div className="progress-circle">
                        <svg viewBox="0 0 100 100">
                            <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(99, 102, 241, 0.2)" strokeWidth="8" />
                            <circle
                                cx="50" cy="50" r="45" fill="none" stroke="#6366f1" strokeWidth="8"
                                strokeDasharray={`${2 * Math.PI * 45}`}
                                strokeDashoffset={`${2 * Math.PI * 45 * (1 - progress / 100)}`}
                                strokeLinecap="round" transform="rotate(-90 50 50)"
                            />
                        </svg>
                        <span className="progress-text">{Math.round(progress)}%</span>
                    </div>
                    <p className="progress-status">
                        {status === 'generating_images' && `🖼️ Đang tạo slide ${currentSlide}/${totalSlides}...`}
                        {status === 'generating_pptx' && '📦 Đang đóng gói PowerPoint...'}
                    </p>
                    {status === 'generating_images' && (
                        <button className="btn-stop" onClick={stopGenerating}>
                            ⏹️ Dừng tạo
                        </button>
                    )}
                </div>
            )}

            {/* Slide Preview List */}
            {slideProgress.length > 0 && (
                <div className="slide-preview-section">
                    <h4>📋 Nội dung slides ({slideProgress.length})</h4>
                    <div className="slide-preview-grid">
                        {slideProgress.map((slide) => (
                            <div key={slide.slideIndex} className={`slide-card ${slide.phase} ${slide.isRegenerating ? 'regenerating' : ''}`}>
                                <div className="slide-card-header">
                                    <span className="slide-number">Slide {slide.slideIndex}</span>
                                    <span className="slide-title">{slide.title}</span>
                                    <span className="slide-status">
                                        {slide.phase === 'pending' && '⏳'}
                                        {slide.phase === 'optimizing_content' && '📝'}
                                        {slide.phase === 'generating_image' && '🖼️'}
                                        {slide.phase === 'complete' && '✅'}
                                        {slide.phase === 'error' && '❌'}
                                    </span>
                                </div>

                                <div className="slide-card-body">
                                    {/* Content side */}
                                    <div className="slide-content-col">
                                        {slide.optimizedContent && slide.optimizedContent.length > 0 ? (
                                            <ul className="bullet-list">
                                                {slide.optimizedContent.map((b, idx) => (
                                                    <li key={idx}>
                                                        <span className="emoji">{b.emoji}</span>
                                                        <strong>{b.point}</strong>
                                                        {b.description && (
                                                            <span className="description"> - {b.description}</span>
                                                        )}
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <p className="placeholder">Chưa có nội dung</p>
                                        )}
                                    </div>

                                    {/* Image side */}
                                    <div className="slide-image-col">
                                        {slide.imageUrl ? (
                                            <img src={slide.imageUrl} alt={`Slide ${slide.slideIndex}`} />
                                        ) : (
                                            <div className="image-placeholder">🖼️</div>
                                        )}
                                    </div>
                                </div>

                                {/* Regenerate buttons */}
                                {status === 'completed' && (
                                    <div className="slide-card-actions">
                                        <button
                                            className="btn-small"
                                            onClick={() => handleRegenerateContent(slide.slideIndex)}
                                            disabled={slide.isRegenerating}
                                        >
                                            🔄 Tạo lại nội dung
                                        </button>
                                        <button
                                            className="btn-small"
                                            onClick={() => handleRegenerateImage(slide.slideIndex)}
                                            disabled={slide.isRegenerating}
                                        >
                                            🖼️ Tạo lại ảnh
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
