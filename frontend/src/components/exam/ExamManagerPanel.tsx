import { useState, useEffect, useMemo } from 'react';
import {
    examSetsApi,
    type ExamLessonOverviewItem,
    type ExamSetSummary,
    type ExamSetDetail,
} from '../../lib/exam-sets-api';
import { useJobPolling } from '../../hooks/useJobPolling';
import { ModelSelector } from '../ModelSelector';
import { renderClozeVisual } from '../steps/Step6QuestionBank';
import './ExamManagerPanel.css';

interface ExamManagerPanelProps {
    mode: 'subject' | 'pptx-subject';
    subjectId?: string;
    pptxSubjectId?: string;
    subjectName?: string;
}

const ENGLISH_Q_TYPES = [
    { id: 'MC', label: '🔘 Multiple Choice (1 đáp án)' },
    { id: 'MR', label: '☑️ Multiple Response (Nhiều đáp án)' },
    { id: 'MATCH', label: '🔄 Matching (Ghép đôi 2 cột)' },
    { id: 'CLOZE', label: '📝 Cloze (Điền khuyết đoạn văn)' },
    { id: 'TRUEFALSE', label: '⚖️ True / False (Đúng / Sai)' },
];

function toClientCategorySlug(raw: string): string {
    if (!raw || !raw.trim()) return 'De_Kiem_Tra';
    const noDiacritics = raw
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D');
    return (
        noDiacritics
            .replace(/[^A-Za-z0-9\s_-]/g, ' ')
            .trim()
            .replace(/[\s-]+/g, '_')
            .replace(/_+/g, '_')
            .substring(0, 80)
            .replace(/^_+|_+$/g, '') || 'De_Kiem_Tra'
    );
}

function getLessonDisplayTitle(lesson: ExamLessonOverviewItem): string {
    if (lesson.displayTitle && lesson.displayTitle.trim()) {
        return lesson.displayTitle.trim();
    }
    const padded = String(lesson.order).padStart(2, '0');
    const raw = (lesson.title || '').trim();
    if (!raw) return `Bài ${padded}`;
    if (/^(?:Bài|Bai|Lesson|Unit|Chương|Chuong|Chapter)\s*\d+/i.test(raw)) {
        return raw;
    }
    return `Bài ${padded}: ${raw}`;
}

function truncateText(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    return `${text.slice(0, maxLen - 1).trim()}…`;
}

export function ExamManagerPanel({
    mode,
    subjectId,
    pptxSubjectId,
    subjectName,
}: ExamManagerPanelProps) {
    const [lessons, setLessons] = useState<ExamLessonOverviewItem[]>([]);
    const [examSets, setExamSets] = useState<ExamSetSummary[]>([]);
    const [activeExamSet, setActiveExamSet] = useState<ExamSetDetail | null>(null);
    const [isCreateView, setIsCreateView] = useState<boolean>(true);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isRefreshingLessons, setIsRefreshingLessons] = useState<boolean>(false);
    const [bannerMessage, setBannerMessage] = useState<{
        type: 'success' | 'error' | 'info';
        text: string;
    } | null>(null);

    // Builder state
    const [examName, setExamName] = useState<string>('Kiểm tra Giữa kỳ (Bài 1 - Bài 6)');
    const [categoryName, setCategoryName] = useState<string>('Giua_Ky_Bai_1_6');
    const [isCategoryTouched, setIsCategoryTouched] = useState<boolean>(false);
    const [questionMode, setQuestionMode] = useState<'REVIEW' | 'ENGLISH'>('REVIEW');
    const [selectedLessonIds, setSelectedLessonIds] = useState<string[]>([]);
    const [rangeFromOrder, setRangeFromOrder] = useState<number>(1);
    const [rangeToOrder, setRangeToOrder] = useState<number>(6);
    const [useCustomPerLessonQuota, setUseCustomPerLessonQuota] = useState<boolean>(false);
    const [perLessonCounts, setPerLessonCounts] = useState<Record<string, number>>({});
    const [level1Count, setLevel1Count] = useState<number>(20);
    const [level2Count, setLevel2Count] = useState<number>(20);
    const [level3Count, setLevel3Count] = useState<number>(10);
    const [selectedQTypes, setSelectedQTypes] = useState<string[]>([
        'MC',
        'MR',
        'MATCH',
        'CLOZE',
        'TRUEFALSE',
    ]);
    const [customInstructions, setCustomInstructions] = useState<string>('');
    const [selectedModelName, setSelectedModelName] = useState<string>('');

    // Viewer & Filter state
    const [filterLessonId, setFilterLessonId] = useState<string>('ALL');
    const [filterLevel, setFilterLevel] = useState<string>('ALL');
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [editingQuestionIdx, setEditingQuestionIdx] = useState<number | null>(null);
    const [editingQuestionDraft, setEditingQuestionDraft] = useState<any>(null);

    // Append more questions modal
    const [showAppendModal, setShowAppendModal] = useState<boolean>(false);
    const [appendL1, setAppendL1] = useState<number>(8);
    const [appendL2, setAppendL2] = useState<number>(8);
    const [appendL3, setAppendL3] = useState<number>(4);

    // Delete Exam Set confirmation modal
    const [confirmDeleteSetId, setConfirmDeleteSetId] = useState<string | null>(null);

    // Job polling
    const generateJob = useJobPolling({
        onComplete: async (status) => {
            setBannerMessage({
                type: 'success',
                text: `✅ Đã tạo thành công bộ câu hỏi kiểm tra (${status.result?.totalCount || ''} câu)!`,
            });
            await fetchOverviewAndSets(status.result?.examSetId);
        },
        onError: (msg) => {
            setBannerMessage({
                type: 'error',
                text: `❌ Lỗi khi tạo câu hỏi kiểm tra: ${msg}`,
            });
        },
    });

    const targetParams = useMemo(
        () => (mode === 'subject' ? { subjectId } : { pptxSubjectId }),
        [mode, subjectId, pptxSubjectId],
    );

    useEffect(() => {
        if (subjectId || pptxSubjectId) {
            fetchOverviewAndSets();
        }
    }, [subjectId, pptxSubjectId]);

    const fetchOverviewAndSets = async (
        selectExamSetId?: string,
        options?: { preserveSelection?: boolean; silentLoading?: boolean },
    ) => {
        try {
            if (options?.silentLoading) {
                setIsRefreshingLessons(true);
            } else {
                setIsLoading(true);
            }
            const [overviewRes, setsRes] = await Promise.all([
                examSetsApi.getLessonsOverview(targetParams),
                examSetsApi.list(targetParams),
            ]);

            const loadedLessons = overviewRes.data.lessons || [];
            setLessons(loadedLessons);
            if (overviewRes.data.isEnglishSubject) {
                setQuestionMode('ENGLISH');
            }

            const validIdMap = new Map<string, string>();
            for (const l of loadedLessons) {
                validIdMap.set(l.id, l.id);
                if (l.syllabusLessonId) {
                    validIdMap.set(`sl:${l.syllabusLessonId}`, l.id);
                }
            }

            if (options?.preserveSelection) {
                setSelectedLessonIds((prev) => {
                    const remapped = Array.from(
                        new Set(
                            prev
                                .map((id) => validIdMap.get(id))
                                .filter((id): id is string => Boolean(id)),
                        ),
                    );
                    if (remapped.length > 0) return remapped;
                    const available = loadedLessons.filter((l) => l.hasContent);
                    return (available.length > 0 ? available : loadedLessons)
                        .slice(0, 6)
                        .map((l) => l.id);
                });
            } else {
                // Default select up to first 6 created lessons with content
                const availableWithContent = loadedLessons.filter((l) => l.hasContent);
                const initialSelected = (
                    availableWithContent.length > 0 ? availableWithContent : loadedLessons
                )
                    .slice(0, 6)
                    .map((l) => l.id);
                setSelectedLessonIds(initialSelected);
            }

            if (loadedLessons.length > 0) {
                const firstOrder = loadedLessons[0].order;
                const defaultEndIdx = Math.min(5, loadedLessons.length - 1);
                const endOrder = loadedLessons[defaultEndIdx].order;
                setRangeFromOrder(firstOrder);
                setRangeToOrder(endOrder);
            } else {
                setRangeFromOrder(1);
                setRangeToOrder(1);
            }

            const sets = setsRes.data || [];
            setExamSets(sets);

            if (selectExamSetId) {
                await handleSelectExamSet(selectExamSetId);
            } else if (!options?.preserveSelection && sets.length > 0 && !activeExamSet) {
                await handleSelectExamSet(sets[0].id);
            } else if (sets.length === 0) {
                setIsCreateView(true);
                setActiveExamSet(null);
            }
        } catch (err: any) {
            setBannerMessage({
                type: 'error',
                text: err.response?.data?.message || 'Không thể tải dữ liệu bài kiểm tra.',
            });
        } finally {
            setIsLoading(false);
            setIsRefreshingLessons(false);
        }
    };

    const handleSelectExamSet = async (id: string) => {
        try {
            const res = await examSetsApi.getOne(id);
            setActiveExamSet(res.data);
            setIsCreateView(false);
            setFilterLessonId('ALL');
            setFilterLevel('ALL');
            setEditingQuestionIdx(null);
        } catch (err: any) {
            setBannerMessage({
                type: 'error',
                text: err.response?.data?.message || 'Không thể mở bộ đề kiểm tra.',
            });
        }
    };

    // Update suggested category slug when selected lessons change (if not manually edited)
    useEffect(() => {
        if (isCategoryTouched || lessons.length === 0) return;
        const chosenLessons = lessons
            .filter((l) => selectedLessonIds.includes(l.id))
            .sort((a, b) => a.order - b.order);
        if (chosenLessons.length > 0) {
            const chosenOrders = chosenLessons.map((l) => l.order);
            const first = chosenOrders[0];
            const last = chosenOrders[chosenOrders.length - 1];
            const isContiguous = chosenOrders.length === last - first + 1;
            const rangeText =
                chosenOrders.length === 1
                    ? `Bai_${first}`
                    : isContiguous
                    ? `Bai_${first}_${last}`
                    : `Bai_${chosenOrders.join('_')}`;
            setCategoryName(`Giua_Ky_${rangeText}`);
            setExamName(
                chosenLessons.length === 1
                    ? `Kiểm tra ${truncateText(getLessonDisplayTitle(chosenLessons[0]), 60)}`
                    : isContiguous
                    ? `Kiểm tra Giữa kỳ (Bài ${first} - Bài ${last})`
                    : `Kiểm tra Tổng hợp (${chosenOrders.map((o) => `Bài ${o}`).join(', ')})`,
            );
        }
    }, [selectedLessonIds, lessons, isCategoryTouched]);

    const totalRequestedQuestions = useMemo(() => {
        if (useCustomPerLessonQuota) {
            return selectedLessonIds.reduce(
                (acc, id) => acc + Math.max(0, Number(perLessonCounts[id] || 0)),
                0,
            );
        }
        return Math.max(0, level1Count) + Math.max(0, level2Count) + Math.max(0, level3Count);
    }, [useCustomPerLessonQuota, selectedLessonIds, perLessonCounts, level1Count, level2Count, level3Count]);

    // Auto-computed quota preview per lesson
    const autoQuotaByLessonId = useMemo(() => {
        const map: Record<string, number> = {};
        const k = selectedLessonIds.length;
        if (k === 0) return map;
        const total = Math.max(0, level1Count) + Math.max(0, level2Count) + Math.max(0, level3Count);
        const base = Math.floor(total / k);
        const rem = total % k;
        selectedLessonIds.forEach((id, idx) => {
            map[id] = base + (idx < rem ? 1 : 0);
        });
        return map;
    }, [selectedLessonIds, level1Count, level2Count, level3Count]);

    const toggleLessonSelection = (lessonId: string) => {
        setSelectedLessonIds((prev) =>
            prev.includes(lessonId) ? prev.filter((id) => id !== lessonId) : [...prev, lessonId],
        );
    };

    const handleSelectRange = () => {
        const minO = Math.min(rangeFromOrder, rangeToOrder);
        const maxO = Math.max(rangeFromOrder, rangeToOrder);
        const matched = lessons
            .filter((l) => l.order >= minO && l.order <= maxO)
            .map((l) => l.id);
        setSelectedLessonIds(matched);
    };

    const toggleQuestionType = (qType: string) => {
        setSelectedQTypes((prev) => {
            if (prev.includes(qType)) {
                if (prev.length <= 1) return prev;
                return prev.filter((t) => t !== qType);
            }
            return [...prev, qType];
        });
    };

    const handleStartGenerate = async () => {
        if (selectedLessonIds.length === 0) {
            setBannerMessage({
                type: 'error',
                text: '⚠️ Vui lòng chọn ít nhất 1 bài học nguồn để tạo câu hỏi kiểm tra.',
            });
            return;
        }
        if (totalRequestedQuestions <= 0) {
            setBannerMessage({
                type: 'error',
                text: '⚠️ Tổng số câu hỏi cần tạo phải lớn hơn 0.',
            });
            return;
        }

        try {
            setBannerMessage(null);
            const res = await examSetsApi.generateAsync({
                name: examName.trim() || 'Đề kiểm tra tổng hợp',
                categoryName: toClientCategorySlug(categoryName || examName),
                ...targetParams,
                mode: questionMode,
                lessonIds: selectedLessonIds,
                totalCount: totalRequestedQuestions,
                level1: level1Count,
                level2: level2Count,
                level3: level3Count,
                perLessonCounts: useCustomPerLessonQuota ? perLessonCounts : undefined,
                questionTypes: questionMode === 'ENGLISH' ? selectedQTypes : undefined,
                customInstructions: customInstructions.trim() || undefined,
                modelName: selectedModelName || undefined,
            });
            if (res.data?.jobId) {
                generateJob.startPolling(res.data.jobId);
            }
        } catch (err: any) {
            setBannerMessage({
                type: 'error',
                text: err.response?.data?.message || 'Không thể khởi chạy tiến trình tạo đề kiểm tra.',
            });
        }
    };

    const handleStartAppend = async () => {
        if (!activeExamSet) return;
        const addTotal = Math.max(0, appendL1) + Math.max(0, appendL2) + Math.max(0, appendL3);
        if (addTotal <= 0) return;

        try {
            setShowAppendModal(false);
            setBannerMessage(null);
            const res = await examSetsApi.appendAsync(activeExamSet.id, {
                level1: appendL1,
                level2: appendL2,
                level3: appendL3,
                totalCount: addTotal,
                modelName: selectedModelName || undefined,
            });
            if (res.data?.jobId) {
                generateJob.startPolling(res.data.jobId);
            }
        } catch (err: any) {
            setBannerMessage({
                type: 'error',
                text: err.response?.data?.message || 'Không thể tạo thêm câu hỏi.',
            });
        }
    };

    const handleExportMoodleXml = async () => {
        if (!activeExamSet) return;
        try {
            const res = await examSetsApi.exportMoodleXml(activeExamSet.id);
            const url = window.URL.createObjectURL(
                new Blob([res.data], { type: 'application/xml; charset=utf-8' }),
            );
            const a = document.createElement('a');
            a.href = url;
            a.download = `${activeExamSet.categoryName}_moodle.xml`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch {
            setBannerMessage({
                type: 'error',
                text: 'Không thể xuất file Moodle XML.',
            });
        }
    };

    const handleExportExcel = async () => {
        if (!activeExamSet) return;
        try {
            const res = await examSetsApi.exportExcel(activeExamSet.id);
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const a = document.createElement('a');
            a.href = url;
            a.download = `${activeExamSet.categoryName}_exam_questions.xlsx`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch {
            setBannerMessage({
                type: 'error',
                text: 'Không thể xuất file Excel (.xlsx).',
            });
        }
    };

    const handleSaveEditedQuestion = async (index: number) => {
        if (!activeExamSet || !editingQuestionDraft) return;
        try {
            const updatedQuestions = [...activeExamSet.questions];
            updatedQuestions[index] = editingQuestionDraft;
            const res = await examSetsApi.update(activeExamSet.id, {
                questions: updatedQuestions,
            });
            setActiveExamSet(res.data);
            setEditingQuestionIdx(null);
            setEditingQuestionDraft(null);
            setBannerMessage({ type: 'success', text: '✓ Đã cập nhật câu hỏi!' });
        } catch {
            setBannerMessage({ type: 'error', text: 'Không thể lưu câu hỏi.' });
        }
    };

    const handleDeleteQuestionFromSet = async (index: number) => {
        if (!activeExamSet) return;
        try {
            const updatedQuestions = activeExamSet.questions.filter((_, i) => i !== index);
            const res = await examSetsApi.update(activeExamSet.id, {
                questions: updatedQuestions,
            });
            setActiveExamSet(res.data);
            setExamSets((prev) =>
                prev.map((s) =>
                    s.id === activeExamSet.id
                        ? { ...s, questionCount: updatedQuestions.length }
                        : s,
                ),
            );
            setBannerMessage({ type: 'success', text: '✓ Đã xóa câu hỏi khỏi bộ đề.' });
        } catch {
            setBannerMessage({ type: 'error', text: 'Không thể xóa câu hỏi.' });
        }
    };

    const handleConfirmDeleteExamSet = async () => {
        if (!confirmDeleteSetId) return;
        try {
            await examSetsApi.delete(confirmDeleteSetId);
            const remaining = examSets.filter((s) => s.id !== confirmDeleteSetId);
            setExamSets(remaining);
            setConfirmDeleteSetId(null);
            if (activeExamSet?.id === confirmDeleteSetId) {
                if (remaining.length > 0) {
                    await handleSelectExamSet(remaining[0].id);
                } else {
                    setActiveExamSet(null);
                    setIsCreateView(true);
                }
            }
            setBannerMessage({ type: 'success', text: '✓ Đã xóa bộ đề kiểm tra.' });
        } catch {
            setBannerMessage({ type: 'error', text: 'Không thể xóa bộ đề kiểm tra.' });
        }
    };

    const filteredQuestions = useMemo(() => {
        if (!activeExamSet) return [];
        return activeExamSet.questions
            .map((q, originalIndex) => ({ q, originalIndex }))
            .filter(({ q }) => {
                if (filterLessonId !== 'ALL' && q.sourceLessonId !== filterLessonId) {
                    return false;
                }
                const qLevel = String(q.level || q.difficulty || 1);
                if (filterLevel !== 'ALL' && qLevel !== filterLevel) {
                    return false;
                }
                if (searchQuery.trim()) {
                    const kw = searchQuery.toLowerCase();
                    const text = `${q.question || q.questionText || ''} ${q.sourceLessonTitle || ''} ${
                        q.sourceSection || ''
                    }`.toLowerCase();
                    if (!text.includes(kw)) return false;
                }
                return true;
            });
    }, [activeExamSet, filterLessonId, filterLevel, searchQuery]);

    // Group source lessons present in activeExamSet for filter dropdown
    const activeSetLessonOptions = useMemo(() => {
        if (!activeExamSet) return [];
        const map = new Map<string, { id: string; title: string; count: number }>();
        for (const q of activeExamSet.questions) {
            const lid = q.sourceLessonId || 'unknown';
            const ltitle = q.sourceLessonTitle || 'Bài học';
            const existing = map.get(lid);
            if (existing) {
                existing.count += 1;
            } else {
                map.set(lid, { id: lid, title: ltitle, count: 1 });
            }
        }
        return Array.from(map.values());
    }, [activeExamSet]);

    if (isLoading) {
        return <div className="loading-state">⏳ Đang tải trình quản lý Bài kiểm tra...</div>;
    }

    return (
        <div className="exam-manager-panel">
            {/* Header */}
            <div className="exam-panel-top-header">
                <div>
                    <h2>
                        📝 Tạo Bộ Câu Hỏi Kiểm Tra Theo Nhóm Bài Học
                        {subjectName ? ` — ${subjectName}` : ''}
                    </h2>
                    <p>
                        Tự động tải đầy đủ danh sách các bài học đã tạo của môn học, chia đều số lượng
                        câu hỏi cho từng bài được chọn và tổng hợp{' '}
                        <strong>
                            100% nguồn dữ liệu bài học (Giáo trình, Slide, Lời giảng, Đề cương, Handout,
                            Tài liệu TK) + Ngân hàng câu hỏi của từng bài
                        </strong>{' '}
                        để sinh mới 100% câu hỏi nằm trọn trong giới hạn các bài đã chọn và gom vào{' '}
                        <strong>1 Category Moodle duy nhất</strong>.
                    </p>
                </div>
                <button
                    type="button"
                    className={`btn-new-exam-set ${isCreateView ? 'active' : ''}`}
                    onClick={() => setIsCreateView(true)}
                >
                    ➕ Tạo Bộ Đề Kiểm Tra Mới
                </button>
            </div>

            {/* Banner Message */}
            {bannerMessage && (
                <div
                    style={{
                        padding: '12px 16px',
                        borderRadius: '10px',
                        background:
                            bannerMessage.type === 'error'
                                ? 'rgba(239, 68, 68, 0.16)'
                                : 'rgba(16, 185, 129, 0.16)',
                        border:
                            bannerMessage.type === 'error'
                                ? '1px solid rgba(239, 68, 68, 0.45)'
                                : '1px solid rgba(16, 185, 129, 0.45)',
                        color: bannerMessage.type === 'error' ? '#fca5a5' : '#6ee7b7',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                    }}
                >
                    <span>{bannerMessage.text}</span>
                    <button
                        type="button"
                        onClick={() => setBannerMessage(null)}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'inherit',
                            cursor: 'pointer',
                            fontWeight: 700,
                        }}
                    >
                        ✕
                    </button>
                </div>
            )}

            {/* Existing Exam Sets Pills */}
            {examSets.length > 0 && (
                <div className="exam-sets-bar">
                    <span style={{ fontSize: '0.84rem', color: '#94a3b8', fontWeight: 600 }}>
                        🗂️ Các bộ đề đã tạo ({examSets.length}):
                    </span>
                    {examSets.map((set) => (
                        <button
                            key={set.id}
                            type="button"
                            className={`exam-set-pill ${
                                !isCreateView && activeExamSet?.id === set.id ? 'active' : ''
                            }`}
                            onClick={() => handleSelectExamSet(set.id)}
                        >
                            <span>📋 {set.name}</span>
                            <span className="pill-badge">{set.questionCount} câu</span>
                            <span style={{ fontSize: '0.75rem', opacity: 0.75 }}>
                                ({set.mode === 'ENGLISH' ? '🇬🇧 EN' : '📚 Bloom'})
                            </span>
                        </button>
                    ))}
                </div>
            )}

            {/* Real-time Generation Progress */}
            {generateJob.isRunning && (
                <div className="exam-job-progress-box">
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                        <strong>
                            ⏳ {generateJob.jobStatus?.message || 'Đang sinh câu hỏi kiểm tra theo từng bài học...'}
                        </strong>
                        <span>{generateJob.jobStatus?.progress ?? 0}%</span>
                    </div>
                    <div className="exam-progress-bar">
                        <div
                            className="exam-progress-fill"
                            style={{ width: `${generateJob.jobStatus?.progress ?? 5}%` }}
                        />
                    </div>
                </div>
            )}

            {/* BUILDER VIEW */}
            {isCreateView && (
                <div className="exam-builder-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3 style={{ margin: 0, fontSize: '1.08rem', color: '#f8fafc' }}>
                            ⚙️ Cấu hình Tạo Bộ Câu Hỏi Kiểm Tra Mới (100% Grounded)
                        </h3>
                        {activeExamSet && (
                            <button
                                type="button"
                                className="btn-Exam-mini"
                                onClick={() => setIsCreateView(false)}
                            >
                                ← Quay lại xem đề "{activeExamSet.name}"
                            </button>
                        )}
                    </div>

                    {/* Name & Single Category Slug */}
                    <div className="exam-builder-grid">
                        <div className="exam-field">
                            <label>📝 Tên đợt / Bộ đề kiểm tra:</label>
                            <input
                                type="text"
                                className="exam-input"
                                value={examName}
                                onChange={(e) => {
                                    setExamName(e.target.value);
                                    if (!isCategoryTouched) {
                                        setCategoryName(toClientCategorySlug(e.target.value));
                                    }
                                }}
                                placeholder="VD: Kiểm tra Giữa kỳ - Bài 1 đến Bài 6"
                            />
                        </div>

                        <div className="exam-field">
                            <label>🏷️ Tên Category Moodle duy nhất (Gom 100% câu hỏi vào 1 Category):</label>
                            <input
                                type="text"
                                className="exam-input"
                                value={categoryName}
                                onChange={(e) => {
                                    setIsCategoryTouched(true);
                                    setCategoryName(e.target.value);
                                }}
                                placeholder="VD: Giua_Ky_Bai_1_6"
                            />
                            <span className="category-preview-hint">
                                Đường dẫn khi import Moodle XML:{' '}
                                <code>$course$/top/{toClientCategorySlug(categoryName || examName)}</code>
                            </span>
                        </div>
                    </div>

                    {/* Question Mode Toggle */}
                    <div className="exam-field">
                        <label>🎯 Chế độ & Cấu trúc Câu hỏi:</label>
                        <div className="exam-mode-toggle">
                            <button
                                type="button"
                                className={`exam-mode-btn ${questionMode === 'REVIEW' ? 'active' : ''}`}
                                onClick={() => setQuestionMode('REVIEW')}
                            >
                                <strong>📚 Trắc nghiệm Chuẩn Bloom (4 phương án A, B, C, D)</strong>
                                <span>
                                    Phân loại theo 3 mức độ: Biết (Mức 1) • Hiểu (Mức 2) • Vận dụng (Mức 3)
                                </span>
                            </button>
                            <button
                                type="button"
                                className={`exam-mode-btn ${questionMode === 'ENGLISH' ? 'active' : ''}`}
                                onClick={() => setQuestionMode('ENGLISH')}
                            >
                                <strong>🇬🇧 Chuyên sâu Tiếng Anh (5 dạng tự động chấm điểm)</strong>
                                <span>
                                    Hỗ trợ MC, MR, MATCH (Ghép cột), CLOZE (Điền khuyết), TRUE/FALSE
                                </span>
                            </button>
                        </div>
                    </div>

                    {/* Multi-Lesson Selector */}
                    <div className="exam-lessons-box">
                        <div className="exam-lessons-toolbar">
                            <div>
                                <strong style={{ fontSize: '0.93rem', color: '#f8fafc' }}>
                                    📚 Chọn các Bài học đã tạo nằm trong phạm vi Kiểm tra (
                                    {selectedLessonIds.length}/{lessons.length} bài đã chọn)
                                </strong>
                                <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: 2 }}>
                                    Đề kiểm tra được tạo theo từng bài đã chọn (chia đều số câu + lấy đủ nội
                                    dung &amp; ngân hàng câu hỏi của bài đó), tuyệt đối không lấn sang bài không chọn.
                                </div>
                            </div>

                            <div className="range-selector-group">
                                <span>Chọn nhanh từ:</span>
                                <select
                                    value={rangeFromOrder}
                                    onChange={(e) => setRangeFromOrder(Number(e.target.value))}
                                >
                                    {lessons.map((l) => (
                                        <option key={l.id} value={l.order}>
                                            {truncateText(getLessonDisplayTitle(l), 46)}
                                        </option>
                                    ))}
                                </select>
                                <span>đến</span>
                                <select
                                    value={rangeToOrder}
                                    onChange={(e) => setRangeToOrder(Number(e.target.value))}
                                >
                                    {lessons.map((l) => (
                                        <option key={l.id} value={l.order}>
                                            {truncateText(getLessonDisplayTitle(l), 46)}
                                        </option>
                                    ))}
                                </select>
                                <button type="button" className="btn-Exam-mini" onClick={handleSelectRange}>
                                    ✓ Áp dụng khoảng
                                </button>
                                <button
                                    type="button"
                                    className="btn-Exam-mini"
                                    onClick={() => setSelectedLessonIds(lessons.map((l) => l.id))}
                                >
                                    Chọn tất cả
                                </button>
                                <button
                                    type="button"
                                    className="btn-Exam-mini"
                                    onClick={() => setSelectedLessonIds([])}
                                >
                                    Bỏ chọn
                                </button>
                                <button
                                    type="button"
                                    className="btn-Exam-mini"
                                    disabled={isRefreshingLessons}
                                    onClick={() =>
                                        fetchOverviewAndSets(undefined, {
                                            preserveSelection: true,
                                            silentLoading: true,
                                        })
                                    }
                                    title="Tải lại danh sách bài học đã tạo từ Đề cương & Bài giảng"
                                >
                                    {isRefreshingLessons ? '⏳ Đang tải...' : '🔄 Làm mới DS bài'}
                                </button>
                            </div>
                        </div>

                        {lessons.length === 0 ? (
                            <div style={{ padding: '16px', color: '#94a3b8', textAlign: 'center' }}>
                                Môn học này chưa có bài học nào được tạo trong tab Đề cương hoặc Bài giảng. Vui
                                lòng tạo bài học trước khi tạo đề kiểm tra.
                            </div>
                        ) : (
                            <div className="exam-lessons-grid">
                                {lessons.map((lesson) => {
                                    const isChecked = selectedLessonIds.includes(lesson.id);
                                    const quotaVal = useCustomPerLessonQuota
                                        ? perLessonCounts[lesson.id] ?? autoQuotaByLessonId[lesson.id] ?? 0
                                        : autoQuotaByLessonId[lesson.id] ?? 0;
                                    const badges =
                                        lesson.sourceBadges && lesson.sourceBadges.length > 0
                                            ? lesson.sourceBadges
                                            : [];
                                    const bankTotal =
                                        lesson.questionBankTotal ??
                                        lesson.reviewQuestionCount +
                                            lesson.englishQuestionCount +
                                            (lesson.interactiveQuestionCount || 0);
                                    return (
                                        <div
                                            key={lesson.id}
                                            className={`exam-lesson-item ${isChecked ? 'checked' : ''} ${
                                                !lesson.hasContent ? 'disabled' : ''
                                            }`}
                                            onClick={() => toggleLessonSelection(lesson.id)}
                                        >
                                            <div className="exam-lesson-left">
                                                <input
                                                    type="checkbox"
                                                    checked={isChecked}
                                                    onChange={() => {}}
                                                    style={{ marginTop: 3 }}
                                                />
                                                <div>
                                                    <div className="exam-lesson-infoTitle">
                                                        {getLessonDisplayTitle(lesson)}
                                                    </div>
                                                    {badges.length > 0 ? (
                                                        <div className="exam-lesson-badges">
                                                            {badges.map((badge, bIdx) => (
                                                                <span
                                                                    key={bIdx}
                                                                    className={`exam-lesson-badge ${
                                                                        badge.startsWith('❓') ? 'bank' : ''
                                                                    }`}
                                                                >
                                                                    {badge}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <div className="exam-lesson-meta">
                                                            {lesson.hasContent ? (
                                                                <>
                                                                    📄 {lesson.contentSummary}
                                                                    {bankTotal > 0
                                                                        ? ` · Ngân hàng: ${bankTotal} câu`
                                                                        : ''}
                                                                </>
                                                            ) : (
                                                                <span className="exam-lesson-badge empty">
                                                                    ⚠️ Chưa có nội dung bài học
                                                                </span>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            {isChecked && (
                                                <div
                                                    onClick={(e) => e.stopPropagation()}
                                                    style={{
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        alignItems: 'flex-end',
                                                        gap: 2,
                                                    }}
                                                >
                                                    {useCustomPerLessonQuota ? (
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            max={100}
                                                            className="exam-lesson-quota-input"
                                                            value={quotaVal}
                                                            onChange={(e) =>
                                                                setPerLessonCounts((prev) => ({
                                                                    ...prev,
                                                                    [lesson.id]: Math.max(
                                                                        0,
                                                                        Number(e.target.value),
                                                                    ),
                                                                }))
                                                            }
                                                        />
                                                    ) : (
                                                        <span
                                                            style={{
                                                                fontSize: '0.78rem',
                                                                fontWeight: 700,
                                                                color: '#a5b4fc',
                                                                background: 'rgba(99, 102, 241, 0.2)',
                                                                padding: '2px 8px',
                                                                borderRadius: '999px',
                                                                whiteSpace: 'nowrap',
                                                            }}
                                                        >
                                                            +{quotaVal} câu
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        <div
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                flexWrap: 'wrap',
                                gap: 10,
                                paddingTop: 6,
                            }}
                        >
                            <label
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    fontSize: '0.84rem',
                                    color: '#cbd5e1',
                                    cursor: 'pointer',
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={useCustomPerLessonQuota}
                                    onChange={(e) => {
                                        const checked = e.target.checked;
                                        setUseCustomPerLessonQuota(checked);
                                        if (checked) {
                                            setPerLessonCounts(autoQuotaByLessonId);
                                        }
                                    }}
                                />
                                <span>Tùy chỉnh số câu hỏi riêng cho từng bài học</span>
                            </label>
                            <span style={{ fontSize: '0.85rem', color: '#38bdf8', fontWeight: 600 }}>
                                📊 Tổng cộng sẽ tạo mới: <strong>{totalRequestedQuestions} câu hỏi</strong> phân
                                bổ trên {selectedLessonIds.length} bài học
                            </span>
                        </div>
                    </div>

                    {/* Difficulty Counts */}
                    <div className="exam-levels-row">
                        <div className="exam-level-box">
                            <label>🟢 Mức 1 — Biết (Remember):</label>
                            <input
                                type="number"
                                min={0}
                                max={200}
                                className="exam-input"
                                value={level1Count}
                                onChange={(e) => setLevel1Count(Math.max(0, Number(e.target.value)))}
                            />
                        </div>
                        <div className="exam-level-box">
                            <label>🟡 Mức 2 — Hiểu (Understand):</label>
                            <input
                                type="number"
                                min={0}
                                max={200}
                                className="exam-input"
                                value={level2Count}
                                onChange={(e) => setLevel2Count(Math.max(0, Number(e.target.value)))}
                            />
                        </div>
                        <div className="exam-level-box">
                            <label>🟠 Mức 3 — Vận dụng (Apply):</label>
                            <input
                                type="number"
                                min={0}
                                max={200}
                                className="exam-input"
                                value={level3Count}
                                onChange={(e) => setLevel3Count(Math.max(0, Number(e.target.value)))}
                            />
                        </div>
                    </div>

                    {/* English Question Types */}
                    {questionMode === 'ENGLISH' && (
                        <div className="exam-field">
                            <label>🇬🇧 Chọn các dạng câu hỏi tự động chấm (Đã loại bỏ Essay & ShortAnswer):</label>
                            <div className="exam-qtype-pills">
                                {ENGLISH_Q_TYPES.map((qt) => (
                                    <button
                                        key={qt.id}
                                        type="button"
                                        className={`exam-qtype-pill ${
                                            selectedQTypes.includes(qt.id) ? 'active' : ''
                                        }`}
                                        onClick={() => toggleQuestionType(qt.id)}
                                    >
                                        {qt.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* AI Model & Custom Instructions */}
                    <div className="exam-builder-grid">
                        <div className="exam-field">
                            <ModelSelector
                                taskType="QUESTIONS"
                                label="🤖 Model AI biên soạn đề kiểm tra:"
                                onChange={(modelName) => setSelectedModelName(modelName)}
                            />
                        </div>
                        <div className="exam-field">
                            <label>💡 Yêu cầu bổ sung cho AI (Tùy chọn):</label>
                            <input
                                type="text"
                                className="exam-input"
                                value={customInstructions}
                                onChange={(e) => setCustomInstructions(e.target.value)}
                                placeholder="VD: Ưu tiên các câu hỏi tình huống thực tế hoặc ngữ pháp trọng tâm..."
                            />
                        </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                        <button
                            type="button"
                            className="btn-generate-exam"
                            disabled={generateJob.isRunning || selectedLessonIds.length === 0}
                            onClick={handleStartGenerate}
                        >
                            {generateJob.isRunning
                                ? '⏳ Đang tạo bộ câu hỏi kiểm tra...'
                                : `🚀 Tạo mới 100% (${totalRequestedQuestions} câu hỏi từ ${selectedLessonIds.length} bài học)`}
                        </button>
                    </div>
                </div>
            )}

            {/* VIEWER FOR ACTIVE EXAM SET */}
            {!isCreateView && activeExamSet && (
                <div className="exam-viewer-card">
                    <div className="exam-viewer-header">
                        <div>
                            <h3 style={{ margin: '0 0 6px 0', fontSize: '1.15rem', color: '#f8fafc' }}>
                                📋 {activeExamSet.name}
                            </h3>
                            <div style={{ fontSize: '0.84rem', color: '#94a3b8', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                                <span>
                                    Tổng số: <strong style={{ color: '#e2e8f0' }}>{activeExamSet.questions.length} câu hỏi</strong>
                                </span>
                                <span>•</span>
                                <span>
                                    Category Moodle duy nhất:{' '}
                                    <code style={{ color: '#38bdf8' }}>
                                        $course$/top/{activeExamSet.categoryName}
                                    </code>
                                </span>
                                <span>•</span>
                                <span>
                                    Chế độ:{' '}
                                    <strong>
                                        {activeExamSet.mode === 'ENGLISH'
                                            ? '🇬🇧 Tiếng Anh (5 dạng tự chấm)'
                                            : '📚 Trắc nghiệm Chuẩn Bloom'}
                                    </strong>
                                </span>
                            </div>
                        </div>

                        <div className="exam-export-actions">
                            <button
                                type="button"
                                className="btn-exam-action append"
                                disabled={generateJob.isRunning}
                                onClick={() => setShowAppendModal((prev) => !prev)}
                            >
                                ➕ Tạo thêm câu hỏi vào đề này
                            </button>
                            <button
                                type="button"
                                className="btn-exam-action moodle"
                                onClick={handleExportMoodleXml}
                            >
                                📥 Xuất Moodle XML (1 Category)
                            </button>
                            <button
                                type="button"
                                className="btn-exam-action excel"
                                onClick={handleExportExcel}
                            >
                                📊 Xuất Excel (.xlsx)
                            </button>
                            <button
                                type="button"
                                className="btn-exam-action danger"
                                onClick={() => setConfirmDeleteSetId(activeExamSet.id)}
                            >
                                🗑️ Xóa bộ đề
                            </button>
                        </div>
                    </div>

                    {/* Inline Append Panel */}
                    {showAppendModal && (
                        <div
                            style={{
                                background: 'rgba(30, 41, 59, 0.9)',
                                border: '1px solid #6366f1',
                                borderRadius: 10,
                                padding: 14,
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: 12,
                                alignItems: 'flex-end',
                            }}
                        >
                            <div>
                                <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: 4 }}>
                                    Mức 1 (Biết):
                                </label>
                                <input
                                    type="number"
                                    min={0}
                                    className="exam-input"
                                    style={{ width: 90 }}
                                    value={appendL1}
                                    onChange={(e) => setAppendL1(Math.max(0, Number(e.target.value)))}
                                />
                            </div>
                            <div>
                                <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: 4 }}>
                                    Mức 2 (Hiểu):
                                </label>
                                <input
                                    type="number"
                                    min={0}
                                    className="exam-input"
                                    style={{ width: 90 }}
                                    value={appendL2}
                                    onChange={(e) => setAppendL2(Math.max(0, Number(e.target.value)))}
                                />
                            </div>
                            <div>
                                <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: 4 }}>
                                    Mức 3 (Vận dụng):
                                </label>
                                <input
                                    type="number"
                                    min={0}
                                    className="exam-input"
                                    style={{ width: 90 }}
                                    value={appendL3}
                                    onChange={(e) => setAppendL3(Math.max(0, Number(e.target.value)))}
                                />
                            </div>
                            <button
                                type="button"
                                className="btn-generate-exam"
                                style={{ padding: '9px 16px', fontSize: '0.86rem' }}
                                onClick={handleStartAppend}
                            >
                                🚀 Sinh nối tiếp +{appendL1 + appendL2 + appendL3} câu
                            </button>
                            <button
                                type="button"
                                className="btn-Exam-mini"
                                onClick={() => setShowAppendModal(false)}
                            >
                                Hủy
                            </button>
                        </div>
                    )}

                    {/* Confirm Delete Set Bar */}
                    {confirmDeleteSetId === activeExamSet.id && (
                        <div
                            style={{
                                background: 'rgba(239, 68, 68, 0.16)',
                                border: '1px solid rgba(239, 68, 68, 0.5)',
                                borderRadius: 10,
                                padding: '12px 16px',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                flexWrap: 'wrap',
                                gap: 10,
                            }}
                        >
                            <span>
                                ⚠️ Bạn có chắc chắn muốn xóa vĩnh viễn bộ đề{' '}
                                <strong>{activeExamSet.name}</strong> ({activeExamSet.questions.length} câu)?
                            </span>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button
                                    type="button"
                                    className="btn-exam-action danger"
                                    onClick={handleConfirmDeleteExamSet}
                                >
                                    ✓ Xác nhận xóa
                                </button>
                                <button
                                    type="button"
                                    className="btn-Exam-mini"
                                    onClick={() => setConfirmDeleteSetId(null)}
                                >
                                    Hủy
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Filter Bar */}
                    <div className="exam-filter-bar">
                        <select
                            className="exam-select"
                            value={filterLessonId}
                            onChange={(e) => setFilterLessonId(e.target.value)}
                        >
                            <option value="ALL">
                                📚 Tất cả bài học nguồn ({activeExamSet.questions.length} câu)
                            </option>
                            {activeSetLessonOptions.map((opt) => (
                                <option key={opt.id} value={opt.id}>
                                    {opt.title} ({opt.count} câu)
                                </option>
                            ))}
                        </select>

                        <select
                            className="exam-select"
                            value={filterLevel}
                            onChange={(e) => setFilterLevel(e.target.value)}
                        >
                            <option value="ALL">🎯 Tất cả mức độ</option>
                            <option value="1">🟢 Mức 1 (Biết)</option>
                            <option value="2">🟡 Mức 2 (Hiểu)</option>
                            <option value="3">🟠 Mức 3 (Vận dụng)</option>
                        </select>

                        <input
                            type="text"
                            className="exam-input"
                            style={{ flex: 1, minWidth: 220 }}
                            placeholder="🔍 Tìm kiếm nội dung câu hỏi hoặc mục kiến thức..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    {/* Questions List */}
                    <div className="exam-questions-list">
                        {filteredQuestions.map(({ q, originalIndex }, displayIdx) => {
                            const levelNum = Number(q.level || q.difficulty || 1);
                            const isEditing = editingQuestionIdx === originalIndex;
                            const isEnglishItem = activeExamSet.mode === 'ENGLISH';

                            let parsedEngData: any = {};
                            if (isEnglishItem) {
                                try {
                                    parsedEngData =
                                        typeof q.dataJson === 'string'
                                            ? JSON.parse(q.dataJson)
                                            : q.dataJson || {};
                                } catch {
                                    parsedEngData = {};
                                }
                            }

                            return (
                                <div key={q.id || originalIndex} className="exam-q-card">
                                    <div className="exam-q-top">
                                        <div className="exam-q-badges">
                                            <strong style={{ color: '#f8fafc', fontSize: '0.86rem' }}>
                                                Câu {displayIdx + 1} ({q.questionId || q.title || `Q${originalIndex + 1}`})
                                            </strong>
                                            {q.sourceLessonTitle && (
                                                <span className="badge-source-lesson">
                                                    📍 {q.sourceLessonTitle}
                                                </span>
                                            )}
                                            {q.sourceSection && (
                                                <span className="badge-source-section">
                                                    📑 {q.sourceSection}
                                                </span>
                                            )}
                                            <span className={`badge-level l${levelNum}`}>
                                                {levelNum === 1
                                                    ? 'Mức 1: Biết'
                                                    : levelNum === 2
                                                    ? 'Mức 2: Hiểu'
                                                    : 'Mức 3: Vận dụng'}
                                            </span>
                                            {isEnglishItem && q.questionType && (
                                                <span className="badge-source-lesson">{q.questionType}</span>
                                            )}
                                        </div>

                                        <div style={{ display: 'flex', gap: 6 }}>
                                            {!isEditing ? (
                                                <>
                                                    <button
                                                        type="button"
                                                        className="btn-Exam-mini"
                                                        onClick={() => {
                                                            setEditingQuestionIdx(originalIndex);
                                                            setEditingQuestionDraft({ ...q });
                                                        }}
                                                    >
                                                        ✏️ Sửa
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="btn-Exam-mini"
                                                        onClick={() =>
                                                            handleDeleteQuestionFromSet(originalIndex)
                                                        }
                                                    >
                                                        🗑️ Xóa
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <button
                                                        type="button"
                                                        className="btn-Exam-mini"
                                                        onClick={() =>
                                                            handleSaveEditedQuestion(originalIndex)
                                                        }
                                                    >
                                                        💾 Lưu
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="btn-Exam-mini"
                                                        onClick={() => {
                                                            setEditingQuestionIdx(null);
                                                            setEditingQuestionDraft(null);
                                                        }}
                                                    >
                                                        Hủy
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    {isEditing && editingQuestionDraft ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                            <textarea
                                                className="exam-textarea"
                                                rows={2}
                                                value={
                                                    editingQuestionDraft.question ??
                                                    editingQuestionDraft.questionText ??
                                                    ''
                                                }
                                                onChange={(e) =>
                                                    setEditingQuestionDraft((prev: any) => ({
                                                        ...prev,
                                                        ...(isEnglishItem
                                                            ? { questionText: e.target.value }
                                                            : { question: e.target.value }),
                                                    }))
                                                }
                                            />
                                            {!isEnglishItem && (
                                                <div className="exam-q-options">
                                                    <input
                                                        type="text"
                                                        className="exam-input"
                                                        value={editingQuestionDraft.correctAnswer || ''}
                                                        onChange={(e) =>
                                                            setEditingQuestionDraft((prev: any) => ({
                                                                ...prev,
                                                                correctAnswer: e.target.value,
                                                            }))
                                                        }
                                                        placeholder="Đáp án đúng (A)"
                                                    />
                                                    <input
                                                        type="text"
                                                        className="exam-input"
                                                        value={editingQuestionDraft.optionB || ''}
                                                        onChange={(e) =>
                                                            setEditingQuestionDraft((prev: any) => ({
                                                                ...prev,
                                                                optionB: e.target.value,
                                                            }))
                                                        }
                                                        placeholder="Phương án nhiễu B"
                                                    />
                                                    <input
                                                        type="text"
                                                        className="exam-input"
                                                        value={editingQuestionDraft.optionC || ''}
                                                        onChange={(e) =>
                                                            setEditingQuestionDraft((prev: any) => ({
                                                                ...prev,
                                                                optionC: e.target.value,
                                                            }))
                                                        }
                                                        placeholder="Phương án nhiễu C"
                                                    />
                                                    <input
                                                        type="text"
                                                        className="exam-input"
                                                        value={editingQuestionDraft.optionD || ''}
                                                        onChange={(e) =>
                                                            setEditingQuestionDraft((prev: any) => ({
                                                                ...prev,
                                                                optionD: e.target.value,
                                                            }))
                                                        }
                                                        placeholder="Phương án nhiễu D"
                                                    />
                                                </div>
                                            )}
                                            <input
                                                type="text"
                                                className="exam-input"
                                                value={editingQuestionDraft.explanation || ''}
                                                onChange={(e) =>
                                                    setEditingQuestionDraft((prev: any) => ({
                                                        ...prev,
                                                        explanation: e.target.value,
                                                    }))
                                                }
                                                placeholder="Giải thích đáp án"
                                            />
                                        </div>
                                    ) : (
                                        <>
                                            <div className="exam-q-stem">
                                                {q.question || q.questionText}
                                            </div>

                                            {!isEnglishItem ? (
                                                <div className="exam-q-options">
                                                    <div className="exam-q-opt correct">
                                                        ✓ A. {q.correctAnswer}
                                                    </div>
                                                    <div className="exam-q-opt">B. {q.optionB}</div>
                                                    <div className="exam-q-opt">C. {q.optionC}</div>
                                                    <div className="exam-q-opt">D. {q.optionD}</div>
                                                </div>
                                            ) : (
                                                <div>
                                                    {Array.isArray(parsedEngData.options) && (
                                                        <div className="exam-q-options">
                                                            {parsedEngData.options.map(
                                                                (opt: any, oIdx: number) => (
                                                                    <div
                                                                        key={oIdx}
                                                                        className={`exam-q-opt ${
                                                                            Number(opt.fraction) > 0 ||
                                                                            opt.isCorrect
                                                                                ? 'correct'
                                                                                : ''
                                                                        }`}
                                                                    >
                                                                        {String.fromCharCode(65 + oIdx)}.{' '}
                                                                        {opt.text}
                                                                    </div>
                                                                ),
                                                            )}
                                                        </div>
                                                    )}
                                                    {Array.isArray(parsedEngData.pairs) && (
                                                        <div className="exam-q-options">
                                                            {parsedEngData.pairs.map(
                                                                (p: any, pIdx: number) => (
                                                                    <div key={pIdx} className="exam-q-opt correct">
                                                                        {p.left ?? p.subquestion} ➔{' '}
                                                                        {p.right ?? p.answer}
                                                                    </div>
                                                                ),
                                                            )}
                                                        </div>
                                                    )}
                                                    {(parsedEngData.clozeText || parsedEngData.rawCloze || q.questionType === 'CLOZE') && (
                                                        <div className="cloze-preview-box" style={{ marginTop: 6 }}>
                                                            {renderClozeVisual(String(parsedEngData.clozeText || parsedEngData.rawCloze || q.questionText || ''))}
                                                        </div>
                                                    )}
                                                    {parsedEngData.correctAnswer !== undefined && (
                                                        <div className="exam-q-opt correct">
                                                            Đáp án: {String(parsedEngData.correctAnswer)}
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {q.explanation && (
                                                <div className="exam-q-explanation">
                                                    💡 <strong>Giải thích:</strong> {q.explanation}
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
