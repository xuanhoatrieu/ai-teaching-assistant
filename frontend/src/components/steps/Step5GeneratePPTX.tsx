import { useState, useEffect, useCallback, useRef } from 'react';
import { useLessonEditor } from '../../contexts/LessonEditorContext';
import { ModelSelector } from '../ModelSelector';
import { api } from '../../lib/api';
import { useJobPolling } from '../../hooks/useJobPolling';
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
    const [totalSlides, setTotalSlides] = useState(0);
    const [contentGenerated, setContentGenerated] = useState(false);
    const [pendingCount, setPendingCount] = useState(0);

    // Ephemeral PPTX state (download and auto-cleanup)
    const [tempFileKey, setTempFileKey] = useState<string | null>(null);
    const [tempFileKeyNoAudio, setTempFileKeyNoAudio] = useState<string | null>(null);
    const [tempFileSize, setTempFileSize] = useState<number | null>(null);
    const [tempFileSizeNoAudio, setTempFileSizeNoAudio] = useState<number | null>(null);
    const [downloadingAudio, setDownloadingAudio] = useState(false);
    const [downloadingNoAudio, setDownloadingNoAudio] = useState(false);

    const tempFileKeyRef = useRef<string | null>(null);
    const tempFileKeyNoAudioRef = useRef<string | null>(null);
    const isGeneratingNoAudioRef = useRef(false);

    useEffect(() => {
        tempFileKeyRef.current = tempFileKey;
    }, [tempFileKey]);

    useEffect(() => {
        tempFileKeyNoAudioRef.current = tempFileKeyNoAudio;
    }, [tempFileKeyNoAudio]);

    // Cleanup temp PPTX files when component unmounts (navigating away / switching steps)
    useEffect(() => {
        return () => {
            const key = tempFileKeyRef.current || tempFileKeyNoAudioRef.current;
            if (key) {
                api.delete(`/lessons/${lessonId}/pptx/cleanup-temp?fileKey=${key}`).catch(() => {});
            }
        };
    }, [lessonId]);

    // Reset and cleanup temp files when template changes
    useEffect(() => {
        if (tempFileKeyRef.current) {
            api.delete(`/lessons/${lessonId}/pptx/cleanup-temp?fileKey=${tempFileKeyRef.current}`).catch(() => {});
            setTempFileKey(null);
            setTempFileSize(null);
        }
        if (tempFileKeyNoAudioRef.current) {
            api.delete(`/lessons/${lessonId}/pptx/cleanup-temp?fileKey=${tempFileKeyNoAudioRef.current}`).catch(() => {});
            setTempFileKeyNoAudio(null);
            setTempFileSizeNoAudio(null);
        }
    }, [selectedTemplate, lessonId]);

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
    const loadSavedContent = useCallback(async (isJobActive = false) => {
        console.log('[Step5] loadSavedContent called, lessonId:', lessonId, 'stepMountCounter:', stepMountCounter, 'isJobActive:', isJobActive);
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
                    
                    let phase: 'pending' | 'optimizing_content' | 'generating_image' | 'complete' | 'error' | 'skipped' = 'pending';
                    if (isComplete) {
                        phase = 'complete';
                    } else if (isJobActive) {
                        phase = hasOptContent ? 'generating_image' : 'optimizing_content';
                    } else if (hasOptContent || hasImage) {
                        phase = 'error';
                    } else {
                        phase = 'pending';
                    }

                    return {
                        slideIndex: s.slideIndex,
                        phase,
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
                    if (!isJobActive) setStatus('completed');
                    setProgress(100);
                } else {
                    // Partial progress — show completed state so buttons appear (unless job is active)
                    if (!isJobActive) setStatus('completed');
                }
            } else {
                console.log('[Step5] No content found in slides');
            }
        } catch (err) {
            console.error('[Step5] Failed to load saved content:', err);
        }
    }, [lessonId, stepMountCounter]);

    const contentJob = useJobPolling({
        onComplete: async () => {
            setStatus('completed');
            setProgress(100);
            await loadSavedContent(false);
        },
        onError: (msg) => {
            setStatus('error');
            setError(`Lỗi khi tối ưu nội dung: ${msg}`);
            loadSavedContent(false);
        },
        onCancelled: async () => {
            setStatus('idle');
            await loadSavedContent(false);
        },
    });

    const checkTempStatus = useCallback(async () => {
        if (!lessonId) return;
        try {
            const res = await api.get(`/lessons/${lessonId}/pptx/temp-status`);
            if (res.data?.audioFileKey) {
                setTempFileKey(res.data.audioFileKey);
                if (res.data.audioFileSize) setTempFileSize(res.data.audioFileSize);
            }
            if (res.data?.noAudioFileKey) {
                setTempFileKeyNoAudio(res.data.noAudioFileKey);
                if (res.data.noAudioFileSize) setTempFileSizeNoAudio(res.data.noAudioFileSize);
            }
        } catch (err) {
            console.warn('[Step5] Could not check temp status:', err);
        }
    }, [lessonId]);

    const packagingJob = useJobPolling({
        intervalMs: 600,
        onComplete: async (jobStatus) => {
            setStatus('completed');
            setProgress(100);
            const fileKey = jobStatus?.result?.fileKey;
            const fileSize = jobStatus?.result?.fileSize;
            if (fileKey) {
                if (isGeneratingNoAudioRef.current) {
                    setTempFileKeyNoAudio(fileKey);
                    if (fileSize) setTempFileSizeNoAudio(fileSize);
                } else {
                    setTempFileKey(fileKey);
                    if (fileSize) setTempFileSize(fileSize);
                }
            }
            // Double check temp status from backend in case of reload or missed result
            await checkTempStatus();
        },
        onError: (msg) => {
            setStatus('error');
            setError(`Lỗi khi đóng gói PowerPoint: ${msg}`);
        },
        onCancelled: async () => {
            setStatus('completed');
        },
    });

    const checkActiveJob = useCallback(async () => {
        try {
            const response = await api.get(`/generation-jobs/active?lessonId=${lessonId}&type=pptx-generate-content`);
            if (response.data?.id) {
                setStatus('generating_images');
                contentJob.startPolling(response.data.id);
                return true;
            }
        } catch (err) {
            console.error('Failed to check active content job:', err);
        }
        return false;
    }, [lessonId]);

    const checkActivePackagingJob = useCallback(async () => {
        try {
            const response = await api.get(`/generation-jobs/active?lessonId=${lessonId}&type=pptx-packaging`);
            if (response.data?.id) {
                setStatus('generating_pptx');
                packagingJob.startPolling(response.data.id);
                return true;
            }
        } catch (err) {
            console.error('Failed to check active packaging job:', err);
        }
        return false;
    }, [lessonId]);

    // Load saved optimizedContent from database on mount & check active jobs / available temp downloads
    useEffect(() => {
        if (lessonId) {
            const init = async () => {
                const isContentActive = await checkActiveJob();
                const isPackagingActive = await checkActivePackagingJob();
                await loadSavedContent(isContentActive || isPackagingActive);
                await checkTempStatus();
            };
            init();
        }
    }, [lessonId, loadSavedContent, checkActiveJob, checkActivePackagingJob, checkTempStatus]);

    // Reload slide contents reactively when job progress changes
    useEffect(() => {
        if (contentJob.isRunning) {
            loadSavedContent(true);
        }
    }, [contentJob.jobStatus?.progress, contentJob.isRunning, loadSavedContent]);

    const isJobRunning = contentJob.isRunning || packagingJob.isRunning;
    const currentProgress = contentJob.isRunning && contentJob.jobStatus
        ? contentJob.jobStatus.progress
        : packagingJob.isRunning && packagingJob.jobStatus
            ? packagingJob.jobStatus.progress
            : progress;

    const handleGeneratePptx = useCallback(async () => {
        if (tempFileKey) {
            api.delete(`/lessons/${lessonId}/pptx/cleanup-temp?fileKey=${tempFileKey}`).catch(() => {});
            setTempFileKey(null);
            setTempFileSize(null);
        }

        setStatus('generating_pptx');
        setProgress(0);
        setError(null);
        isGeneratingNoAudioRef.current = false;

        try {
            const response = await api.post(`/lessons/${lessonId}/pptx/start-packaging`, {
                templateId: selectedTemplate,
                skipAudio: false,
            });

            if (response.data?.jobId) {
                packagingJob.startPolling(response.data.jobId);
            } else {
                throw new Error('Không nhận được mã tiến trình đóng gói');
            }
        } catch (err: any) {
            setStatus('error');
            setError(err.response?.data?.message || err.message || 'Không thể bắt đầu đóng gói PowerPoint');
        }
    }, [lessonId, selectedTemplate, tempFileKey]);

    const handleGeneratePptxNoAudio = useCallback(async () => {
        if (tempFileKeyNoAudio) {
            api.delete(`/lessons/${lessonId}/pptx/cleanup-temp?fileKey=${tempFileKeyNoAudio}`).catch(() => {});
            setTempFileKeyNoAudio(null);
            setTempFileSizeNoAudio(null);
        }

        setStatus('generating_pptx');
        setProgress(0);
        setError(null);
        isGeneratingNoAudioRef.current = true;

        try {
            const response = await api.post(`/lessons/${lessonId}/pptx/start-packaging`, {
                templateId: selectedTemplate,
                skipAudio: true,
            });

            if (response.data?.jobId) {
                packagingJob.startPolling(response.data.jobId);
            } else {
                throw new Error('Không nhận được mã tiến trình đóng gói');
            }
        } catch (err: any) {
            setStatus('error');
            setError(err.response?.data?.message || err.message || 'Không thể bắt đầu đóng gói PowerPoint');
        }
    }, [lessonId, selectedTemplate, tempFileKeyNoAudio]);

    const handleDownloadTempFile = async (key: string, isNoAudio: boolean) => {
        if (isNoAudio) setDownloadingNoAudio(true);
        else setDownloadingAudio(true);

        try {
            const token = localStorage.getItem('accessToken');
            const res = await fetch(`/api/lessons/${lessonId}/pptx/download-temp?fileKey=${key}`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => null);
                throw new Error(errData?.message || 'Không thể tải file PowerPoint tạm thời (có thể file đã hết hạn hoặc bị xóa)');
            }

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${lessonData?.title || 'presentation'}${isNoAudio ? '_no_audio' : ''}.pptx`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err: any) {
            console.error('Download error:', err);
            setError(err.message || 'Lỗi khi tải file PowerPoint');
        } finally {
            if (isNoAudio) setDownloadingNoAudio(false);
            else setDownloadingAudio(false);
        }
    };

    const handleGenerateContent = useCallback(async () => {
        setStatus('generating_images');
        setProgress(0);
        setError(null);
        setContentGenerated(false);

        try {
            const response = await api.post(`/lessons/${lessonId}/slides/generate-all-content`);
            if (response.data?.jobId) {
                contentJob.startPolling(response.data.jobId);
            }
        } catch (err: any) {
            setStatus('error');
            setError(err.response?.data?.message || err.message || 'Không thể bắt đầu tạo nội dung');
        }
    }, [lessonId]);

    const stopGenerating = useCallback(async () => {
        if (!window.confirm('Dừng việc tạo nội dung? Các slide đã tạo xong sẽ được giữ lại.')) {
            return;
        }
        const jobId = contentJob.jobStatus?.id;
        try {
            if (jobId) {
                await api.post(`/generation-jobs/${jobId}/cancel`);
            }
        } catch (err) {
            console.error('[Step5] Failed to cancel job:', err);
        }
        contentJob.stopPolling();
        setStatus('idle');
        await loadSavedContent(false);
    }, [contentJob, loadSavedContent]);

    const stopPackaging = useCallback(async () => {
        if (!window.confirm('Dừng quá trình đóng gói PowerPoint?')) {
            return;
        }
        const jobId = packagingJob.jobStatus?.id;
        try {
            if (jobId) {
                await api.post(`/generation-jobs/${jobId}/cancel`);
            }
        } catch (err) {
            console.error('[Step5] Failed to cancel packaging job:', err);
        }
        packagingJob.stopPolling();
        setStatus('completed');
    }, [packagingJob]);

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
            setError(`Không thể tạo lại nội dung slide ${slideIndex}`);
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
            setError(`Không thể tạo lại hình ảnh slide ${slideIndex}`);
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

            {/* Download Ready Banner */}
            {(tempFileKey || tempFileKeyNoAudio) && (status === 'idle' || status === 'completed') && (
                <div className="download-ready-banner">
                    <div className="download-ready-content">
                        <span className="download-ready-badge">🎉 ĐÃ ĐÓNG GÓI XONG</span>
                        <h3>File PowerPoint đã sẵn sàng tải về!</h3>
                        <p>
                            File PPTX được lưu tạm trên máy chủ. Bạn có thể tải trực tiếp về máy tính cá nhân. File sẽ tự động dọn dẹp khi bạn chuyển tính năng khác.
                        </p>
                        <div className="download-ready-buttons">
                            {tempFileKey && (
                                <button
                                    className="btn-download-hero primary"
                                    onClick={() => handleDownloadTempFile(tempFileKey, false)}
                                    disabled={downloadingAudio}
                                >
                                    {downloadingAudio
                                        ? '⏳ Đang tải file về máy...'
                                        : `📥 TẢI PPTX (CÓ AUDIO)${tempFileSize ? ` • ${(tempFileSize / (1024 * 1024)).toFixed(1)} MB` : ''}`}
                                </button>
                            )}
                            {tempFileKeyNoAudio && (
                                <button
                                    className="btn-download-hero secondary"
                                    onClick={() => handleDownloadTempFile(tempFileKeyNoAudio, true)}
                                    disabled={downloadingNoAudio}
                                >
                                    {downloadingNoAudio
                                        ? '⏳ Đang tải file về máy...'
                                        : `📥 TẢI PPTX (KHÔNG AUDIO)${tempFileSizeNoAudio ? ` • ${(tempFileSizeNoAudio / (1024 * 1024)).toFixed(1)} MB` : ''}`}
                                </button>
                            )}
                        </div>
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
                        <>
                            <button
                                className={`btn-secondary ${tempFileKey ? 'btn-download-ready' : ''}`}
                                onClick={tempFileKey ? () => handleDownloadTempFile(tempFileKey, false) : handleGeneratePptx}
                                disabled={isJobRunning || downloadingAudio}
                            >
                                {downloadingAudio
                                    ? '⏳ Đang tải file...'
                                    : tempFileKey
                                        ? `📥 Tải PPTX (có Audio)${tempFileSize ? ` (${(tempFileSize / (1024 * 1024)).toFixed(1)} MB)` : ''}`
                                        : '📦 Tạo PPTX (có Audio)'
                                }
                            </button>
                            <button
                                className={`btn-secondary ${tempFileKeyNoAudio ? 'btn-download-ready' : ''}`}
                                onClick={tempFileKeyNoAudio ? () => handleDownloadTempFile(tempFileKeyNoAudio, true) : handleGeneratePptxNoAudio}
                                disabled={isJobRunning || downloadingNoAudio}
                            >
                                {downloadingNoAudio
                                    ? '⏳ Đang tải file...'
                                    : tempFileKeyNoAudio
                                        ? `📥 Tải PPTX (không Audio)${tempFileSizeNoAudio ? ` (${(tempFileSizeNoAudio / (1024 * 1024)).toFixed(1)} MB)` : ''}`
                                        : '📦 Tạo PPTX (không Audio)'
                                }
                            </button>
                        </>
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
                                strokeDashoffset={`${2 * Math.PI * 45 * (1 - currentProgress / 100)}`}
                                strokeLinecap="round" transform="rotate(-90 50 50)"
                            />
                        </svg>
                        <span className="progress-text">{Math.round(currentProgress)}%</span>
                    </div>
                    <p className="progress-status">
                        {status === 'generating_images' && (contentJob.isRunning && contentJob.jobStatus ? contentJob.jobStatus.message : `🖼️ Đang tạo slide...`)}
                        {status === 'generating_pptx' && (packagingJob.isRunning && packagingJob.jobStatus ? packagingJob.jobStatus.message : `📦 Đang đóng gói PowerPoint...`)}
                    </p>
                    {status === 'generating_images' && contentJob.isRunning && (
                        <button className="btn-stop" onClick={stopGenerating}>
                            ⏹️ Dừng tạo
                        </button>
                    )}
                    {status === 'generating_pptx' && packagingJob.isRunning && (
                        <button className="btn-stop" onClick={stopPackaging}>
                            ⏹️ Dừng đóng gói
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
