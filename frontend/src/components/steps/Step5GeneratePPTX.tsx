import { useState, useEffect, useCallback, useRef } from 'react';
import { useLessonEditor } from '../../contexts/LessonEditorContext';
import { ModelSelector } from '../ModelSelector';
import { api } from '../../lib/api';
import { useJobPolling } from '../../hooks/useJobPolling';
import { ImageCropModal } from '../ImageCropModal';
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
    content?: string;
    speakerNote?: string;
    isRegenerating?: boolean;
    extraAudioUrl?: string | null;
    extraAudioName?: string | null;
    extraAudioDuration?: number | null;
    slideType?: string;
    layoutType?: string;
    interactiveData?: string | null;
}


const API_BASE = import.meta.env.VITE_API_URL || '';

export function Step5GeneratePPTX() {
    const { lessonId, lessonData, stepMountCounter, refreshLessonData } = useLessonEditor();
    const [status, setStatus] = useState<GenerationStatus>('idle');
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [templates, setTemplates] = useState<Template[]>([]);
    const [selectedTemplate, setSelectedTemplate] = useState<string>('');
    const [scormH5pBgOption, setScormH5pBgOption] = useState<string>('tuaf_clean');
    const [scormH5pTheme, setScormH5pTheme] = useState<'light' | 'dark'>('light');
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

    // Slide content inline editing state
    const [editingSlideIndex, setEditingSlideIndex] = useState<number | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [editRawContent, setEditRawContent] = useState('');
    const [editBullets, setEditBullets] = useState<OptimizedBullet[]>([]);
    const [isSavingContent, setIsSavingContent] = useState(false);

    // Slide custom image upload state
    const [cropModalOpen, setCropModalOpen] = useState(false);
    const [cropImageSrc, setCropImageSrc] = useState<string>('');
    const [cropSlideIndex, setCropSlideIndex] = useState<number | null>(null);
    const [isUploadingImage, setIsUploadingImage] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [targetUploadSlideIndex, setTargetUploadSlideIndex] = useState<number | null>(null);
    const targetUploadSlideIndexRef = useRef<number | null>(null);

    // Add Slide Modal state
    const [isAddSlideModalOpen, setIsAddSlideModalOpen] = useState(false);
    const [newSlideTitle, setNewSlideTitle] = useState('');
    const [newSlideContent, setNewSlideContent] = useState('');
    const [newSlideType, setNewSlideType] = useState<string>('content');
    const [newSlideInsertAfter, setNewSlideInsertAfter] = useState<number>(-1);
    const [autoGenerateAI, setAutoGenerateAI] = useState(true);
    const [isCreatingSlide, setIsCreatingSlide] = useState(false);

    // Interactive activity state
    const [generatingInteractionSlideIndex, setGeneratingInteractionSlideIndex] = useState<number | null>(null);

    // Interactive Slide & Question Config Modal state
    const [isInteractiveModalOpen, setIsInteractiveModalOpen] = useState(false);
    const [interactiveTargetSlideIndex, setInteractiveTargetSlideIndex] = useState<number | null>(null);
    const [interactiveModalInsertAfter, setInteractiveModalInsertAfter] = useState<number>(-1);
    const [interactiveModalTitle, setInteractiveModalTitle] = useState<string>('');
    const [interactiveActivityType, setInteractiveActivityType] = useState<string>('checkpoint_quiz');
    const [interactiveGenerationMode, setInteractiveGenerationMode] = useState<'generate_new' | 'extract_existing'>('generate_new');
    const [interactiveSourceType, setInteractiveSourceType] = useState<'slide_range' | 'custom_text' | 'audio' | 'image'>('slide_range');
    const [interactiveFromSlide, setInteractiveFromSlide] = useState<number>(1);
    const [interactiveToSlide, setInteractiveToSlide] = useState<number>(1);
    const [interactiveCustomContent, setInteractiveCustomContent] = useState<string>('');
    const [interactiveAudioFile, setInteractiveAudioFile] = useState<File | null>(null);
    const [interactiveImageFile, setInteractiveImageFile] = useState<File | null>(null);
    const [interactiveImagePreview, setInteractiveImagePreview] = useState<string | null>(null);
    const [interactiveImageBase64, setInteractiveImageBase64] = useState<string | null>(null);
    const modalAudioInputRef = useRef<HTMLInputElement | null>(null);
    const modalImageInputRef = useRef<HTMLInputElement | null>(null);
    const [selectedQTypes, setSelectedQTypes] = useState<string[]>(['MC', 'TF', 'MR', 'FIB', 'MATCH', 'ORDER', 'CLOZE']);
    const [interactiveQCount, setInteractiveQCount] = useState<number>(5);
    const [interactivePassScore, setInteractivePassScore] = useState<number>(4);
    const [interactiveFallbackSlide, setInteractiveFallbackSlide] = useState<number>(1);
    const [interactiveAllowContinueWithoutPass, setInteractiveAllowContinueWithoutPass] = useState<boolean>(false);
    const [isGeneratingInteractive, setIsGeneratingInteractive] = useState<boolean>(false);

    // E-Learning & Moodle Export states
    const [isExportingScorm, setIsExportingScorm] = useState(false);
    const [isExportingH5p, setIsExportingH5p] = useState(false);
    const [isExportingMoodleXml, setIsExportingMoodleXml] = useState(false);
    const [isMoodleGuideModalOpen, setIsMoodleGuideModalOpen] = useState(false);

    // Slide reordering and deleting states
    const [isMovingSlide, setIsMovingSlide] = useState(false);
    const [isDeletingSlide, setIsDeletingSlide] = useState(false);

    // Extra audio upload state
    const [isUploadingExtraAudio, setIsUploadingExtraAudio] = useState(false);
    const extraAudioInputRef = useRef<HTMLInputElement | null>(null);
    const [targetExtraAudioSlideIndex, setTargetExtraAudioSlideIndex] = useState<number | null>(null);
    const targetExtraAudioSlideIndexRef = useRef<number | null>(null);

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
                console.log('[Step5] No slides found, clearing progress');
                setSlideProgress([]);
                setTotalSlides(0);
                setContentGenerated(false);
                setPendingCount(0);
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
                    content: s.content,
                    speakerNote: s.speakerNote,
                    extraAudioUrl: s.extraAudioUrl,
                    extraAudioName: s.extraAudioName,
                    extraAudioDuration: s.extraAudioDuration,
                    slideType: s.slideType || 'content',
                    layoutType: s.layoutType || (s.slideType === 'checkpoint_quiz' ? 'checkpoint_gate' : (s.extraAudioUrl ? 'audio_lab' : 'split_standard')),
                    interactiveData: s.interactiveData,
                };
            });

            setSlideProgress(loadedSlideProgress);
            setTotalSlides(slides.length);
            setContentGenerated(hasAnyContent);
            setPendingCount(remaining);
            setProgress(slides.length > 0 ? (completedSlides.length / slides.length) * 100 : 0);

            if (hasAnyContent) {
                if (remaining === 0) {
                    if (!isJobActive) setStatus('completed');
                    setProgress(100);
                } else {
                    // Partial progress — show completed state so buttons appear (unless job is active)
                    if (!isJobActive) setStatus('completed');
                }
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

    const handleExportScorm = async () => {
        try {
            setIsExportingScorm(true);
            const params = new URLSearchParams();
            if (selectedTemplate) params.append('templateId', selectedTemplate);
            if (scormH5pBgOption) params.append('bgOption', scormH5pBgOption);
            if (scormH5pTheme) params.append('theme', scormH5pTheme);

            const queryString = params.toString() ? `?${params.toString()}` : '';
            const res = await api.get(`/lessons/${lessonId}/slides/export/scorm${queryString}`, { responseType: 'blob' });
            const blob = new Blob([res.data], { type: 'application/zip' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${lessonData?.title || 'lesson'}_SCORM_1.2.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (err: any) {
            console.error('SCORM export error:', err);
            setError(`Không thể xuất gói SCORM: ${err.response?.data?.message || err.message}`);
        } finally {
            setIsExportingScorm(false);
        }
    };

    const handleExportH5p = async () => {
        try {
            setIsExportingH5p(true);
            const params = new URLSearchParams();
            if (selectedTemplate) params.append('templateId', selectedTemplate);
            if (scormH5pBgOption) params.append('bgOption', scormH5pBgOption);
            if (scormH5pTheme) params.append('theme', scormH5pTheme);

            const queryString = params.toString() ? `?${params.toString()}` : '';
            const res = await api.get(`/lessons/${lessonId}/slides/export/h5p${queryString}`, { responseType: 'blob' });
            const blob = new Blob([res.data], { type: 'application/zip' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${lessonData?.title || 'lesson'}_H5P.h5p`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (err: any) {
            console.error('H5P export error:', err);
            setError(`Không thể xuất gói H5P: ${err.response?.data?.message || err.message}`);
        } finally {
            setIsExportingH5p(false);
        }
    };

    const handleExportMoodleXml = async () => {
        try {
            setIsExportingMoodleXml(true);
            const res = await api.get(`/lessons/${lessonId}/slides/export/moodle-xml`, { responseType: 'blob' });
            const blob = new Blob([res.data], { type: 'application/xml' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${lessonData?.title || 'lesson'}_moodle_quiz.xml`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (err: any) {
            console.error('Moodle XML export error:', err);
            setError(`Không thể xuất Moodle XML: ${err.response?.data?.message || err.message}`);
        } finally {
            setIsExportingMoodleXml(false);
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
                    imageUrl: `${updatedSlide.imageUrl}?t=${Date.now()}`,
                } : s
            ));
        } catch (err: any) {
            setSlideProgress(prev => prev.map(s =>
                s.slideIndex === slideIndex ? { ...s, isRegenerating: false, phase: 'error' } : s
            ));
            setError(`Không thể tạo lại hình ảnh slide ${slideIndex}`);
        }
    };

    // Slide Content Inline Editing Handlers
    const handleStartEditContent = (slide: SlideProgress) => {
        setEditingSlideIndex(slide.slideIndex);
        setEditTitle(slide.title || '');
        setEditRawContent(slide.content || '');
        if (slide.optimizedContent && slide.optimizedContent.length > 0) {
            setEditBullets(JSON.parse(JSON.stringify(slide.optimizedContent)));
        } else {
            setEditBullets([{ emoji: '📌', point: '', description: '' }]);
        }
    };

    const handleCancelEditContent = () => {
        setEditingSlideIndex(null);
        setEditTitle('');
        setEditRawContent('');
        setEditBullets([]);
    };

    const handleSaveEditContent = async (slideIndex: number, andGenerateAI = false) => {
        setIsSavingContent(true);
        try {
            const validBullets = editBullets.filter(b => b.point.trim() !== '' || b.description.trim() !== '');
            const currentSlide = slideProgress.find(s => s.slideIndex === slideIndex);
            const response = await api.put(`/lessons/${lessonId}/slides/${slideIndex}/content`, {
                title: editTitle,
                content: editRawContent,
                speakerNote: currentSlide?.speakerNote,
                optimizedContent: validBullets,
            });
            const updated = response.data;
            setSlideProgress(prev => prev.map(s => s.slideIndex === slideIndex ? {
                ...s,
                title: updated.title,
                content: updated.content,
                speakerNote: updated.speakerNote,
                optimizedContent: typeof updated.optimizedContentJson === 'string'
                    ? JSON.parse(updated.optimizedContentJson)
                    : updated.optimizedContentJson,
            } : s));
            setEditingSlideIndex(null);

            if (andGenerateAI) {
                await handleRegenerateContent(slideIndex);
            }
        } catch (err: any) {
            console.error('Failed to save slide content:', err);
            setError(`Lỗi khi lưu nội dung slide ${slideIndex}: ${err.response?.data?.message || err.message}`);
        } finally {
            setIsSavingContent(false);
        }
    };

    const handleAddBullet = () => {
        setEditBullets(prev => [...prev, { emoji: '📌', point: '', description: '' }]);
    };

    const handleRemoveBullet = (index: number) => {
        setEditBullets(prev => prev.filter((_, i) => i !== index));
    };

    const handleBulletChange = (index: number, field: keyof OptimizedBullet, value: string) => {
        setEditBullets(prev => prev.map((bullet, i) => i === index ? { ...bullet, [field]: value } : bullet));
    };

    // Custom Image Upload & Cropping Handlers
    const handleTriggerUpload = (slideIndex: number) => {
        targetUploadSlideIndexRef.current = slideIndex;
        setTargetUploadSlideIndex(slideIndex);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
            fileInputRef.current.click();
        }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        const activeIdx = targetUploadSlideIndexRef.current ?? targetUploadSlideIndex;
        if (!file || activeIdx === null) return;

        if (!file.type.startsWith('image/')) {
            setError('Vui lòng chọn file hình ảnh hợp lệ (PNG, JPG, WEBP)');
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            if (event.target?.result) {
                setCropImageSrc(event.target.result as string);
                setCropSlideIndex(activeIdx);
                setCropModalOpen(true);
            }
        };
        reader.readAsDataURL(file);
    };

    const handleCropComplete = async (croppedBlob: Blob) => {
        if (cropSlideIndex === null) return;
        setIsUploadingImage(true);

        try {
            const formData = new FormData();
            formData.append('image', croppedBlob, `slide_${cropSlideIndex}_custom.png`);

            const response = await api.post(
                `/lessons/${lessonId}/slides/${cropSlideIndex}/custom-image`,
                formData,
                {
                    headers: {
                        'Content-Type': 'multipart/form-data',
                    },
                }
            );

            const updatedSlide = response.data;
            const newImageUrl = `${updatedSlide.imageUrl}?t=${Date.now()}`;

            setSlideProgress(prev => prev.map(s =>
                s.slideIndex === cropSlideIndex ? {
                    ...s,
                    imageUrl: newImageUrl,
                    phase: 'complete',
                } : s
            ));

            setCropModalOpen(false);
            setCropImageSrc('');
            setCropSlideIndex(null);
        } catch (err: any) {
            console.error('Failed to upload slide custom image:', err);
            setError(`Không thể tải lên ảnh cho slide ${cropSlideIndex}: ${err.response?.data?.message || err.message}`);
        } finally {
            setIsUploadingImage(false);
        }
    };

    // Slide Move handler
    const handleMoveSlide = async (slideIndex: number, direction: 'up' | 'down') => {
        setIsMovingSlide(true);
        setError(null);
        try {
            if (tempFileKey) {
                api.delete(`/lessons/${lessonId}/pptx/cleanup-temp?fileKey=${tempFileKey}`).catch(() => {});
                setTempFileKey(null);
                setTempFileSize(null);
            }
            if (tempFileKeyNoAudio) {
                api.delete(`/lessons/${lessonId}/pptx/cleanup-temp?fileKey=${tempFileKeyNoAudio}`).catch(() => {});
                setTempFileKeyNoAudio(null);
                setTempFileSizeNoAudio(null);
            }

            await api.post(`/lessons/${lessonId}/slides/${slideIndex}/move`, { direction });
            await loadSavedContent(false);
            await refreshLessonData();
        } catch (err: any) {
            console.error('Failed to move slide:', err);
            setError(`Không thể di chuyển slide: ${err.response?.data?.message || err.message}`);
        } finally {
            setIsMovingSlide(false);
        }
    };

    // Slide Delete handler
    const handleDeleteSlide = async (slideIndex: number) => {
        if (slideProgress.length <= 1) {
            setError('Không thể xóa slide duy nhất trong bài giảng');
            return;
        }

        if (!window.confirm(`Bạn có chắc chắn muốn xóa Slide ${slideIndex}? Thao tác này sẽ xóa nội dung, audio bài giảng, audio mẫu và hình ảnh của slide.`)) {
            return;
        }

        setIsDeletingSlide(true);
        setError(null);
        try {
            if (tempFileKey) {
                api.delete(`/lessons/${lessonId}/pptx/cleanup-temp?fileKey=${tempFileKey}`).catch(() => {});
                setTempFileKey(null);
                setTempFileSize(null);
            }
            if (tempFileKeyNoAudio) {
                api.delete(`/lessons/${lessonId}/pptx/cleanup-temp?fileKey=${tempFileKeyNoAudio}`).catch(() => {});
                setTempFileKeyNoAudio(null);
                setTempFileSizeNoAudio(null);
            }

            await api.delete(`/lessons/${lessonId}/slides/${slideIndex}`);
            await loadSavedContent(false);
            await refreshLessonData();
        } catch (err: any) {
            console.error('Failed to delete slide:', err);
            setError(`Không thể xóa slide: ${err.response?.data?.message || err.message}`);
        } finally {
            setIsDeletingSlide(false);
        }
    };

    // Open Add Theory Slide Modal
    const openAddSlideModal = (insertAfter: number = -1, defaultType: string = 'content') => {
        const nextNum = insertAfter >= 0 ? insertAfter + 1 : slideProgress.length + 1;
        setNewSlideTitle(`Slide ${nextNum}`);
        setNewSlideContent('');
        setNewSlideType(defaultType);
        setNewSlideInsertAfter(insertAfter);
        setAutoGenerateAI(true);
        setIsAddSlideModalOpen(true);
    };

    // Open Add Interactive Slide Modal
    const openAddInteractiveModal = (insertAfter: number = -1) => {
        const nextNum = insertAfter >= 0 ? insertAfter + 1 : slideProgress.length + 1;
        setInteractiveTargetSlideIndex(null);
        setInteractiveModalInsertAfter(insertAfter);
        setInteractiveModalTitle(`Trạm Kiểm Soát Kiến Thức (Slide ${nextNum})`);
        setInteractiveActivityType('checkpoint_quiz');

        const maxPrev = insertAfter >= 1 ? insertAfter : Math.max(1, slideProgress.length);
        setInteractiveGenerationMode('generate_new');
        setInteractiveFromSlide(1);
        setInteractiveToSlide(maxPrev);
        setInteractiveFallbackSlide(1);
        setInteractiveSourceType('slide_range');
        setInteractiveCustomContent('');
        setInteractiveAudioFile(null);
        setInteractiveImageFile(null);
        setInteractiveImagePreview(null);
        setInteractiveImageBase64(null);
        setSelectedQTypes(['MC', 'TF', 'MR', 'FIB', 'MATCH', 'ORDER', 'CLOZE']);
        setInteractiveQCount(5);
        setInteractivePassScore(4);
        setInteractiveAllowContinueWithoutPass(false);
        setIsInteractiveModalOpen(true);
    };

    // Open Reconfigure / Regenerate Questions for Existing Interactive Slide
    const openConfigureExistingInteractiveModal = (slide: SlideProgress) => {
        setInteractiveTargetSlideIndex(slide.slideIndex);
        setInteractiveModalTitle(slide.title || `Slide ${slide.slideIndex}`);
        setInteractiveActivityType(slide.slideType === 'interactive_audio' ? 'interactive_audio' : 'checkpoint_quiz');
        setInteractiveGenerationMode('generate_new');
        setInteractiveImageBase64(null);

        let parsed: any = null;
        if (slide.interactiveData) {
            try {
                parsed = typeof slide.interactiveData === 'string' ? JSON.parse(slide.interactiveData) : slide.interactiveData;
            } catch {}
        }

        const maxPrev = Math.max(1, slide.slideIndex - 1);
        setInteractiveFromSlide(1);
        setInteractiveToSlide(maxPrev);
        setInteractiveFallbackSlide(parsed?.fallbackSlideIndex || 1);
        setInteractiveAllowContinueWithoutPass(parsed?.allowContinueWithoutPass === true);
        setInteractiveSourceType(slide.slideType === 'interactive_audio' || slide.extraAudioUrl ? 'audio' : 'slide_range');
        setInteractiveCustomContent('');
        setInteractiveAudioFile(null);
        setInteractiveImageFile(null);
        setInteractiveImagePreview(null);
        setInteractiveImageBase64(null);

        if (parsed?.questions && Array.isArray(parsed.questions) && parsed.questions.length > 0) {
            const existingTypes = Array.from(new Set(parsed.questions.map((q: any) => q.type || 'MC'))) as string[];
            setSelectedQTypes(existingTypes.length > 0 ? existingTypes : ['MC', 'TF', 'MR', 'FIB', 'MATCH', 'ORDER', 'CLOZE']);
            setInteractiveQCount(parsed.questions.length);
            setInteractivePassScore(parsed.passScore || 4);
        } else {
            setSelectedQTypes(['MC', 'TF', 'MR', 'FIB', 'MATCH', 'ORDER', 'CLOZE']);
            setInteractiveQCount(5);
            setInteractivePassScore(4);
        }

        setIsInteractiveModalOpen(true);
    };

    const toggleQType = (type: string) => {
        setSelectedQTypes(prev => {
            if (prev.includes(type)) {
                if (prev.length === 1) return prev; // Retain at least one
                return prev.filter(t => t !== type);
            } else {
                return [...prev, type];
            }
        });
    };

    // Interactive Slide Submit Handler
    const handleInteractiveModalSubmit = async (e?: React.FormEvent, createEmptyOnly: boolean = false) => {
        if (e) e.preventDefault();
        setIsGeneratingInteractive(true);
        setError(null);
        try {
            if (tempFileKey) {
                api.delete(`/lessons/${lessonId}/pptx/cleanup-temp?fileKey=${tempFileKey}`).catch(() => {});
                setTempFileKey(null);
                setTempFileSize(null);
            }
            if (tempFileKeyNoAudio) {
                api.delete(`/lessons/${lessonId}/pptx/cleanup-temp?fileKey=${tempFileKeyNoAudio}`).catch(() => {});
                setTempFileKeyNoAudio(null);
                setTempFileSizeNoAudio(null);
            }

            let targetSlideIdx: number | null = interactiveTargetSlideIndex;

            if (targetSlideIdx === null) {
                // Case 1: Create a brand new interactive slide
                const createRes = await api.post(`/lessons/${lessonId}/slides`, {
                    title: interactiveModalTitle.trim() || 'Trạm kiểm soát kiến thức',
                    slideType: interactiveActivityType,
                    layoutType: interactiveActivityType === 'interactive_audio' ? 'audio_lab' : 'checkpoint_gate',
                    insertAfterIndex: interactiveModalInsertAfter >= 0 ? interactiveModalInsertAfter : undefined,
                });
                const createdSlide = createRes.data;
                targetSlideIdx = createdSlide?.slideIndex;
            }

            if (!targetSlideIdx) {
                throw new Error('Không thể xác định chỉ số slide');
            }

            // If user uploaded an extra audio file for this slide, upload it immediately
            if (interactiveAudioFile && targetSlideIdx) {
                const audioFormData = new FormData();
                audioFormData.append('audio', interactiveAudioFile);
                await api.post(`/lessons/${lessonId}/slides/${targetSlideIdx}/extra-audio`, audioFormData, {
                    headers: { 'Content-Type': 'multipart/form-data' },
                });
            }

            // Prepare custom content based on source type
            let effectiveCustomContent = interactiveCustomContent.trim();
            if (interactiveSourceType === 'audio' && interactiveAudioFile) {
                effectiveCustomContent = `[Bài tập nghe từ file âm thanh: ${interactiveAudioFile.name}]\n${effectiveCustomContent}`;
            } else if (interactiveSourceType === 'image' && interactiveImageFile) {
                effectiveCustomContent = `[Tài liệu hình ảnh đính kèm: ${interactiveImageFile.name}]\n${effectiveCustomContent}`;
            }

            // If not just creating an empty slide, trigger AI generation
            if (!createEmptyOnly) {
                await api.post(`/lessons/${lessonId}/slides/${targetSlideIdx}/generate-interactions`, {
                    mode: interactiveGenerationMode,
                    activityType: interactiveActivityType,
                    sourceType: interactiveGenerationMode === 'extract_existing'
                        ? (interactiveSourceType === 'image' ? 'image' : 'custom_text')
                        : (interactiveSourceType === 'audio' ? 'custom_text' : (interactiveSourceType === 'image' ? 'custom_text' : interactiveSourceType)),
                    fromSlideIndex: interactiveFromSlide,
                    toSlideIndex: interactiveToSlide,
                    customContent: effectiveCustomContent,
                    imageBase64: interactiveImageBase64 || undefined,
                    selectedQuestionTypes: selectedQTypes,
                    questionCount: interactiveQCount,
                    passScore: interactivePassScore,
                    fallbackSlideIndex: interactiveFallbackSlide,
                    allowContinueWithoutPass: interactiveAllowContinueWithoutPass,
                });
            }

            setIsInteractiveModalOpen(false);
            await loadSavedContent(false);
            await refreshLessonData();
        } catch (err: any) {
            console.error('Failed to configure/generate interactive slide:', err);
            setError(`Không thể tạo bài tập tương tác: ${err.response?.data?.message || err.message}`);
        } finally {
            setIsGeneratingInteractive(false);
        }
    };

    // Add Slide Submit handler
    const handleAddSlideSubmit = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!newSlideTitle.trim()) {
            setError('Vui lòng nhập tiêu đề slide');
            return;
        }

        setIsCreatingSlide(true);
        setError(null);
        try {
            if (tempFileKey) {
                api.delete(`/lessons/${lessonId}/pptx/cleanup-temp?fileKey=${tempFileKey}`).catch(() => {});
                setTempFileKey(null);
                setTempFileSize(null);
            }
            if (tempFileKeyNoAudio) {
                api.delete(`/lessons/${lessonId}/pptx/cleanup-temp?fileKey=${tempFileKeyNoAudio}`).catch(() => {});
                setTempFileKeyNoAudio(null);
                setTempFileSizeNoAudio(null);
            }

            const createRes = await api.post(`/lessons/${lessonId}/slides`, {
                title: newSlideTitle.trim(),
                content: newSlideContent.trim(),
                slideType: newSlideType,
                insertAfterIndex: newSlideInsertAfter >= 0 ? newSlideInsertAfter : undefined,
            });

            const createdSlide = createRes.data;
            const newIndex = createdSlide?.slideIndex;

            setIsAddSlideModalOpen(false);
            setNewSlideTitle('');
            setNewSlideContent('');
            setNewSlideType('content');
            await loadSavedContent(false);
            await refreshLessonData();

            // If user checked auto-generate AI content
            if (autoGenerateAI && newIndex) {
                if (newSlideType === 'checkpoint_quiz') {
                    handleGenerateInteraction(newIndex).catch((err) => {
                        console.warn('Auto AI interaction gen error:', err);
                    });
                } else {
                    handleRegenerateContent(newIndex).catch((err) => {
                        console.warn('Auto AI content gen error:', err);
                    });
                }
            }
        } catch (err: any) {
            console.error('Failed to create slide:', err);
            setError(`Không thể thêm slide mới: ${err.response?.data?.message || err.message}`);
        } finally {
            setIsCreatingSlide(false);
        }
    };

    // Extra Audio Upload Handlers
    const handleTriggerExtraAudioUpload = (slideIndex: number) => {
        targetExtraAudioSlideIndexRef.current = slideIndex;
        setTargetExtraAudioSlideIndex(slideIndex);
        if (extraAudioInputRef.current) {
            extraAudioInputRef.current.value = '';
            extraAudioInputRef.current.click();
        }
    };

    const handleExtraAudioFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        const activeIdx = targetExtraAudioSlideIndexRef.current ?? targetExtraAudioSlideIndex;
        if (!file || activeIdx === null) return;

        if (!file.type.startsWith('audio/') && !file.name.match(/\.(mp3|wav|ogg|m4a|aac)$/i)) {
            setError('Vui lòng chọn file âm thanh hợp lệ (MP3, WAV, M4A, OGG)');
            return;
        }

        setIsUploadingExtraAudio(true);
        setError(null);
        try {
            const formData = new FormData();
            formData.append('audio', file);

            const response = await api.post(
                `/lessons/${lessonId}/slides/${activeIdx}/extra-audio`,
                formData,
                {
                    headers: {
                        'Content-Type': 'multipart/form-data',
                    },
                }
            );

            const updatedSlide = response.data;
            setSlideProgress(prev => prev.map(s =>
                s.slideIndex === activeIdx ? {
                    ...s,
                    extraAudioUrl: updatedSlide.extraAudioUrl,
                    extraAudioName: updatedSlide.extraAudioName,
                    extraAudioDuration: updatedSlide.extraAudioDuration,
                } : s
            ));

            if (tempFileKey) {
                api.delete(`/lessons/${lessonId}/pptx/cleanup-temp?fileKey=${tempFileKey}`).catch(() => {});
                setTempFileKey(null);
                setTempFileSize(null);
            }
            if (tempFileKeyNoAudio) {
                api.delete(`/lessons/${lessonId}/pptx/cleanup-temp?fileKey=${tempFileKeyNoAudio}`).catch(() => {});
                setTempFileKeyNoAudio(null);
                setTempFileSizeNoAudio(null);
            }
        } catch (err: any) {
            console.error('Failed to upload extra audio:', err);
            setError(`Không thể tải lên audio mẫu cho slide ${activeIdx}: ${err.response?.data?.message || err.message}`);
        } finally {
            setIsUploadingExtraAudio(false);
        }
    };

    const handleDeleteExtraAudio = async (slideIndex: number) => {
        if (!window.confirm(`Xóa file audio mẫu của Slide ${slideIndex}?`)) {
            return;
        }

        setError(null);
        try {
            await api.delete(`/lessons/${lessonId}/slides/${slideIndex}/extra-audio`);
            setSlideProgress(prev => prev.map(s =>
                s.slideIndex === slideIndex ? {
                    ...s,
                    extraAudioUrl: null,
                    extraAudioName: null,
                    extraAudioDuration: null,
                } : s
            ));

            if (tempFileKey) {
                api.delete(`/lessons/${lessonId}/pptx/cleanup-temp?fileKey=${tempFileKey}`).catch(() => {});
                setTempFileKey(null);
                setTempFileSize(null);
            }
            if (tempFileKeyNoAudio) {
                api.delete(`/lessons/${lessonId}/pptx/cleanup-temp?fileKey=${tempFileKeyNoAudio}`).catch(() => {});
                setTempFileKeyNoAudio(null);
                setTempFileSizeNoAudio(null);
            }
        } catch (err: any) {
            console.error('Failed to delete extra audio:', err);
            setError(`Không thể xóa audio mẫu của slide ${slideIndex}: ${err.response?.data?.message || err.message}`);
        }
    };

    // Generate interactive activity with AI for a slide
    const handleGenerateInteraction = async (slideIndex: number, requestedType?: string) => {
        setGeneratingInteractionSlideIndex(slideIndex);
        setError(null);
        try {
            const response = await api.post(`/lessons/${lessonId}/slides/${slideIndex}/generate-interactions`, {
                activityType: requestedType,
            });
            const updated = response.data;
            setSlideProgress(prev => prev.map(s =>
                s.slideIndex === slideIndex ? {
                    ...s,
                    slideType: updated.slideType || 'interactive_audio',
                    interactiveData: typeof updated.interactiveData === 'string'
                        ? updated.interactiveData
                        : JSON.stringify(updated.interactiveDataParsed || updated.interactiveData),
                } : s
            ));
            await refreshLessonData();
        } catch (err: any) {
            console.error('Failed to generate interaction:', err);
            setError(`Không thể tạo bài tập tương tác cho slide ${slideIndex}: ${err.response?.data?.message || err.message}`);
        } finally {
            setGeneratingInteractionSlideIndex(null);
        }
    };

    // Delete interactive activity from a slide
    const handleDeleteInteraction = async (slideIndex: number) => {
        setError(null);
        try {
            await api.put(`/lessons/${lessonId}/slides/${slideIndex}/content`, {
                interactiveData: null,
                slideType: 'content',
            });
            setSlideProgress(prev => prev.map(s =>
                s.slideIndex === slideIndex ? {
                    ...s,
                    slideType: 'content',
                    interactiveData: null,
                } : s
            ));
            await refreshLessonData();
        } catch (err: any) {
            console.error('Failed to delete interaction:', err);
            setError(`Không thể xóa bài tập tương tác của slide ${slideIndex}: ${err.response?.data?.message || err.message}`);
        }
    };

    // Handle Layout Change for a slide
    const handleLayoutChange = async (slideIndex: number, newLayout: string) => {
        try {
            await api.put(`/lessons/${lessonId}/slides/${slideIndex}/content`, {
                layoutType: newLayout,
            });
            setSlideProgress(prev => prev.map(s =>
                s.slideIndex === slideIndex ? { ...s, layoutType: newLayout } : s
            ));
        } catch (err: any) {
            console.error('Failed to update slide layout:', err);
            setError(`Không thể cập nhật bố cục cho slide ${slideIndex}: ${err.response?.data?.message || err.message}`);
        }
    };

    // Handle Mastery Gate Configuration Change
    const handleGateConfigChange = async (slideIndex: number, field: 'passScore' | 'fallbackSlideIndex' | 'allowContinueWithoutPass', value: any) => {
        const slide = slideProgress.find(s => s.slideIndex === slideIndex);
        if (!slide || !slide.interactiveData) return;

        let interaction: any;
        try {
            interaction = typeof slide.interactiveData === 'string'
                ? JSON.parse(slide.interactiveData)
                : (slide.interactiveData ? { ...(slide.interactiveData as any) } : {});
        } catch {
            return;
        }

        interaction[field] = value;
        const serialized = JSON.stringify(interaction);

        try {
            await api.put(`/lessons/${lessonId}/slides/${slideIndex}/content`, {
                interactiveData: serialized,
            });
            setSlideProgress(prev => prev.map(s =>
                s.slideIndex === slideIndex ? { ...s, interactiveData: serialized } : s
            ));
        } catch (err: any) {
            console.error('Failed to update gate config:', err);
            setError(`Không thể cập nhật cấu hình chặn bài cho slide ${slideIndex}: ${err.response?.data?.message || err.message}`);
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
                    <div className="template-selector-row">
                        <div className="template-picker-group">
                            <label htmlFor="template-select">🎨 Mẫu giao diện PowerPoint:</label>
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
                        </div>

                        {/* SCORM / H5P Background Option */}
                        <div className="template-picker-group">
                            <label htmlFor="scorm-bg-select">🌐 Giao diện xuất SCORM & H5P:</label>
                            <select
                                id="scorm-bg-select"
                                value={scormH5pBgOption}
                                onChange={(e) => setScormH5pBgOption(e.target.value)}
                                className="template-dropdown"
                                title="Tùy chọn hình nền và nhận diện thương hiệu khi xuất SCORM / H5P"
                            >
                                <option value="tuaf_clean">🌿 Nhận diện TUAF Tối ưu (Khuyên dùng - Logo Player, viền xanh, tối đa diện tích slide)</option>
                                <option value="tuaf_full">🖼️ Áp dụng ảnh nền gốc TUAF (Dùng cả 2 ảnh bìa & nội dung)</option>
                                <option value="minimal">📄 Nền tối giản (Nền phẳng, không ảnh & không logo)</option>
                                <option value="custom">🎨 Đồng bộ theo mẫu PPTX đã chọn ở trên</option>
                            </select>
                        </div>

                        {/* SCORM / H5P Theme Mode */}
                        <div className="template-picker-group">
                            <label htmlFor="scorm-theme-select">🌓 Chủ đề màu sắc (Theme):</label>
                            <select
                                id="scorm-theme-select"
                                value={scormH5pTheme}
                                onChange={(e) => setScormH5pTheme(e.target.value as 'light' | 'dark')}
                                className="template-dropdown"
                                title="Lựa chọn tông màu sáng học thuật (độ tương phản cao) hoặc tông màu tối cho gói xuất"
                            >
                                <option value="light">☀️ Giao diện Sáng (Học thuật TUAF - Khuyên dùng cho LMS & Giảng đường)</option>
                                <option value="dark">🌙 Giao diện Tối (Modern Slate Dark - Tối ưu ban đêm)</option>
                            </select>
                        </div>

                        {/* Template Preview */}
                        {selectedTpl && (
                            <div className="template-preview-small" title="Xem trước ảnh bìa và nội dung của template">
                                {selectedTpl.titleBgUrl && (
                                    <img src={`${API_BASE}${selectedTpl.titleBgUrl}`} alt="Title" title="Ảnh bìa (Title)" />
                                )}
                                {selectedTpl.contentBgUrl && (
                                    <img src={`${API_BASE}${selectedTpl.contentBgUrl}`} alt="Content" title="Ảnh nội dung (Content)" />
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

                            {/* Moodle LMS & E-Learning Export buttons */}
                            <button
                                className="btn-moodle-export btn-scorm"
                                onClick={handleExportScorm}
                                disabled={isJobRunning || isExportingScorm}
                                title="Đóng gói chuẩn SCORM 1.2: Tự động chạy audio, trình chiếu slide, chấm điểm tương tác trên Moodle (Thay thế hoàn toàn iSpring)"
                            >
                                {isExportingScorm ? '⏳ Đang đóng gói...' : '📦 Xuất SCORM (.zip)'}
                            </button>
                            <button
                                className="btn-moodle-export btn-h5p"
                                onClick={handleExportH5p}
                                disabled={isJobRunning || isExportingH5p}
                                title="Đóng gói chuẩn H5P Course Presentation cho Moodle"
                            >
                                {isExportingH5p ? '⏳ Đang xuất...' : '🌟 Xuất H5P (.h5p)'}
                            </button>
                            <button
                                className="btn-moodle-export btn-xml"
                                onClick={handleExportMoodleXml}
                                disabled={isJobRunning || isExportingMoodleXml}
                                title="Xuất ngân hàng câu hỏi tương tác & kiểm tra nhanh vào Ngân hàng câu hỏi Moodle"
                            >
                                {isExportingMoodleXml ? '⏳ Đang xuất...' : '📋 Xuất Moodle Quiz XML'}
                            </button>
                            <button
                                type="button"
                                className="btn-moodle-guide-trigger"
                                onClick={() => setIsMoodleGuideModalOpen(true)}
                                title="Xem hướng dẫn đưa học liệu tương tác vào Moodle"
                            >
                                ❓ Hướng dẫn Moodle
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
            {(hasSlideScript || slideProgress.length > 0) && (
                <div className="slide-preview-section">
                    <div className="slide-preview-header">
                        <h4>📋 Nội dung slides ({slideProgress.length})</h4>
                        <div className="add-slide-btn-group">
                            <button
                                type="button"
                                className="btn-add-slide-theory"
                                onClick={() => openAddSlideModal(-1)}
                                disabled={isJobRunning}
                                title="Thêm slide lý thuyết (Nội dung, gạch đầu dòng, ảnh minh họa)"
                            >
                                📖 + Thêm slide lý thuyết
                            </button>
                            <button
                                type="button"
                                className="btn-add-slide-interactive"
                                onClick={() => openAddInteractiveModal(-1)}
                                disabled={isJobRunning}
                                title="Thêm slide tương tác độc lập (Kiểm tra nhanh hoặc Bài tập nghe hiểu)"
                            >
                                🎯 + Thêm slide tương tác
                            </button>
                        </div>
                    </div>

                    {slideProgress.length === 0 ? (
                        <div className="placeholder" style={{ padding: '24px', textAlign: 'center', background: 'rgba(15, 23, 42, 0.4)', borderRadius: '12px' }}>
                            <p style={{ marginBottom: '16px', color: '#94a3b8' }}>Chưa có slide nào. Thầy cô có thể chọn thêm slide mới hoặc hoàn thành kịch bản ở Bước 3:</p>
                            <div className="add-slide-btn-group" style={{ justifyContent: 'center' }}>
                                <button type="button" className="btn-add-slide-theory" onClick={() => openAddSlideModal(-1)}>
                                    📖 + Thêm slide lý thuyết
                                </button>
                                <button type="button" className="btn-add-slide-interactive" onClick={() => openAddInteractiveModal(-1)}>
                                    🎯 + Thêm slide tương tác
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="slide-preview-grid">
                            {/* Insert divider before Slide 1 */}
                            <div className="slide-insert-divider top" title="Chèn slide vào đầu bài giảng">
                                <div className="slide-insert-btn-pair">
                                    <button
                                        type="button"
                                        className="btn-slide-insert-mini theory"
                                        onClick={() => openAddSlideModal(0)}
                                        disabled={isJobRunning}
                                        title="Chèn slide lý thuyết trước Slide 1"
                                    >
                                        📖 + Lý thuyết
                                    </button>
                                    <button
                                        type="button"
                                        className="btn-slide-insert-mini interactive"
                                        onClick={() => openAddInteractiveModal(0)}
                                        disabled={isJobRunning}
                                        title="Chèn slide tương tác trước Slide 1"
                                    >
                                        🎯 + Tương tác
                                    </button>
                                </div>
                            </div>

                            {slideProgress.map((slide) => {
                                const isEditingThisSlide = editingSlideIndex === slide.slideIndex;
                                const fullImageUrl = slide.imageUrl
                                    ? (slide.imageUrl.startsWith('http') ? slide.imageUrl : `${API_BASE}${slide.imageUrl}`)
                                    : undefined;
                                const fullExtraAudioUrl = slide.extraAudioUrl
                                    ? (slide.extraAudioUrl.startsWith('http') ? slide.extraAudioUrl : `${API_BASE}${slide.extraAudioUrl}`)
                                    : undefined;

                                return (
                                    <div key={slide.slideIndex} className="slide-item-wrapper">
                                        <div
                                            className={`slide-card ${slide.phase} ${slide.isRegenerating ? 'regenerating' : ''} ${isEditingThisSlide ? 'editing' : ''}`}
                                        >
                                            <div className="slide-card-header">
                                                <div className="slide-header-left">
                                                    <span className="slide-number">Slide {slide.slideIndex}</span>
                                                    {slide.slideType === 'interactive_audio' ? (
                                                        <span className="slide-type-badge badge-audio-interactive" title="Slide có âm thanh mẫu và bài tập tương tác">
                                                            🎧 Nghe & Tương tác
                                                        </span>
                                                    ) : slide.slideType === 'checkpoint_quiz' ? (
                                                        <span className="slide-type-badge badge-quiz-interactive" title="Slide câu hỏi củng cố kiến thức">
                                                            🧩 Kiểm tra nhanh
                                                        </span>
                                                    ) : (
                                                        <span className="slide-type-badge badge-content" title="Slide học lý thuyết">
                                                            📘 Lý thuyết
                                                        </span>
                                                    )}

                                                    {/* Layout Selector Dropdown */}
                                                    <div className="slide-layout-selector-wrapper">
                                                        <select
                                                            className="slide-layout-select"
                                                            value={slide.layoutType || 'split_standard'}
                                                            onChange={(e) => handleLayoutChange(slide.slideIndex, e.target.value)}
                                                            title="Chọn bố cục hiển thị cho slide này"
                                                            disabled={isJobRunning}
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

                                                    {isEditingThisSlide ? (
                                                        <span className="slide-title-edit-badge">✏️ Đang chỉnh sửa nội dung</span>
                                                    ) : (
                                                        <span className="slide-title" title={slide.title}>{slide.title || '(Chưa có tiêu đề)'}</span>
                                                    )}
                                                </div>
                                                <div className="slide-header-actions">
                                                    <button
                                                        type="button"
                                                        className="btn-header-action btn-header-move"
                                                        onClick={() => handleMoveSlide(slide.slideIndex, 'up')}
                                                        disabled={slide.slideIndex === 1 || isJobRunning || isMovingSlide}
                                                        title={slide.slideIndex === 1 ? 'Đã ở vị trí đầu tiên' : 'Di chuyển slide lên trên'}
                                                    >
                                                        ⬆️
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="btn-header-action btn-header-move"
                                                        onClick={() => handleMoveSlide(slide.slideIndex, 'down')}
                                                        disabled={slide.slideIndex === slideProgress.length || isJobRunning || isMovingSlide}
                                                        title={slide.slideIndex === slideProgress.length ? 'Đã ở vị trí cuối cùng' : 'Di chuyển slide xuống dưới'}
                                                    >
                                                        ⬇️
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="btn-header-action btn-header-delete"
                                                        onClick={() => handleDeleteSlide(slide.slideIndex)}
                                                        disabled={slideProgress.length <= 1 || isJobRunning || isDeletingSlide}
                                                        title={slideProgress.length <= 1 ? 'Không thể xóa slide duy nhất' : 'Xóa slide này'}
                                                    >
                                                        🗑️
                                                    </button>
                                                    <span className="slide-status">
                                                        {slide.phase === 'pending' && '⏳'}
                                                        {slide.phase === 'optimizing_content' && '📝'}
                                                        {slide.phase === 'generating_image' && '🖼️'}
                                                        {slide.phase === 'complete' && '✅'}
                                                        {slide.phase === 'error' && '❌'}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Standalone Interactive Slide or Standard Theory Slide */}
                                            {(() => {
                                                const isInteractiveSlide = slide.slideType === 'checkpoint_quiz' || slide.slideType === 'interactive_audio' || slide.layoutType === 'checkpoint_gate' || slide.layoutType === 'audio_lab' || !!slide.interactiveData;

                                                if (isInteractiveSlide) {
                                                    let interaction: any = null;
                                                    if (slide.interactiveData) {
                                                        try {
                                                            interaction = typeof slide.interactiveData === 'string'
                                                                ? JSON.parse(slide.interactiveData)
                                                                : slide.interactiveData;
                                                        } catch {
                                                            interaction = null;
                                                        }
                                                    }
                                                    const questions: any[] = interaction && Array.isArray(interaction.questions) ? interaction.questions : [];

                                                    return (
                                                        <div className="slide-interactive-standalone-container">
                                                            {/* Extra Audio Bar if slide has sample audio */}
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
                                                                        <audio
                                                                            controls
                                                                            src={fullExtraAudioUrl}
                                                                            className="extra-audio-player"
                                                                            preload="none"
                                                                        />
                                                                        <button
                                                                            type="button"
                                                                            className="btn-extra-audio-change"
                                                                            onClick={() => handleTriggerExtraAudioUpload(slide.slideIndex)}
                                                                            disabled={isJobRunning || isUploadingExtraAudio}
                                                                            title="Thay thế bằng file audio mẫu khác"
                                                                        >
                                                                            🔄 Đổi file
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            className="btn-extra-audio-delete"
                                                                            onClick={() => handleDeleteExtraAudio(slide.slideIndex)}
                                                                            disabled={isJobRunning || isUploadingExtraAudio}
                                                                            title="Xóa file audio mẫu"
                                                                        >
                                                                            🗑️ Xóa
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {/* Content: Either full interactive questions workspace OR friendly empty state */}
                                                            {interaction ? (
                                                                <div className="slide-interactive-preview-box">
                                                                    <div className="interactive-preview-header">
                                                                        <div className="interactive-header-title">
                                                                            <span className="interactive-icon">
                                                                                {slide.slideType === 'interactive_audio' ? '🎧' : '🎯'}
                                                                            </span>
                                                                            <strong>{interaction.badgeLabel || (slide.slideType === 'interactive_audio' ? 'Hoạt động Nghe & Tương tác' : 'Trạm Kiểm Soát Kiến Thức')}</strong>
                                                                            <span className="interactive-count-pill">{questions.length} câu hỏi</span>
                                                                        </div>
                                                                        <div className="interactive-header-actions">
                                                                            <button
                                                                                type="button"
                                                                                className="btn-text-reconfig"
                                                                                onClick={() => openConfigureExistingInteractiveModal(slide)}
                                                                                title="Cấu hình lại nguồn kiến thức & dạng câu hỏi bằng AI"
                                                                            >
                                                                                ✨ Cấu hình / Tạo lại (AI)
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                className="btn-text-danger"
                                                                                onClick={() => handleDeleteInteraction(slide.slideIndex)}
                                                                                title="Xóa bài tập tương tác trên slide này"
                                                                            >
                                                                                🗑️ Xóa bài tập
                                                                            </button>
                                                                        </div>
                                                                    </div>

                                                                    {interaction.instruction && (
                                                                        <p className="interactive-instruction">💡 <em>{interaction.instruction}</em></p>
                                                                    )}

                                                                    {/* Mastery Gate Configuration (for Checkpoints) */}
                                                                    {(slide.layoutType === 'checkpoint_gate' || slide.slideType === 'checkpoint_quiz' || interaction.isCheckpoint) && (
                                                                        <div className="gate-config-card">
                                                                            <div className="gate-config-header">
                                                                                <span>🎯</span>
                                                                                <strong>Cấu hình Kiểm tra & Chuyển tiếp (Mastery Gate):</strong>
                                                                            </div>
                                                                            <div className="gate-policy-selector">
                                                                                <label className="gate-policy-title">Chính sách qua bài:</label>
                                                                                <div className="gate-policy-pills">
                                                                                    <button
                                                                                        type="button"
                                                                                        className={`gate-policy-pill ${!interaction.allowContinueWithoutPass ? 'active' : ''}`}
                                                                                        onClick={() => handleGateConfigChange(slide.slideIndex, 'allowContinueWithoutPass', false)}
                                                                                        disabled={isJobRunning}
                                                                                        title="Bắt buộc phải đạt số câu đúng tối thiểu mới mở nút đi tiếp. Trượt sẽ tự động quay về slide ôn tập."
                                                                                    >
                                                                                        🔒 Bắt buộc đạt chuẩn (Chặn bài)
                                                                                    </button>
                                                                                    <button
                                                                                        type="button"
                                                                                        className={`gate-policy-pill ${interaction.allowContinueWithoutPass ? 'active' : ''}`}
                                                                                        onClick={() => handleGateConfigChange(slide.slideIndex, 'allowContinueWithoutPass', true)}
                                                                                        disabled={isJobRunning}
                                                                                        title="Cho phép sinh viên bấm chuyển slide tiếp kể cả khi chưa đạt điểm chuẩn (dành cho khảo sát, luyện tập tự do, trình bày quan điểm)."
                                                                                    >
                                                                                        🔓 Cho phép qua slide kể cả chưa đạt
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                            <div className="gate-config-grid">
                                                                                <div className="gate-config-item">
                                                                                    <label>Điểm đạt tối thiểu (số câu đúng):</label>
                                                                                    <input
                                                                                        type="number"
                                                                                        className="gate-config-input"
                                                                                        min={1}
                                                                                        max={questions.length || 5}
                                                                                        value={interaction.passScore !== undefined ? interaction.passScore : Math.max(1, Math.min(questions.length || 5, 4))}
                                                                                        onChange={(e) => handleGateConfigChange(slide.slideIndex, 'passScore', parseInt(e.target.value, 10) || 1)}
                                                                                        disabled={isJobRunning}
                                                                                    />
                                                                                </div>
                                                                                <div className={`gate-config-item ${interaction.allowContinueWithoutPass ? 'item-disabled' : ''}`}>
                                                                                    <label>
                                                                                        Slide quay về khi trượt:
                                                                                        {interaction.allowContinueWithoutPass && <span className="label-note"> (Không áp dụng)</span>}
                                                                                    </label>
                                                                                    <select
                                                                                        className="gate-config-select"
                                                                                        value={interaction.fallbackSlideIndex || Math.max(1, slide.slideIndex - 1)}
                                                                                        onChange={(e) => handleGateConfigChange(slide.slideIndex, 'fallbackSlideIndex', parseInt(e.target.value, 10))}
                                                                                        disabled={isJobRunning || !!interaction.allowContinueWithoutPass}
                                                                                    >
                                                                                        {slideProgress
                                                                                            .filter(s => s.slideIndex < slide.slideIndex)
                                                                                            .map(s => (
                                                                                                <option key={s.slideIndex} value={s.slideIndex}>
                                                                                                    Slide {s.slideIndex}: {s.title || '(Chưa có tiêu đề)'}
                                                                                                </option>
                                                                                            ))}
                                                                                        {slide.slideIndex === 1 && (
                                                                                            <option value={1}>Slide 1 (Chính slide này)</option>
                                                                                        )}
                                                                                    </select>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    )}

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
                                                                                            {qType === 'MR' ? '☑ Chọn nhiều' : qType === 'TF' ? '⚖️ Đúng / Sai' : qType === 'FIB' ? '✏️ Điền khuyết' : qType === 'MATCH' ? '🔗 Nối cặp' : qType === 'ORDER' ? '🔤 Sắp xếp từ' : qType === 'CLOZE' ? '💬 Điền khuyết hội thoại' : '🔘 Chọn 1'}
                                                                                        </span>
                                                                                    </div>

                                                                                    {/* Multiple Choice / True-False / Multiple Response */}
                                                                                    {Array.isArray(q.options) && q.options.length > 0 && (
                                                                                        <div className="interactive-q-options">
                                                                                            {q.options.map((opt: string, optIdx: number) => {
                                                                                                const cleanOpt = opt.trim().toLowerCase();
                                                                                                const isCorrect = correctAnswersList.some(ca => (ca || '').trim().toLowerCase() === cleanOpt);
                                                                                                return (
                                                                                                    <div key={optIdx} className={`interactive-opt ${isCorrect ? 'opt-correct' : ''}`}>
                                                                                                        <span className="opt-marker">
                                                                                                            {isCorrect ? (qType === 'MR' ? '☑' : '✅') : (qType === 'MR' ? '☐' : '⚪')}
                                                                                                        </span>
                                                                                                        <span className="opt-text">{opt}</span>
                                                                                                    </div>
                                                                                                );
                                                                                            })}
                                                                                        </div>
                                                                                    )}

                                                                                    {/* Fill-in-the-blank display */}
                                                                                    {qType === 'FIB' && (
                                                                                        <div className="fib-answer-display">
                                                                                            <strong>Đáp án điền khuyết:</strong> <code>{q.correctAnswer || (q.correctAnswers ? q.correctAnswers.join(' / ') : '')}</code>
                                                                                        </div>
                                                                                    )}

                                                                                    {/* Matching Pairs display */}
                                                                                    {qType === 'MATCH' && Array.isArray(q.matchingPairs) && q.matchingPairs.length > 0 && (
                                                                                        <div className="interactive-match-pairs-preview">
                                                                                            <div className="match-pairs-preview-title">🔗 Các cặp tương ứng đúng:</div>
                                                                                            <div className="match-pairs-preview-grid">
                                                                                                {q.matchingPairs.map((pair: any, pIdx: number) => (
                                                                                                    <div key={pIdx} className="match-pair-preview-item">
                                                                                                        <span className="pair-left">📌 {pair.left}</span>
                                                                                                        <span className="pair-arrow">➔</span>
                                                                                                        <span className="pair-right">🎯 {pair.right}</span>
                                                                                                    </div>
                                                                                                ))}
                                                                                            </div>
                                                                                        </div>
                                                                                    )}

                                                                                    {/* Order words display */}
                                                                                    {qType === 'ORDER' && (
                                                                                        <div className="order-words-display" style={{ marginTop: 8, padding: '10px 14px', background: 'rgba(6, 182, 212, 0.08)', borderRadius: 8, border: '1px solid rgba(6, 182, 212, 0.25)' }}>
                                                                                            <div style={{ fontSize: '0.85rem', color: '#0891b2', fontWeight: 600, marginBottom: 6 }}>
                                                                                                🔤 Câu sắp xếp đúng: <code>{q.correctSentence || (Array.isArray(q.words) ? q.words.join(' ') : '')}</code>
                                                                                            </div>
                                                                                            {Array.isArray(q.words) && q.words.length > 0 && (
                                                                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                                                                                                    <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Các từ thành phần:</span>
                                                                                                    {q.words.map((w: string, wIdx: number) => (
                                                                                                        <span key={wIdx} style={{ background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: 12, fontSize: '0.8rem', fontWeight: 600 }}>{w}</span>
                                                                                                    ))}
                                                                                                </div>
                                                                                            )}
                                                                                        </div>
                                                                                    )}

                                                                                    {/* Cloze passage display */}
                                                                                    {qType === 'CLOZE' && (
                                                                                        <div className="cloze-passage-display" style={{ marginTop: 8, padding: '12px 14px', background: 'rgba(217, 70, 239, 0.06)', borderRadius: 8, border: '1px solid rgba(217, 70, 239, 0.25)' }}>
                                                                                            <div style={{ fontSize: '0.85rem', color: '#a21caf', fontWeight: 600, marginBottom: 6 }}>
                                                                                                💬 Đoạn hội thoại / ngữ cảnh điền khuyết:
                                                                                            </div>
                                                                                            <div style={{ whiteSpace: 'pre-line', fontSize: '0.9rem', color: '#334155', lineHeight: 1.8, fontStyle: 'italic', background: '#f8fafc', padding: '8px 12px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                                                                                                {q.passage || q.questionText || ''}
                                                                                            </div>
                                                                                        </div>
                                                                                    )}

                                                                                    {q.explanation && (
                                                                                        <div className="interactive-q-explanation">
                                                                                            <strong>Vì sao đúng:</strong> {q.explanation}
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                /* Clean, dedicated empty state for interactive slide */
                                                                <div className="slide-interactive-empty-state">
                                                                    <div className="empty-interactive-icon">
                                                                        {slide.slideType === 'interactive_audio' ? '🎧' : '🎯'}
                                                                    </div>
                                                                    <div className="empty-interactive-text">
                                                                        <h5>{slide.slideType === 'interactive_audio' ? 'Slide Bài Tập Nghe Hiểu (Độc lập)' : 'Slide Kiểm Tra Kiến Thức Độc Lập'}</h5>
                                                                        <p>Slide này hoạt động độc lập (không cần nội dung chữ và hình ảnh thông thường). Hãy bấm nút dưới đây để chọn dạng câu hỏi và tạo bộ bài tập bằng AI.</p>
                                                                    </div>
                                                                    <div className="empty-interactive-actions">
                                                                        <button
                                                                            type="button"
                                                                            className="btn-empty-interactive-ai"
                                                                            onClick={() => openConfigureExistingInteractiveModal(slide)}
                                                                            disabled={slide.isRegenerating || generatingInteractionSlideIndex === slide.slideIndex}
                                                                        >
                                                                            ✨ Tạo câu hỏi bằng AI (Chọn dạng & nguồn)
                                                                        </button>
                                                                        {slide.slideType === 'interactive_audio' && !slide.extraAudioUrl && (
                                                                            <button
                                                                                type="button"
                                                                                className="btn-small btn-action-audio"
                                                                                onClick={() => handleTriggerExtraAudioUpload(slide.slideIndex)}
                                                                                disabled={slide.isRegenerating || isUploadingExtraAudio}
                                                                            >
                                                                                🎧 Tải audio mẫu
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                }

                                                // Regular Theory Slide: 2-column layout (content + image)
                                                return (
                                                    <>
                                                        <div className={`slide-card-body layout-${slide.layoutType || 'split_standard'}`}>
                                                            {/* Content side */}
                                                            <div className="slide-content-col">
                                                                {isEditingThisSlide ? (
                                                                    <div className="slide-inline-edit-container">
                                                                        <div className="inline-edit-field">
                                                                            <label>📌 Tiêu đề Slide:</label>
                                                                            <input
                                                                                type="text"
                                                                                className="inline-input-title"
                                                                                value={editTitle}
                                                                                onChange={(e) => setEditTitle(e.target.value)}
                                                                                placeholder="Nhập tiêu đề slide..."
                                                                            />
                                                                        </div>

                                                                        <div className="inline-edit-field">
                                                                            <label>📝 Ý chính / Ghi chú nội dung (AI sẽ dựa vào đây để tạo slide):</label>
                                                                            <textarea
                                                                                rows={3}
                                                                                className="inline-input-desc"
                                                                                value={editRawContent}
                                                                                onChange={(e) => setEditRawContent(e.target.value)}
                                                                                placeholder="Nhập các ý chính hoặc nội dung thô (có thể để trống để AI tự biên soạn theo tiêu đề)..."
                                                                            />
                                                                        </div>

                                                                        <div className="inline-edit-bullets-section">
                                                                            <label>📋 Các ý hiển thị trên slide (bullet points):</label>
                                                                            {editBullets.map((b, idx) => (
                                                                                <div key={idx} className="inline-bullet-row">
                                                                                    <input
                                                                                        type="text"
                                                                                        className="inline-input-emoji"
                                                                                        value={b.emoji}
                                                                                        onChange={(e) => handleBulletChange(idx, 'emoji', e.target.value)}
                                                                                        title="Icon / Emoji"
                                                                                        maxLength={4}
                                                                                    />
                                                                                    <div className="inline-bullet-fields">
                                                                                        <input
                                                                                            type="text"
                                                                                            className="inline-input-point"
                                                                                            value={b.point}
                                                                                            onChange={(e) => handleBulletChange(idx, 'point', e.target.value)}
                                                                                            placeholder="Ý chính..."
                                                                                        />
                                                                                        <textarea
                                                                                            rows={2}
                                                                                            className="inline-input-desc"
                                                                                            value={b.description}
                                                                                            onChange={(e) => handleBulletChange(idx, 'description', e.target.value)}
                                                                                            placeholder="Mô tả / giải thích chi tiết..."
                                                                                        />
                                                                                    </div>
                                                                                    <button
                                                                                        type="button"
                                                                                        className="btn-inline-delete"
                                                                                        onClick={() => handleRemoveBullet(idx)}
                                                                                        title="Xóa ý này"
                                                                                    >
                                                                                        🗑️
                                                                                    </button>
                                                                                </div>
                                                                            ))}

                                                                            <button
                                                                                type="button"
                                                                                className="btn-inline-add-bullet"
                                                                                onClick={handleAddBullet}
                                                                            >
                                                                                ➕ Thêm ý mới
                                                                            </button>
                                                                        </div>

                                                                        <div className="inline-edit-bottom-actions">
                                                                            <button
                                                                                type="button"
                                                                                className="btn-save-inline"
                                                                                onClick={() => handleSaveEditContent(slide.slideIndex, false)}
                                                                                disabled={isSavingContent}
                                                                            >
                                                                                {isSavingContent ? '⏳ Đang lưu...' : '💾 Lưu'}
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                className="btn-save-inline btn-highlight-ai"
                                                                                onClick={() => handleSaveEditContent(slide.slideIndex, true)}
                                                                                disabled={isSavingContent}
                                                                                title="Lưu ý chính và tự động dùng AI tạo lại bullet points tối ưu"
                                                                            >
                                                                                ✨ Lưu & AI tạo nội dung
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                className="btn-cancel-inline"
                                                                                onClick={handleCancelEditContent}
                                                                                disabled={isSavingContent}
                                                                            >
                                                                                ❌ Hủy
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                ) : (
                                                                    slide.optimizedContent && slide.optimizedContent.length > 0 ? (
                                                                        <div className="optimized-content-wrapper">
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
                                                                        </div>
                                                                    ) : slide.content ? (
                                                                        <div className="slide-raw-content-box">
                                                                            <div className="raw-content-header">
                                                                                <span className="raw-content-label">📝 Ý chính từ giáo viên:</span>
                                                                                <button
                                                                                    type="button"
                                                                                    className="btn-quick-ai"
                                                                                    onClick={() => handleRegenerateContent(slide.slideIndex)}
                                                                                    disabled={slide.isRegenerating || isJobRunning}
                                                                                    title="Dùng AI phân tích ý chính và tạo danh sách bullet points đẹp mắt"
                                                                                >
                                                                                    ✨ AI tạo nội dung slide
                                                                                </button>
                                                                            </div>
                                                                            <p className="raw-content-text">{slide.content}</p>
                                                                        </div>
                                                                    ) : (
                                                                        <div className="placeholder-content-box">
                                                                            <p className="placeholder">Slide này chưa có nội dung chi tiết.</p>
                                                                            <div className="placeholder-actions">
                                                                                <button
                                                                                    type="button"
                                                                                    className="btn-small btn-action-edit"
                                                                                    onClick={() => handleStartEditContent(slide)}
                                                                                    title="Nhập các ý chính cho slide"
                                                                                >
                                                                                    ✏️ Bổ sung ý chính
                                                                                </button>
                                                                                <button
                                                                                    type="button"
                                                                                    className="btn-small btn-highlight-ai"
                                                                                    onClick={() => handleRegenerateContent(slide.slideIndex)}
                                                                                    disabled={slide.isRegenerating || isJobRunning}
                                                                                    title="Dùng AI tự biên soạn nội dung dựa theo tiêu đề slide"
                                                                                >
                                                                                    ✨ AI tạo theo tiêu đề
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    )
                                                                )}
                                                            </div>

                                                            {/* Image side */}
                                                            <div className="slide-image-col">
                                                                <div className="slide-image-wrapper">
                                                                    {fullImageUrl ? (
                                                                        <img src={fullImageUrl} alt={`Slide ${slide.slideIndex}`} />
                                                                    ) : (
                                                                        <div className="image-placeholder">🖼️</div>
                                                                    )}

                                                                    {/* Overlay button on image hover */}
                                                                    {!isJobRunning && (
                                                                        <button
                                                                            type="button"
                                                                            className="btn-image-overlay-upload"
                                                                            onClick={() => handleTriggerUpload(slide.slideIndex)}
                                                                            title="Tải ảnh mới từ máy tính (tự động căn chỉnh & resize 1:1)"
                                                                        >
                                                                            📤 Đổi ảnh
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Extra Audio Bar for Theory slide if any */}
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
                                                                        className="btn-extra-audio-change"
                                                                        onClick={() => handleTriggerExtraAudioUpload(slide.slideIndex)}
                                                                        disabled={isJobRunning || isUploadingExtraAudio}
                                                                        title="Thay thế bằng file audio mẫu khác"
                                                                    >
                                                                        🔄 Đổi file
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        className="btn-extra-audio-delete"
                                                                        onClick={() => handleDeleteExtraAudio(slide.slideIndex)}
                                                                        disabled={isJobRunning || isUploadingExtraAudio}
                                                                        title="Xóa file audio mẫu"
                                                                    >
                                                                        🗑️ Xóa
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </>
                                                );
                                            })()}

                                            {/* Action buttons */}
                                            {!isEditingThisSlide && !isJobRunning && (
                                                <div className="slide-card-actions">
                                                    {(() => {
                                                        const isInteractiveSlide = slide.slideType === 'checkpoint_quiz' || slide.slideType === 'interactive_audio' || slide.layoutType === 'checkpoint_gate' || slide.layoutType === 'audio_lab' || !!slide.interactiveData;

                                                        if (isInteractiveSlide) {
                                                            return (
                                                                <>
                                                                    <button
                                                                        type="button"
                                                                        className="btn-small btn-action-interactive-active"
                                                                        onClick={() => openConfigureExistingInteractiveModal(slide)}
                                                                        disabled={slide.isRegenerating || generatingInteractionSlideIndex === slide.slideIndex}
                                                                        title="Cấu hình dạng câu hỏi, nguồn tài liệu & tạo câu hỏi bằng AI"
                                                                    >
                                                                        {slide.interactiveData ? '🔄 Cấu hình & Đổi câu hỏi (AI)' : '✨ AI tạo câu hỏi'}
                                                                    </button>
                                                                    {slide.slideType === 'interactive_audio' && !slide.extraAudioUrl && (
                                                                        <button
                                                                            type="button"
                                                                            className="btn-small btn-action-audio"
                                                                            onClick={() => handleTriggerExtraAudioUpload(slide.slideIndex)}
                                                                            disabled={slide.isRegenerating || isUploadingExtraAudio}
                                                                            title="Tải file audio mẫu bài nghe"
                                                                        >
                                                                            🎧 Tải audio mẫu
                                                                        </button>
                                                                    )}
                                                                    {slide.interactiveData && (
                                                                        <button
                                                                            type="button"
                                                                            className="btn-small btn-text-danger"
                                                                            onClick={() => handleDeleteInteraction(slide.slideIndex)}
                                                                            disabled={slide.isRegenerating}
                                                                            title="Xóa bài tập tương tác trên slide này"
                                                                        >
                                                                            🗑️ Xóa bài tập
                                                                        </button>
                                                                    )}
                                                                </>
                                                            );
                                                        }

                                                        // Regular theory slide actions
                                                        return (
                                                            <>
                                                                <button
                                                                    className="btn-small btn-action-edit"
                                                                    onClick={() => handleStartEditContent(slide)}
                                                                    disabled={slide.isRegenerating}
                                                                    title="Chỉnh sửa trực tiếp tiêu đề, ý chính và các ý trong slide"
                                                                >
                                                                    ✏️ Sửa nội dung
                                                                </button>
                                                                <button
                                                                    className="btn-small btn-action-upload"
                                                                    onClick={() => handleTriggerUpload(slide.slideIndex)}
                                                                    disabled={slide.isRegenerating}
                                                                    title="Tải ảnh từ máy tính (tự động căn chỉnh & resize 1:1)"
                                                                >
                                                                    📤 Đổi ảnh
                                                                </button>
                                                                {!slide.extraAudioUrl && (
                                                                    <button
                                                                        className="btn-small btn-action-audio"
                                                                        onClick={() => handleTriggerExtraAudioUpload(slide.slideIndex)}
                                                                        disabled={slide.isRegenerating || isUploadingExtraAudio}
                                                                        title="Tải audio mẫu bài giảng"
                                                                    >
                                                                        🎧 Tải audio mẫu
                                                                    </button>
                                                                )}
                                                                <button
                                                                    className={`btn-small ${!slide.optimizedContent || slide.optimizedContent.length === 0 ? 'btn-highlight-ai' : ''}`}
                                                                    onClick={() => handleRegenerateContent(slide.slideIndex)}
                                                                    disabled={slide.isRegenerating}
                                                                    title="Dùng AI phân tích ý chính hoặc tiêu đề để tạo/viết lại nội dung slide"
                                                                >
                                                                    {!slide.optimizedContent || slide.optimizedContent.length === 0 ? '✨ AI tạo nội dung' : '🔄 Tạo lại nội dung'}
                                                                </button>
                                                                <button
                                                                    className="btn-small"
                                                                    onClick={() => handleRegenerateImage(slide.slideIndex)}
                                                                    disabled={slide.isRegenerating}
                                                                    title="Dùng AI tạo lại hình ảnh slide này"
                                                                >
                                                                    🖼️ Tạo lại ảnh
                                                                </button>
                                                            </>
                                                        );
                                                    })()}
                                                </div>
                                            )}
                                        </div>

                                        {/* Insert divider after this slide with 2 buttons */}
                                        <div
                                            className="slide-insert-divider"
                                            title={`Chèn slide mới vào sau Slide ${slide.slideIndex}`}
                                        >
                                            <div className="slide-insert-btn-pair">
                                                <button
                                                    type="button"
                                                    className="btn-slide-insert-mini theory"
                                                    onClick={() => openAddSlideModal(slide.slideIndex)}
                                                    disabled={isJobRunning}
                                                    title={`Chèn slide lý thuyết sau Slide ${slide.slideIndex}`}
                                                >
                                                    📖 + Lý thuyết
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn-slide-insert-mini interactive"
                                                    onClick={() => openAddInteractiveModal(slide.slideIndex)}
                                                    disabled={isJobRunning}
                                                    title={`Chèn slide tương tác sau Slide ${slide.slideIndex}`}
                                                >
                                                    🎯 + Tương tác
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {slideProgress.length > 0 && (
                        <div className="add-slide-bottom-bar">
                            <div className="add-slide-btn-group">
                                <button
                                    type="button"
                                    className="btn-add-slide-theory"
                                    onClick={() => openAddSlideModal(-1)}
                                    disabled={isJobRunning}
                                    title="Thêm slide lý thuyết vào cuối bài giảng"
                                >
                                    📖 + Thêm slide lý thuyết
                                </button>
                                <button
                                    type="button"
                                    className="btn-add-slide-interactive"
                                    onClick={() => openAddInteractiveModal(-1)}
                                    disabled={isJobRunning}
                                    title="Thêm slide tương tác vào cuối bài giảng"
                                >
                                    🎯 + Thêm slide tương tác
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Hidden file input for custom image upload */}
            <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                accept="image/*"
                onChange={handleFileSelect}
            />

            {/* Hidden file input for extra audio upload */}
            <input
                type="file"
                ref={extraAudioInputRef}
                style={{ display: 'none' }}
                accept="audio/*"
                onChange={handleExtraAudioFileSelect}
            />

            {/* Image Crop & Resize Modal */}
            <ImageCropModal
                isOpen={cropModalOpen}
                imageSrc={cropImageSrc}
                slideIndex={cropSlideIndex || 1}
                onClose={() => {
                    setCropModalOpen(false);
                    setCropImageSrc('');
                    setCropSlideIndex(null);
                }}
                onCropComplete={handleCropComplete}
                isUploading={isUploadingImage}
            />

            {/* Add Slide Modal */}
            {isAddSlideModalOpen && (
                <div className="add-slide-modal-overlay" onClick={() => setIsAddSlideModalOpen(false)}>
                    <div className="add-slide-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="add-slide-modal-header">
                            <h3>➕ Thêm slide mới</h3>
                            <button
                                type="button"
                                className="add-slide-modal-close"
                                onClick={() => setIsAddSlideModalOpen(false)}
                            >
                                ✕
                            </button>
                        </div>
                        <form onSubmit={handleAddSlideSubmit}>
                            <div className="add-slide-modal-body">
                                <div className="add-slide-form-group">
                                    <label>📌 Tiêu đề Slide <span style={{ color: '#ef4444' }}>*</span></label>
                                    <input
                                        type="text"
                                        className="add-slide-input"
                                        value={newSlideTitle}
                                        onChange={(e) => setNewSlideTitle(e.target.value)}
                                        placeholder="Nhập tiêu đề slide..."
                                        autoFocus
                                        required
                                    />
                                </div>
                                <div className="add-slide-form-group">
                                    <label>🏷️ Loại slide</label>
                                    <select
                                        className="add-slide-select"
                                        value={newSlideType}
                                        onChange={(e) => setNewSlideType(e.target.value)}
                                    >
                                        <option value="content">📘 Slide học lý thuyết (Nội dung + hình ảnh + lời giảng)</option>
                                        <option value="interactive_audio">🎧 Slide nghe & tương tác (Có âm thanh mẫu / bài tập nghe)</option>
                                        <option value="checkpoint_quiz">🧩 Slide kiểm tra nhanh (Checkpoint Quiz củng cố kiến thức)</option>
                                    </select>
                                    <div className="add-slide-type-tip">
                                        {newSlideType === 'content' && (
                                            <span>💡 <b>Slide lý thuyết:</b> Slide trình bày kiến thức với các gạch đầu dòng, ảnh minh họa và lời giảng thuyết minh.</span>
                                        )}
                                        {newSlideType === 'interactive_audio' && (
                                            <span>💡 <b>Slide nghe & tương tác:</b> Dành cho môn Ngoại ngữ hoặc bài thực hành âm thanh. Sau khi thêm slide, thầy cô nhấn <b>"🎧 Tải audio mẫu"</b> rồi nhấn <b>"✨ AI tạo bài tập"</b> để tự động sinh bài tập nghe hiểu.</span>
                                        )}
                                        {newSlideType === 'checkpoint_quiz' && (
                                            <span>💡 <b>Slide kiểm tra nhanh:</b> Dành cho câu hỏi củng cố giữa bài. Hệ thống sẽ phân tích các slide lý thuyết trước đó để tạo câu hỏi trắc nghiệm kiểm tra mức độ hiểu bài.</span>
                                        )}
                                    </div>
                                </div>
                                <div className="add-slide-form-group">
                                    <label>📍 Vị trí chèn slide</label>
                                    <select
                                        className="add-slide-select"
                                        value={newSlideInsertAfter}
                                        onChange={(e) => setNewSlideInsertAfter(parseInt(e.target.value, 10))}
                                    >
                                        <option value={-1}>Thêm vào cuối cùng (Slide {slideProgress.length + 1})</option>
                                        <option value={0}>Chèn vào đầu tiên (Trước Slide 1)</option>
                                        {slideProgress.map((s) => (
                                            <option key={s.slideIndex} value={s.slideIndex}>
                                                Sau Slide {s.slideIndex}: {s.title || `Slide ${s.slideIndex}`}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="add-slide-form-group">
                                    <label>📝 Tóm tắt nội dung slide (tùy chọn)</label>
                                    <textarea
                                        rows={3}
                                        className="add-slide-textarea"
                                        value={newSlideContent}
                                        onChange={(e) => setNewSlideContent(e.target.value)}
                                        placeholder="Nhập các ý chính hoặc nội dung thô (AI có thể phân tích để viết slide)..."
                                    />
                                </div>
                                <div className="add-slide-form-group">
                                    <label className="add-slide-checkbox-label">
                                        <input
                                            type="checkbox"
                                            checked={autoGenerateAI}
                                            onChange={(e) => setAutoGenerateAI(e.target.checked)}
                                        />
                                        <span>✨ Tự động dùng AI tạo nội dung tối ưu ngay sau khi thêm</span>
                                    </label>
                                </div>
                            </div>
                            <div className="add-slide-modal-footer">
                                <button
                                    type="button"
                                    className="btn-secondary"
                                    onClick={() => setIsAddSlideModalOpen(false)}
                                    disabled={isCreatingSlide}
                                >
                                    Hủy
                                </button>
                                <button
                                    type="submit"
                                    className="btn-primary"
                                    disabled={isCreatingSlide || !newSlideTitle.trim()}
                                >
                                    {isCreatingSlide ? '⏳ Đang tạo...' : '➕ Tạo slide'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Interactive Question & Slide Configuration Modal */}
            {isInteractiveModalOpen && (
                <div className="add-slide-modal-overlay" onClick={() => !isGeneratingInteractive && setIsInteractiveModalOpen(false)}>
                    <div className="add-slide-modal interactive-modal-wide" onClick={(e) => e.stopPropagation()}>
                        <div className="add-slide-modal-header">
                            <div className="modal-title-with-badge">
                                <h3>
                                    {interactiveTargetSlideIndex === null ? '🎯 Thêm Slide Tương Tác Mới' : `✨ Cấu hình câu hỏi tương tác (Slide ${interactiveTargetSlideIndex})`}
                                </h3>
                                <span className="modal-header-badge">Hỗ trợ SCORM, H5P & Moodle Quiz</span>
                            </div>
                            <button
                                type="button"
                                className="add-slide-modal-close"
                                onClick={() => !isGeneratingInteractive && setIsInteractiveModalOpen(false)}
                                disabled={isGeneratingInteractive}
                            >
                                ✕
                            </button>
                        </div>

                        <form onSubmit={(e) => handleInteractiveModalSubmit(e, false)}>
                            <div className="add-slide-modal-body">
                                {/* 1. Slide Title */}
                                <div className="add-slide-form-group">
                                    <label>📌 Tiêu đề Slide tương tác <span style={{ color: '#ef4444' }}>*</span></label>
                                    <input
                                        type="text"
                                        className="add-slide-input"
                                        value={interactiveModalTitle}
                                        onChange={(e) => setInteractiveModalTitle(e.target.value)}
                                        placeholder="Ví dụ: Kiểm tra nhanh kiến thức, Trạm dừng kiểm soát, Bài nghe hiểu Unit 1..."
                                        required
                                        disabled={isGeneratingInteractive}
                                    />
                                </div>

                                {/* 2. Activity Type Selection */}
                                <div className="add-slide-form-group">
                                    <label>🏷️ Loại hoạt động tương tác</label>
                                    <div className="activity-type-grid">
                                        <div
                                            className={`activity-type-card ${interactiveActivityType === 'checkpoint_quiz' ? 'selected' : ''}`}
                                            onClick={() => setInteractiveActivityType('checkpoint_quiz')}
                                        >
                                            <div className="activity-card-icon">🎯</div>
                                            <div className="activity-card-info">
                                                <strong>Kiểm tra nhanh chặn bài (Mastery Gate)</strong>
                                                <p>Độc lập riêng biệt. Sinh viên phải trả lời đạt chuẩn điểm quy định mới được học tiếp slide sau.</p>
                                            </div>
                                        </div>
                                        <div
                                            className={`activity-type-card ${interactiveActivityType === 'interactive_audio' ? 'selected' : ''}`}
                                            onClick={() => setInteractiveActivityType('interactive_audio')}
                                        >
                                            <div className="activity-card-icon">🎧</div>
                                            <div className="activity-card-info">
                                                <strong>Bài tập Nghe & Tương tác (Audio Lab)</strong>
                                                <p>Slide tích hợp audio phát âm / bài nghe mẫu kèm câu hỏi nghe hiểu đi kèm.</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* 3. Insert Position (Only when adding brand new slide) */}
                                {interactiveTargetSlideIndex === null && (
                                    <div className="add-slide-form-group">
                                        <label>📍 Vị trí chèn slide</label>
                                        <select
                                            className="add-slide-select"
                                            value={interactiveModalInsertAfter}
                                            onChange={(e) => setInteractiveModalInsertAfter(parseInt(e.target.value, 10))}
                                            disabled={isGeneratingInteractive}
                                        >
                                            <option value={-1}>Thêm vào cuối cùng (Slide {slideProgress.length + 1})</option>
                                            <option value={0}>Chèn vào đầu tiên (Trước Slide 1)</option>
                                            {slideProgress.map((s) => (
                                                <option key={s.slideIndex} value={s.slideIndex}>
                                                    Sau Slide {s.slideIndex}: {s.title || `Slide ${s.slideIndex}`}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                {/* 4. Mode Selection: AI Creation (Default) vs Existing Question Extraction (Option 2) */}
                                <div className="add-slide-form-group">
                                    <label>🎯 Chế độ tạo câu hỏi:</label>
                                    <div className="generation-mode-cards">
                                        <div
                                            className={`generation-mode-card ${interactiveGenerationMode === 'generate_new' ? 'active' : ''}`}
                                            onClick={() => setInteractiveGenerationMode('generate_new')}
                                        >
                                            <div className="mode-card-header">
                                                <span className="mode-badge-default">Mặc định</span>
                                                <span style={{ fontSize: '18px' }}>✨</span>
                                            </div>
                                            <div className="mode-card-title">AI tự sáng tạo câu hỏi mới</div>
                                            <div className="mode-card-desc">
                                                AI tự động phân tích kiến thức từ dải slide, bài nghe audio hoặc tài liệu bạn cung cấp để biên soạn bộ câu hỏi kiểm tra chéo.
                                            </div>
                                        </div>

                                        <div
                                            className={`generation-mode-card ${interactiveGenerationMode === 'extract_existing' ? 'active' : ''}`}
                                            onClick={() => {
                                                setInteractiveGenerationMode('extract_existing');
                                                if (interactiveSourceType === 'slide_range') {
                                                    setInteractiveSourceType('custom_text');
                                                }
                                            }}
                                        >
                                            <div className="mode-card-header">
                                                <span className="mode-badge-option">Đã có câu hỏi</span>
                                                <span style={{ fontSize: '18px' }}>📋</span>
                                            </div>
                                            <div className="mode-card-title">Trích xuất từ đề / câu hỏi có sẵn</div>
                                            <div className="mode-card-desc">
                                                Dán câu hỏi có sẵn (Word/PDF/Text) hoặc tải ảnh đề bài. AI giữ nguyên văn câu hỏi & đáp án (không tự ý chế câu khác).
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* 5. Knowledge Source Selection based on Mode */}
                                <div className="add-slide-form-group">
                                    <label>
                                        {interactiveGenerationMode === 'extract_existing'
                                            ? '📋 Phương thức cung cấp đề thi / câu hỏi có sẵn'
                                            : '📚 Nguồn kiến thức để AI phân tích & tạo câu hỏi'}
                                    </label>
                                    <div className="source-type-tabs">
                                        {interactiveGenerationMode === 'generate_new' ? (
                                            <>
                                                <button
                                                    type="button"
                                                    className={`source-tab-btn ${interactiveSourceType === 'slide_range' ? 'active' : ''}`}
                                                    onClick={() => setInteractiveSourceType('slide_range')}
                                                >
                                                    📖 Từ dải slide (Khuyên dùng)
                                                </button>
                                                <button
                                                    type="button"
                                                    className={`source-tab-btn ${interactiveSourceType === 'custom_text' ? 'active' : ''}`}
                                                    onClick={() => setInteractiveSourceType('custom_text')}
                                                >
                                                    ✍️ Nhập văn bản tài liệu
                                                </button>
                                                <button
                                                    type="button"
                                                    className={`source-tab-btn ${interactiveSourceType === 'audio' ? 'active' : ''}`}
                                                    onClick={() => setInteractiveSourceType('audio')}
                                                >
                                                    🎧 Tải file Audio bài nghe
                                                </button>
                                                <button
                                                    type="button"
                                                    className={`source-tab-btn ${interactiveSourceType === 'image' ? 'active' : ''}`}
                                                    onClick={() => setInteractiveSourceType('image')}
                                                >
                                                    🖼️ Tải ảnh tài liệu
                                                </button>
                                            </>
                                        ) : (
                                            <>
                                                <button
                                                    type="button"
                                                    className={`source-tab-btn ${interactiveSourceType === 'custom_text' ? 'active' : ''}`}
                                                    onClick={() => setInteractiveSourceType('custom_text')}
                                                >
                                                    ✍️ Dán văn bản câu hỏi / Đề thi
                                                </button>
                                                <button
                                                    type="button"
                                                    className={`source-tab-btn ${interactiveSourceType === 'image' ? 'active' : ''}`}
                                                    onClick={() => setInteractiveSourceType('image')}
                                                >
                                                    🖼️ Tải ảnh chụp đề bài (AI OCR)
                                                </button>
                                            </>
                                        )}
                                    </div>

                                    {/* Source Tab 1: Slide Range (Only in generate_new mode) */}
                                    {interactiveGenerationMode === 'generate_new' && interactiveSourceType === 'slide_range' && (
                                        <div className="source-content-box">
                                            <p className="source-desc">
                                                AI sẽ tự động tổng hợp toàn bộ kiến thức, ý chính và lời giảng từ các slide bạn chọn để sinh các câu hỏi kiểm tra chéo:
                                            </p>
                                            <div className="slide-range-picker-row">
                                                <div className="range-picker-col">
                                                    <label>Từ Slide:</label>
                                                    <select
                                                        className="add-slide-select"
                                                        value={interactiveFromSlide}
                                                        onChange={(e) => setInteractiveFromSlide(parseInt(e.target.value, 10))}
                                                        disabled={isGeneratingInteractive}
                                                    >
                                                        {slideProgress.map((s) => (
                                                            <option key={s.slideIndex} value={s.slideIndex}>
                                                                Slide {s.slideIndex}: {s.title || `Slide ${s.slideIndex}`}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div className="range-picker-separator">➔</div>
                                                <div className="range-picker-col">
                                                    <label>Đến Slide:</label>
                                                    <select
                                                        className="add-slide-select"
                                                        value={interactiveToSlide}
                                                        onChange={(e) => setInteractiveToSlide(parseInt(e.target.value, 10))}
                                                        disabled={isGeneratingInteractive}
                                                    >
                                                        {slideProgress.map((s) => (
                                                            <option key={s.slideIndex} value={s.slideIndex}>
                                                                Slide {s.slideIndex}: {s.title || `Slide ${s.slideIndex}`}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </div>
                                            <div className="range-preview-summary">
                                                <span>💡 Phạm vi ra đề: Tổng hợp nội dung từ <b>Slide {Math.min(interactiveFromSlide, interactiveToSlide)}</b> đến <b>Slide {Math.max(interactiveFromSlide, interactiveToSlide)}</b> ({Math.abs(interactiveToSlide - interactiveFromSlide) + 1} slides).</span>
                                            </div>
                                        </div>
                                    )}

                                    {/* Source Tab 2: Custom Text / Pasted Questions */}
                                    {interactiveSourceType === 'custom_text' && (
                                        <div className="source-content-box">
                                            {interactiveGenerationMode === 'extract_existing' ? (
                                                <>
                                                    <div className="source-desc-header">
                                                        <span className="source-desc" style={{ marginBottom: 0 }}>
                                                            Dán trực tiếp câu hỏi & các phương án lựa chọn vào đây (AI sẽ nhận diện và giữ nguyên văn 100%):
                                                        </span>
                                                        <button
                                                            type="button"
                                                            className="btn-sample-paste"
                                                            onClick={() => {
                                                                setInteractiveCustomContent(
`Câu 1: Trong câu "She usually goes to school by bus", trạng từ chỉ tần suất là từ nào?
A. usually
B. goes
C. school
D. bus
Đáp án: A
Giải thích: "usually" là trạng từ chỉ tần suất chỉ thói quen thường xuyên.

Câu 2: Thì hiện tại đơn dùng để diễn tả một chân lý hoặc quy luật tự nhiên hiển nhiên.
A. Đúng
B. Sai
Đáp án: Đúng

Câu 3: Chọn các dấu hiệu nhận biết của thì hiện tại đơn trong danh sách sau:
A. Every day
B. Right now
C. Seldom
D. At present
Đáp án: A, C

Câu 4: Water [.....] at 100 degrees Celsius.
Đáp án: boils`
                                                                );
                                                            }}
                                                        >
                                                            📋 Dán đề mẫu
                                                        </button>
                                                    </div>
                                                    <textarea
                                                        rows={7}
                                                        className="add-slide-textarea"
                                                        value={interactiveCustomContent}
                                                        onChange={(e) => setInteractiveCustomContent(e.target.value)}
                                                        placeholder={`Dán các câu hỏi của bạn vào đây...\nVí dụ:\nCâu 1: Thủ đô của Việt Nam là gì?\nA. Hà Nội\nB. TP. Hồ Chí Minh\nC. Đà Nẵng\nD. Hải Phòng\nĐáp án: A\n\nCâu 2: Nhận định sau đúng hay sai?\n...`}
                                                        disabled={isGeneratingInteractive}
                                                    />
                                                </>
                                            ) : (
                                                <>
                                                    <p className="source-desc">Dán đoạn văn bản, tài liệu, danh sách thuật ngữ hoặc bài đọc mà bạn muốn AI tạo câu hỏi:</p>
                                                    <textarea
                                                        rows={5}
                                                        className="add-slide-textarea"
                                                        value={interactiveCustomContent}
                                                        onChange={(e) => setInteractiveCustomContent(e.target.value)}
                                                        placeholder="Dán nội dung bài đọc, kiến thức cần ôn tập vào đây..."
                                                        disabled={isGeneratingInteractive}
                                                    />
                                                </>
                                            )}
                                        </div>
                                    )}

                                    {/* Source Tab 3: Upload Audio (Only in generate_new mode) */}
                                    {interactiveGenerationMode === 'generate_new' && interactiveSourceType === 'audio' && (
                                        <div className="source-content-box">
                                            <p className="source-desc">Tải file âm thanh mẫu (MP3, WAV, M4A) cho bài nghe hiểu. Hệ thống sẽ tự động gán audio này vào slide:</p>
                                            <div className="modal-file-upload-box">
                                                <input
                                                    type="file"
                                                    ref={modalAudioInputRef}
                                                    style={{ display: 'none' }}
                                                    accept="audio/*,.mp3,.wav,.m4a,.ogg"
                                                    onChange={(e) => {
                                                        const file = e.target.files?.[0];
                                                        if (file) setInteractiveAudioFile(file);
                                                    }}
                                                />
                                                {interactiveAudioFile ? (
                                                    <div className="file-selected-row">
                                                        <span className="file-icon">🎵</span>
                                                        <div className="file-info">
                                                            <strong>{interactiveAudioFile.name}</strong>
                                                            <span>{(interactiveAudioFile.size / (1024 * 1024)).toFixed(2)} MB</span>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            className="btn-remove-file"
                                                            onClick={() => setInteractiveAudioFile(null)}
                                                        >
                                                            ✕ Đổi file
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        className="btn-select-file"
                                                        onClick={() => modalAudioInputRef.current?.click()}
                                                    >
                                                        🎧 Bấm để chọn file âm thanh từ máy tính
                                                    </button>
                                                )}
                                            </div>
                                            <div style={{ marginTop: '10px' }}>
                                                <label style={{ fontSize: '12px', color: '#94a3b8' }}>Ghi chú nội dung / lời thoại bài nghe (tùy chọn để AI tạo câu hỏi chuẩn xác hơn):</label>
                                                <textarea
                                                    rows={3}
                                                    className="add-slide-textarea"
                                                    value={interactiveCustomContent}
                                                    onChange={(e) => setInteractiveCustomContent(e.target.value)}
                                                    placeholder="Nhập transcript hoặc chủ đề bài nghe (ví dụ: Conversation about booking hotel room)..."
                                                    disabled={isGeneratingInteractive}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* Source Tab 4: Upload Image (Supports both general document & question photo OCR) */}
                                    {interactiveSourceType === 'image' && (
                                        <div className="source-content-box">
                                            <p className="source-desc">
                                                {interactiveGenerationMode === 'extract_existing'
                                                    ? 'Tải ảnh chụp đề bài, đề thi hoặc bài tập trong sách (AI Vision sẽ đọc chữ OCR và trích xuất câu hỏi):'
                                                    : 'Tải ảnh chụp sơ đồ, bảng biểu hoặc tài liệu đề bài:'}
                                            </p>
                                            <div className="modal-file-upload-box">
                                                <input
                                                    type="file"
                                                    ref={modalImageInputRef}
                                                    style={{ display: 'none' }}
                                                    accept="image/*"
                                                    onChange={(e) => {
                                                        const file = e.target.files?.[0];
                                                        if (file) {
                                                            setInteractiveImageFile(file);
                                                            const previewUrl = URL.createObjectURL(file);
                                                            setInteractiveImagePreview(previewUrl);
                                                            const reader = new FileReader();
                                                            reader.onload = (ev) => {
                                                                setInteractiveImageBase64(ev.target?.result as string);
                                                            };
                                                            reader.readAsDataURL(file);
                                                        }
                                                    }}
                                                />
                                                {interactiveImageFile ? (
                                                    <div className="file-selected-row">
                                                        <span className="file-icon">🖼️</span>
                                                        <div className="file-info">
                                                            <strong>{interactiveImageFile.name}</strong>
                                                            <span>{(interactiveImageFile.size / 1024).toFixed(1)} KB</span>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            className="btn-remove-file"
                                                            onClick={() => {
                                                                setInteractiveImageFile(null);
                                                                setInteractiveImagePreview(null);
                                                                setInteractiveImageBase64(null);
                                                            }}
                                                        >
                                                            ✕ Đổi ảnh
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        className="btn-select-file"
                                                        onClick={() => modalImageInputRef.current?.click()}
                                                    >
                                                        🖼️ Bấm để chọn file ảnh từ máy tính
                                                    </button>
                                                )}
                                            </div>
                                            {interactiveImagePreview && (
                                                <div className="image-preview-thumbnail">
                                                    <img src={interactiveImagePreview} alt="Tài liệu đính kèm" />
                                                </div>
                                            )}
                                            <div style={{ marginTop: '10px' }}>
                                                <label style={{ fontSize: '12px', color: '#94a3b8' }}>
                                                    {interactiveGenerationMode === 'extract_existing'
                                                        ? 'Ghi chú thêm về ảnh đề bài (ví dụ: Chỉ lấy từ câu 1 đến câu 5, bỏ qua phần tự luận):'
                                                        : 'Ghi chú tóm tắt nội dung ảnh (giúp AI hiểu đúng trọng tâm đề bài):'}
                                                </label>
                                                <textarea
                                                    rows={2}
                                                    className="add-slide-textarea"
                                                    value={interactiveCustomContent}
                                                    onChange={(e) => setInteractiveCustomContent(e.target.value)}
                                                    placeholder={interactiveGenerationMode === 'extract_existing' ? 'Ghi chú tùy chọn (ví dụ: Lấy các câu hỏi trắc nghiệm trang 1)...' : 'Ví dụ: Bảng số liệu tăng trưởng GDP quý 1...'}
                                                    disabled={isGeneratingInteractive}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* 5. Multi-selection of Question Types */}
                                <div className="add-slide-form-group">
                                    <div className="form-group-header-row">
                                        <label>🎯 Các dạng câu hỏi mong muốn (Tích chọn để tự phối hợp)</label>
                                        <div className="quick-select-qtypes">
                                            <button
                                                type="button"
                                                className="btn-text-tiny"
                                                onClick={() => setSelectedQTypes(['MC', 'TF', 'MR', 'FIB', 'MATCH', 'ORDER', 'CLOZE'])}
                                            >
                                                Chọn tất cả (7 dạng)
                                            </button>
                                        </div>
                                    </div>
                                    <div className="qtypes-grid">
                                        <div
                                            className={`qtype-card ${selectedQTypes.includes('MC') ? 'checked' : ''}`}
                                            onClick={() => toggleQType('MC')}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedQTypes.includes('MC')}
                                                onChange={() => {}}
                                            />
                                            <div className="qtype-card-body">
                                                <span className="qtype-name">🔘 Trắc nghiệm 1 đáp án (Single Choice)</span>
                                                <span className="qtype-sub">4 phương án A, B, C, D</span>
                                            </div>
                                        </div>

                                        <div
                                            className={`qtype-card ${selectedQTypes.includes('TF') ? 'checked' : ''}`}
                                            onClick={() => toggleQType('TF')}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedQTypes.includes('TF')}
                                                onChange={() => {}}
                                            />
                                            <div className="qtype-card-body">
                                                <span className="qtype-name">⚖️ Đúng hay Sai (True / False)</span>
                                                <span className="qtype-sub">Khẳng định nhận định đúng hoặc sai</span>
                                            </div>
                                        </div>

                                        <div
                                            className={`qtype-card ${selectedQTypes.includes('MR') ? 'checked' : ''}`}
                                            onClick={() => toggleQType('MR')}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedQTypes.includes('MR')}
                                                onChange={() => {}}
                                            />
                                            <div className="qtype-card-body">
                                                <span className="qtype-name">☑️ Chọn nhiều đáp án đúng (Multiple Response)</span>
                                                <span className="qtype-sub">Có 2 hoặc nhiều phương án đúng</span>
                                            </div>
                                        </div>

                                        <div
                                            className={`qtype-card ${selectedQTypes.includes('FIB') ? 'checked' : ''}`}
                                            onClick={() => toggleQType('FIB')}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedQTypes.includes('FIB')}
                                                onChange={() => {}}
                                            />
                                            <div className="qtype-card-body">
                                                <span className="qtype-name">✏️ Điền khuyết từ (Fill in the Blank)</span>
                                                <span className="qtype-sub">Điền từ hoặc thuật ngữ vào chỗ trống [.....]</span>
                                            </div>
                                        </div>

                                        <div
                                            className={`qtype-card ${selectedQTypes.includes('MATCH') ? 'checked' : ''}`}
                                            onClick={() => toggleQType('MATCH')}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedQTypes.includes('MATCH')}
                                                onChange={() => {}}
                                            />
                                            <div className="qtype-card-body">
                                                <span className="qtype-name">🔗 Nối cặp tương ứng (Matching Pairs)</span>
                                                <span className="qtype-sub">Ghép nối khái niệm cột A với định nghĩa cột B</span>
                                            </div>
                                        </div>

                                        <div
                                            className={`qtype-card ${selectedQTypes.includes('ORDER') ? 'checked' : ''}`}
                                            onClick={() => toggleQType('ORDER')}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedQTypes.includes('ORDER')}
                                                onChange={() => {}}
                                            />
                                            <div className="qtype-card-body">
                                                <span className="qtype-name">🔤 Sắp xếp từ thành câu (Word Ordering)</span>
                                                <span className="qtype-sub">Put words in correct order: nhấp từ để ghép câu hoàn chỉnh</span>
                                            </div>
                                        </div>

                                        <div
                                            className={`qtype-card ${selectedQTypes.includes('CLOZE') ? 'checked' : ''}`}
                                            onClick={() => toggleQType('CLOZE')}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedQTypes.includes('CLOZE')}
                                                onChange={() => {}}
                                            />
                                            <div className="qtype-card-body">
                                                <span className="qtype-name">💬 Điền khuyết hội thoại / đoạn văn (Cloze)</span>
                                                <span className="qtype-sub">Hội thoại A-B hoặc đoạn văn có các ô trống [từ] trực tiếp</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="qtype-note">
                                        💡 Hệ thống sẽ phân bổ ngẫu nhiên và cân đối các dạng câu hỏi bạn đã tích chọn vào bài tập.
                                    </div>
                                </div>

                                {/* 6. Question Count & Progression Policy (Mastery Gate) */}
                                <div className="add-slide-form-group">
                                    <label>⚙️ Cấu hình số lượng & Tiêu chuẩn chuyển tiếp (Mastery Gate)</label>

                                    <div className="progression-policy-box">
                                        <label className="progression-policy-heading">Chính sách khi học viên hoàn thành bài tập:</label>
                                        <div className="progression-policy-cards">
                                            <div
                                                className={`policy-choice-card ${!interactiveAllowContinueWithoutPass ? 'selected' : ''}`}
                                                onClick={() => setInteractiveAllowContinueWithoutPass(false)}
                                            >
                                                <input
                                                    type="radio"
                                                    name="modalAllowContinueWithoutPass"
                                                    checked={!interactiveAllowContinueWithoutPass}
                                                    onChange={() => setInteractiveAllowContinueWithoutPass(false)}
                                                />
                                                <div className="policy-choice-info">
                                                    <span className="policy-choice-title">🔒 Bắt buộc đạt chuẩn (Chặn bài)</span>
                                                    <span className="policy-choice-desc">Học viên phải đạt tối thiểu số câu đúng quy định mới được đi tiếp. Nếu trượt, hệ thống tự động đưa học viên quay về slide ôn tập.</span>
                                                </div>
                                            </div>

                                            <div
                                                className={`policy-choice-card ${interactiveAllowContinueWithoutPass ? 'selected' : ''}`}
                                                onClick={() => setInteractiveAllowContinueWithoutPass(true)}
                                            >
                                                <input
                                                    type="radio"
                                                    name="modalAllowContinueWithoutPass"
                                                    checked={interactiveAllowContinueWithoutPass}
                                                    onChange={() => setInteractiveAllowContinueWithoutPass(true)}
                                                />
                                                <div className="policy-choice-info">
                                                    <span className="policy-choice-title">🔓 Cho phép qua slide kể cả chưa đạt</span>
                                                    <span className="policy-choice-desc">Học viên làm xong là có thể bấm tiếp tục (Thích hợp cho bài tập tự do, khảo sát quan điểm, thảo luận mở). Không bị ép quay về học lại.</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="gate-config-inputs-row" style={{ marginTop: '12px' }}>
                                        <div className="gate-input-box">
                                            <label>Số lượng câu hỏi:</label>
                                            <div className="input-with-suffix">
                                                <input
                                                    type="number"
                                                    min={1}
                                                    max={10}
                                                    className="add-slide-input"
                                                    value={interactiveQCount}
                                                    onChange={(e) => {
                                                        const val = Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1));
                                                        setInteractiveQCount(val);
                                                        if (interactivePassScore > val) setInteractivePassScore(val);
                                                    }}
                                                    disabled={isGeneratingInteractive}
                                                />
                                                <span className="input-suffix">câu</span>
                                            </div>
                                        </div>

                                        <div className="gate-input-box">
                                            <label>Chuẩn đạt tối thiểu:</label>
                                            <div className="input-with-suffix">
                                                <input
                                                    type="number"
                                                    min={1}
                                                    max={interactiveQCount}
                                                    className="add-slide-input"
                                                    value={interactivePassScore}
                                                    onChange={(e) => {
                                                        const val = Math.max(1, Math.min(interactiveQCount, parseInt(e.target.value, 10) || 1));
                                                        setInteractivePassScore(val);
                                                    }}
                                                    disabled={isGeneratingInteractive}
                                                />
                                                <span className="input-suffix">/{interactiveQCount} câu</span>
                                            </div>
                                        </div>

                                        <div className={`gate-input-box wide ${interactiveAllowContinueWithoutPass ? 'item-disabled' : ''}`}>
                                            <label>
                                                Slide quay về khi trượt:
                                                {interactiveAllowContinueWithoutPass && <span style={{ color: '#94a3b8', fontWeight: 'normal' }}> (Không áp dụng)</span>}
                                            </label>
                                            <select
                                                className="add-slide-select"
                                                value={interactiveFallbackSlide}
                                                onChange={(e) => setInteractiveFallbackSlide(parseInt(e.target.value, 10))}
                                                disabled={isGeneratingInteractive || interactiveAllowContinueWithoutPass}
                                            >
                                                {slideProgress.map((s) => (
                                                    <option key={s.slideIndex} value={s.slideIndex}>
                                                        Slide {s.slideIndex}: {s.title || `Slide ${s.slideIndex}`}
                                                    </option>
                                                ))}
                                                {slideProgress.length === 0 && (
                                                    <option value={1}>Slide 1 (Đầu bài giảng)</option>
                                                )}
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="add-slide-modal-footer">
                                <button
                                    type="button"
                                    className="btn-secondary"
                                    onClick={() => setIsInteractiveModalOpen(false)}
                                    disabled={isGeneratingInteractive}
                                >
                                    Hủy
                                </button>
                                {interactiveTargetSlideIndex === null && (
                                    <button
                                        type="button"
                                        className="btn-subtle"
                                        onClick={(e) => handleInteractiveModalSubmit(e, true)}
                                        disabled={isGeneratingInteractive || !interactiveModalTitle.trim()}
                                        title="Chỉ tạo slide trống để cấu hình thủ công sau"
                                    >
                                        Tạo slide trống
                                    </button>
                                )}
                                <button
                                    type="submit"
                                    className="btn-primary btn-generate-interactive-ai"
                                    disabled={isGeneratingInteractive || !interactiveModalTitle.trim() || selectedQTypes.length === 0}
                                >
                                    {isGeneratingInteractive
                                        ? (interactiveGenerationMode === 'extract_existing' ? '⏳ AI đang trích xuất câu hỏi...' : '⏳ AI đang phân tích & tạo câu hỏi...')
                                        : (interactiveGenerationMode === 'extract_existing' ? '📋 AI Trích xuất câu hỏi vào Slide' : '✨ Tạo câu hỏi bằng AI')
                                    }
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal: Hướng dẫn nạp học liệu vào Moodle */}
            {isMoodleGuideModalOpen && (
                <div className="moodle-guide-modal-overlay" onClick={() => setIsMoodleGuideModalOpen(false)}>
                    <div className="moodle-guide-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="moodle-guide-header">
                            <div className="guide-title-row">
                                <span className="moodle-icon">🎓</span>
                                <div>
                                    <h3>Hướng Dẫn Đưa Học Liệu Vào Moodle LMS</h3>
                                    <p className="guide-subtitle">Thay thế hoàn toàn quy trình iSpring Suite & PowerPoint thủ công</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                className="btn-close-modal"
                                onClick={() => setIsMoodleGuideModalOpen(false)}
                            >
                                ✕
                            </button>
                        </div>
                        <div className="moodle-guide-body">
                            <div className="guide-option-card">
                                <div className="option-badge">Cách 1 (Khuyên dùng)</div>
                                <h4>📦 Đưa Gói SCORM (.zip) Vào Moodle</h4>
                                <p className="option-desc">Tự động phát lời giảng từng slide, hỗ trợ bài nghe mẫu, sinh viên làm bài tập tương tác và điểm số tự động ghi vào Sổ điểm (Gradebook) của Moodle.</p>
                                <ol className="guide-steps-list">
                                    <li>Nhấn nút <b>"📦 Xuất SCORM (.zip)"</b> ở thanh công cụ để tải file về máy.</li>
                                    <li>Mở khóa học trên <b>Moodle</b> → Bật chế độ chỉnh sửa (<i>Edit mode</i>).</li>
                                    <li>Nhấn <b>"Thêm hoạt động hoặc tài nguyên"</b> → Chọn <b>"Gói SCORM" (SCORM package)</b>.</li>
                                    <li>Kéo thả file <code>.zip</code> vừa tải về vào mục <i>Gói tập tin (Package file)</i>.</li>
                                    <li>Đặt tên bài học và nhấn <b>"Lưu và trở về khóa học"</b>. Hoàn thành trong 30 giây!</li>
                                </ol>
                            </div>

                            <div className="guide-option-card">
                                <div className="option-badge option-badge-h5p">Cách 2</div>
                                <h4>🌟 Đưa Gói H5P (.h5p) Vào Moodle</h4>
                                <p className="option-desc">Chuẩn Course Presentation của H5P, tương tác đa dạng trên nền tảng Moodle 3.9+.</p>
                                <ol className="guide-steps-list">
                                    <li>Nhấn nút <b>"🌟 Xuất H5P (.h5p)"</b> để tải gói học liệu H5P.</li>
                                    <li>Trong khóa học Moodle, nhấn <b>"Thêm hoạt động hoặc tài nguyên"</b> → Chọn <b>"H5P"</b>.</li>
                                    <li>Tải file <code>.h5p</code> lên mục <i>Package file</i> và nhấn <b>Lưu</b>.</li>
                                </ol>
                            </div>

                            <div className="guide-option-card">
                                <div className="option-badge option-badge-xml">Cách 3</div>
                                <h4>📋 Nhập Moodle Quiz XML Vào Ngân Hàng Đề Thi</h4>
                                <p className="option-desc">Xuất toàn bộ câu hỏi trắc nghiệm & kiểm tra nhanh từ slide vào ngân hàng đề thi của Moodle.</p>
                                <ol className="guide-steps-list">
                                    <li>Nhấn nút <b>"📋 Xuất Moodle Quiz XML"</b> để tải file <code>.xml</code>.</li>
                                    <li>Vào <b>Quản trị khóa học</b> → <b>Ngân hàng câu hỏi (Question bank)</b> → <b>Nhập (Import)</b>.</li>
                                    <li>Chọn định dạng <b>Moodle XML format</b> và tải file <code>.xml</code> lên.</li>
                                    <li>Các câu hỏi sẽ tự động được xếp vào danh mục bài học, sẵn sàng dùng cho bài thi trắc nghiệm (Quiz).</li>
                                </ol>
                            </div>
                        </div>
                        <div className="moodle-guide-footer">
                            <button
                                type="button"
                                className="btn-primary"
                                onClick={() => setIsMoodleGuideModalOpen(false)}
                            >
                                Đã hiểu
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
