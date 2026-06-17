import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { syllabusApi } from '../../lib/syllabus-api';
import type { Syllabus, SyllabusBlock, TextbookStatus } from '../../lib/syllabus-api';
import { SyllabusBlockEditor } from './SyllabusBlockEditor';
import { ReferencePanel } from './ReferencePanel';
import { ModelSelector } from '../ModelSelector';
import './SyllabusPanel.css';

interface Props {
    subjectId: string;
}

export function SyllabusPanel({ subjectId }: Props) {
    const navigate = useNavigate();
    const [syllabus, setSyllabus] = useState<Syllabus | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [isImporting, setIsImporting] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [expandedLesson, setExpandedLesson] = useState<string | null>(null);
    const [editingTextbook, setEditingTextbook] = useState<{ id: string; content: string } | null>(null);
    const [numberOfLessons, setNumberOfLessons] = useState<string>('');
    const [theoryLessons, setTheoryLessons] = useState<string>('');
    const [practiceLessons, setPracticeLessons] = useState<string>('');
    const [generatingTextbookId, setGeneratingTextbookId] = useState<string | null>(null);
    const [proStatus, setProStatus] = useState<TextbookStatus | null>(null);
    const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
    const [editingTitleValue, setEditingTitleValue] = useState('');
    const [editingOutlineId, setEditingOutlineId] = useState<string | null>(null);
    const [editingOutlineValue, setEditingOutlineValue] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        loadSyllabus();
    }, [subjectId]);

    // Auto-calculate default number of lessons from general_info block
    useEffect(() => {
        if (syllabus && !numberOfLessons) {
            const infoBlock = syllabus.blocks.find(b => b.blockType === 'general_info');
            if (infoBlock && infoBlock.content) {
                // Look for patterns like "3 tín chỉ", "3 TC", "3 credits"
                const match = infoBlock.content.match(/(\d+)\s*(tín chỉ|tc|credit)/i);
                if (match && match[1]) {
                    const credits = parseInt(match[1]);
                    if (!isNaN(credits) && credits > 0) {
                        setNumberOfLessons((credits * 4).toString());
                    }
                }
            }
        }
    }, [syllabus]);

    const loadSyllabus = async () => {
        setIsLoading(true);
        try {
            const res = await syllabusApi.get(subjectId);
            setSyllabus(res.data);
        } catch (err: any) {
            setError('Không thể tải đề cương');
        } finally {
            setIsLoading(false);
        }
    };

    const handleCreate = async () => {
        setIsCreating(true);
        setError('');
        try {
            const res = await syllabusApi.create(subjectId);
            setSyllabus(res.data);
            setMessage({ type: 'success', text: '✅ Đã tạo đề cương với 10 mục mặc định!' });
        } catch (err: any) {
            setError(err.response?.data?.message || 'Không thể tạo đề cương');
        } finally {
            setIsCreating(false);
        }
    };

    const handleBlockSaved = (updated: SyllabusBlock) => {
        if (!syllabus) return;
        setSyllabus({
            ...syllabus,
            blocks: syllabus.blocks.map((b) => (b.id === updated.id ? updated : b)),
        });
        setMessage({ type: 'success', text: `✅ Đã lưu "${updated.title}"` });
        setTimeout(() => setMessage(null), 3000);
    };

    const handleImportDocx = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        // Reset input so same file can be re-selected
        if (fileInputRef.current) fileInputRef.current.value = '';

        setIsImporting(true);
        setError('');
        setMessage({ type: 'success', text: '⏳ Đang tải file lên... (MarkItDown → AI phân tích)' });
        try {
            // Update local status to importing
            setSyllabus(prev => prev ? { ...prev, status: 'importing' } : null);

            const res = await syllabusApi.importDocx(subjectId, file);
            setSyllabus(res.data);
            if (res.data?.status === 'importing') {
                setMessage({ type: 'success', text: '⏳ File đã tải lên thành công, AI đang phân tích đề cương...' });
            } else {
                setMessage({ type: 'success', text: `✅ Import thành công! Đã điền ${res.data?.blocks?.filter((b: any) => b.content?.trim()).length || 0}/10 mục.` });
            }
        } catch (err: any) {
            const msg = err.response?.data?.message || 'Import thất bại';
            setMessage({ type: 'error', text: `❌ ${msg}` });
            loadSyllabus();
        } finally {
            setIsImporting(false);
        }
    };

    const handleExportDocx = async () => {
        try {
            const res = await syllabusApi.exportDocx(subjectId);
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `De_cuong.docx`);
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (err) {
            setMessage({ type: 'error', text: 'Không thể xuất DOCX' });
        }
    };

    const handleGenerateLessons = async () => {
        if (!syllabus) return;
        if (syllabus.lessons.length > 0 && !confirm('Sẽ xóa các bài giảng hiện tại và tạo lại. Tiếp tục?')) return;
        setIsGenerating(true);
        setMessage({ type: 'success', text: '⏳ AI đang phân chia bài giảng từ đề cương...' });
        try {
            const num = numberOfLessons ? parseInt(numberOfLessons) : undefined;
            const theory = theoryLessons ? parseInt(theoryLessons) : undefined;
            const practice = practiceLessons ? parseInt(practiceLessons) : undefined;
            const res = await syllabusApi.generateLessons(syllabus.id, num, theory, practice);
            setMessage({ type: 'success', text: `✅ Đã tạo ${res.data.length} bài giảng!` });
            loadSyllabus();
        } catch (err: any) {
            setMessage({ type: 'error', text: `❌ ${err.response?.data?.message || 'Không thể phân chia bài'}` });
        } finally {
            setIsGenerating(false);
        }
    };

    const handleMoveLesson = async (index: number, direction: 'up' | 'down', e: React.MouseEvent) => {
        e.stopPropagation();
        if (!syllabus) return;

        const newLessons = [...syllabus.lessons];
        const targetIndex = direction === 'up' ? index - 1 : index + 1;

        if (targetIndex < 0 || targetIndex >= newLessons.length) return;

        // Swap
        const temp = newLessons[index];
        newLessons[index] = newLessons[targetIndex];
        newLessons[targetIndex] = temp;

        // Recalculate sortOrder for client view temporarily
        const updatedLessons = newLessons.map((l, idx) => ({ ...l, sortOrder: idx }));

        setSyllabus({
            ...syllabus,
            lessons: updatedLessons,
        });

        try {
            await syllabusApi.reorderLessons(syllabus.id, updatedLessons.map(l => l.id));
            setMessage({ type: 'success', text: '✅ Đã thay đổi thứ tự bài giảng' });
            setTimeout(() => setMessage(null), 3000);
        } catch {
            setMessage({ type: 'error', text: 'Không thể đổi thứ tự bài giảng' });
            loadSyllabus(); // Revert to server state
        }
    };

    // Polling for DOCX import status
    useEffect(() => {
        if (!syllabus || syllabus.status !== 'importing') return;

        const interval = setInterval(async () => {
            try {
                const res = await syllabusApi.get(subjectId);
                if (res.data) {
                    setSyllabus(res.data);
                    if (res.data.status !== 'importing') {
                        setMessage({ type: 'success', text: '✅ Import đề cương thành công!' });
                        setTimeout(() => setMessage(null), 5000);
                    }
                }
            } catch (err) {
                // Ignore polling errors
            }
        }, 3000);

        return () => clearInterval(interval);
    }, [syllabus, subjectId]);

    const handleClearLessons = async () => {
        if (!syllabus) return;
        if (!confirm('Xóa tất cả bài giảng đã tạo?')) return;
        try {
            await syllabusApi.clearLessons(syllabus.id);
            loadSyllabus();
            setMessage({ type: 'success', text: '🗑️ Đã xóa tất cả bài giảng.' });
        } catch {
            setMessage({ type: 'error', text: 'Không thể xóa' });
        }
    };

    const handleCreateBridge = async (sl: { id: string; title: string; lessonId: string | null }) => {
        if (!syllabus) return;
        if (sl.lessonId) return;
        try {
            const res = await syllabusApi.createLessonBridge(syllabus.id, sl.id);
            setMessage({ type: 'success', text: `✅ Đã tạo bài giảng "${sl.title}"` });
            loadSyllabus();
            // Navigate to the new lesson editor
            const lessonData = res.data as any;
            if (lessonData?.lesson?.id) {
                navigate(`/lessons/${lessonData.lesson.id}`);
            }
        } catch (err: any) {
            setMessage({ type: 'error', text: `❌ ${err.response?.data?.message || 'Không thể tạo bài giảng'}` });
        }
    };



    const handleGenerateTextbookPro = async (sl: { id: string; title: string }) => {
        if (!syllabus) return;
        setGeneratingTextbookId(sl.id);
        setProStatus({ phase: 'extracting', status: 'generating', progress: 10, message: 'Trích xuất tài liệu tham khảo...' });
        setMessage({ type: 'success', text: `🚀 Đang tạo textbook PRO (5 bước) cho "${sl.title}"...` });

        // Start polling
        const pollInterval = setInterval(async () => {
            try {
                const res = await syllabusApi.getTextbookStatus(syllabus.id, sl.id);
                setProStatus(res.data);
                if (res.data.phase === 'done' || res.data.phase === 'error') {
                    clearInterval(pollInterval);
                }
            } catch { /* ignore poll errors */ }
        }, 3000);

        try {
            await syllabusApi.generateTextbookPro(syllabus.id, sl.id);
            setMessage({ type: 'success', text: `✅ Textbook PRO "${sl.title}" đã sẵn sàng!` });
            loadSyllabus();
        } catch (err: any) {
            setMessage({ type: 'error', text: `❌ ${err.response?.data?.message || 'Lỗi tạo textbook Pro'}` });
            loadSyllabus();
        } finally {
            clearInterval(pollInterval);
            setGeneratingTextbookId(null);
            setProStatus(null);
        }
    };

    const handleSaveTextbook = async () => {
        if (!syllabus || !editingTextbook) return;
        try {
            await syllabusApi.saveTextbookContent(syllabus.id, editingTextbook.id, editingTextbook.content);
            // Update local state to avoid reload and scroll-to-top
            setSyllabus(prev => {
                if (!prev) return prev;
                return {
                    ...prev,
                    lessons: prev.lessons.map(l =>
                        l.id === editingTextbook.id ? { ...l, textbookContent: editingTextbook.content } : l,
                    ),
                };
            });
            setMessage({ type: 'success', text: '✅ Đã lưu textbook' });
            setEditingTextbook(null);
        } catch {
            setMessage({ type: 'error', text: 'Lỗi lưu textbook' });
        }
    };

    const handleExportTextbookDocx = async () => {
        try {
            const res = await syllabusApi.exportTextbookDocx(subjectId);
            const blob = new Blob([res.data as any]);
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', 'Giao_trinh.docx');
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch {
            setMessage({ type: 'error', text: 'Không thể xuất giáo trình DOCX' });
        }
    };

    const handleExportSingleLessonDocx = async (sl: { id: string; title: string; sortOrder: number }) => {
        if (!syllabus) return;
        try {
            const res = await syllabusApi.exportSingleLessonDocx(syllabus.id, sl.id);
            const blob = new Blob([res.data as any]);
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            const paddedNum = String(sl.sortOrder + 1).padStart(2, '0');
            const safeName = sl.title.replace(/[/\\?%*:|"<>]/g, '_').substring(0, 50);
            link.href = url;
            link.setAttribute('download', `Bai_${paddedNum}_${safeName}.docx`);
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch {
            setMessage({ type: 'error', text: 'Không thể xuất DOCX cho bài này' });
        }
    };

    const handleSaveTitle = async (sl: { id: string }) => {
        if (!syllabus || !editingTitleId) return;
        try {
            await syllabusApi.updateLesson(syllabus.id, sl.id, { title: editingTitleValue });
            // Update local state to avoid reload and scroll-to-top
            setSyllabus(prev => {
                if (!prev) return prev;
                return {
                    ...prev,
                    lessons: prev.lessons.map(l => l.id === sl.id ? { ...l, title: editingTitleValue } : l),
                };
            });
            setEditingTitleId(null);
            setMessage({ type: 'success', text: '✅ Đã lưu tên bài' });
        } catch {
            setMessage({ type: 'error', text: 'Không thể lưu tên bài' });
        }
    };

    const handleSaveOutline = async (sl: { id: string }) => {
        if (!syllabus || !editingOutlineId) return;
        try {
            await syllabusApi.updateLesson(syllabus.id, sl.id, { outline: editingOutlineValue });
            // Update local state to avoid reload and scroll-to-top
            setSyllabus(prev => {
                if (!prev) return prev;
                return {
                    ...prev,
                    lessons: prev.lessons.map(l => l.id === sl.id ? { ...l, outline: editingOutlineValue } : l),
                };
            });
            setEditingOutlineId(null);
            setMessage({ type: 'success', text: '✅ Đã lưu nội dung bài' });
        } catch {
            setMessage({ type: 'error', text: 'Không thể lưu nội dung' });
        }
    };

    /** Format Bài 01, Bài 02, ... */
    const formatLessonOrder = (sortOrder: number) => {
        return `Bài ${String(sortOrder + 1).padStart(2, '0')}`;
    };

    /** Strip duplicate "Bài X:" prefix from title */
    const cleanTitle = (title: string) => {
        return title.replace(/^Bài\s*\d+\s*[:.\-]\s*/i, '');
    };

    if (isLoading) {
        return (
            <div className="syllabus-panel">
                <div className="syllabus-loading">
                    <span className="spinner">⏳</span> Đang tải đề cương...
                </div>
            </div>
        );
    }

    if (!syllabus) {
        return (
            <div className="syllabus-panel">
                <div className="syllabus-empty">
                    <span className="empty-icon">📋</span>
                    <h3>Chưa có đề cương</h3>
                    <p>Tạo đề cương chi tiết cho học phần này theo mẫu TUAF 2026.</p>
                    {error && <div className="error-text">{error}</div>}
                    <div className="syllabus-empty-actions">
                        <button
                            className="primary-btn"
                            onClick={handleCreate}
                            disabled={isCreating || isImporting}
                        >
                            {isCreating ? '⏳ Đang tạo...' : '📋 Tạo đề cương trống'}
                        </button>
                        <button
                            className="primary-btn import-btn"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isCreating || isImporting}
                        >
                            {isImporting ? '⏳ Đang import...' : '📄 Import từ DOCX'}
                        </button>
                    </div>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".docx"
                        onChange={handleImportDocx}
                        style={{ display: 'none' }}
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="syllabus-panel">
            {/* Header */}
            <div className="syllabus-header">
                <div className="syllabus-header-left">
                    <h3>📋 Đề cương chi tiết</h3>
                    <span className={`status-badge status-${syllabus.status}`}>
                        {syllabus.status === 'draft' ? '📝 Bản nháp' : '✅ Hoàn thành'}
                    </span>
                </div>
                <div className="syllabus-header-actions">
                    <button
                        className="btn-import"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isImporting}
                    >
                        {isImporting ? '⏳ Đang import...' : '📄 Import DOCX'}
                    </button>
                    <button
                        className="btn-export"
                        onClick={handleExportDocx}
                    >
                        📥 Xuất đề cương DOCX
                    </button>
                    <button
                        className="btn-export"
                        onClick={handleExportTextbookDocx}
                        style={{ background: 'rgba(76, 175, 80, 0.12)', borderColor: 'rgba(76, 175, 80, 0.25)', color: '#81c784' }}
                    >
                        📗 Xuất giáo trình DOCX
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".docx"
                        onChange={handleImportDocx}
                        style={{ display: 'none' }}
                    />
                </div>
            </div>

            {/* Model Selection */}
            <div className="syllabus-model-config" style={{ display: 'flex', gap: '1rem', padding: '1rem', backgroundColor: 'var(--bg-card)', borderRadius: '8px', marginBottom: '1rem', border: '1px solid var(--border-color)', flexWrap: 'wrap' }}>
                <ModelSelector taskType="OUTLINE" label="🧠 Model sinh Nội dung (Đề cương & Textbook)" compact />
                <ModelSelector taskType="IMAGE" label="🖼️ Model tạo Ảnh minh họa" compact />
            </div>

            {/* Messages */}
            {message && (
                <div className={`syllabus-message ${message.type}`}>
                    {message.text}
                </div>
            )}
            {error && <div className="syllabus-message error">{error}</div>}

            {/* Blocks */}
            <div className="syllabus-blocks">
                {syllabus.blocks.map((block) => (
                    <SyllabusBlockEditor
                        key={block.id}
                        block={block}
                        syllabusId={syllabus.id}
                        onSaved={handleBlockSaved}
                    />
                ))}
            </div>

            {/* References */}
            <ReferencePanel
                syllabusId={syllabus.id}
                references={syllabus.references}
                onUpdated={loadSyllabus}
            />

            {/* Lessons section */}
            <div className="syllabus-lessons-section">
                <div className="ref-header">
                    <h4>📖 Bài giảng từ đề cương ({syllabus.lessons.length})</h4>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <div className="lesson-count-input">
                            <label>Số bài LT</label>
                            <input 
                                type="number" 
                                style={{ width: '60px', padding: '0.35rem 0.5rem', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', background: 'rgba(255,255,255,0.06)', color: '#f1f5f9', textAlign: 'center' }}
                                value={theoryLessons}
                                onChange={(e) => setTheoryLessons(e.target.value)}
                                min={0}
                                placeholder="Tự động"
                            />
                        </div>
                        <div className="lesson-count-input">
                            <label>Số bài TH/TL</label>
                            <input 
                                type="number" 
                                style={{ width: '60px', padding: '0.35rem 0.5rem', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', background: 'rgba(255,255,255,0.06)', color: '#f1f5f9', textAlign: 'center' }}
                                value={practiceLessons}
                                onChange={(e) => setPracticeLessons(e.target.value)}
                                min={0}
                                placeholder="Tự động"
                            />
                        </div>
                        <div className="lesson-count-input">
                            <label>Tổng số bài</label>
                            <input 
                                type="number" 
                                style={{ width: '60px', padding: '0.35rem 0.5rem', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', background: 'rgba(255,255,255,0.06)', color: '#f1f5f9', textAlign: 'center', opacity: theoryLessons || practiceLessons ? 0.5 : 1 }}
                                value={numberOfLessons}
                                onChange={(e) => setNumberOfLessons(e.target.value)}
                                min={1}
                                disabled={!!(theoryLessons || practiceLessons)}
                            />
                        </div>
                        <button
                            className="btn-import"
                            onClick={handleGenerateLessons}
                            disabled={isGenerating}
                        >
                            {isGenerating ? '⏳ AI đang phân chia...' : '🤖 AI phân chia bài'}
                        </button>
                    </div>
                    {syllabus.lessons.length > 0 && (
                        <button
                            className="ref-delete-btn"
                            onClick={handleClearLessons}
                            title="Xóa tất cả"
                            style={{ fontSize: '0.85rem', opacity: 0.6 }}
                        >
                            🗑️ Xóa
                        </button>
                    )}
                </div>

                {syllabus.lessons.length === 0 ? (
                    <p className="ref-empty">
                        Chưa có bài giảng. Nhấn "🤖 AI phân chia bài" để AI tự động chia đề cương thành các bài giảng.
                    </p>
                ) : (
                    <div className="syllabus-lessons-list">
                        {syllabus.lessons.map((sl, idx) => (
                            <div
                                key={sl.id}
                                className={`syllabus-lesson-card ${expandedLesson === sl.id ? 'expanded' : ''}`}
                                onClick={() => setExpandedLesson(expandedLesson === sl.id ? null : sl.id)}
                            >
                                <div className="lesson-card-header">
                                    <div className="lesson-reorder-controls" onClick={(e) => e.stopPropagation()}>
                                        <button
                                            disabled={idx === 0}
                                            onClick={(e) => handleMoveLesson(idx, 'up', e)}
                                            title="Di chuyển lên"
                                        >
                                            ▲
                                        </button>
                                        <button
                                            disabled={idx === syllabus.lessons.length - 1}
                                            onClick={(e) => handleMoveLesson(idx, 'down', e)}
                                            title="Di chuyển xuống"
                                        >
                                            ▼
                                        </button>
                                    </div>
                                    <span className="lesson-order">{formatLessonOrder(sl.sortOrder)}</span>
                                    {editingTitleId === sl.id ? (
                                        <>
                                            <input
                                                className="lesson-title-input"
                                                value={editingTitleValue}
                                                onChange={(e) => setEditingTitleValue(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') handleSaveTitle(sl);
                                                    if (e.key === 'Escape') setEditingTitleId(null);
                                                }}
                                                onClick={(e) => e.stopPropagation()}
                                                autoFocus
                                            />
                                            <button className="btn-inline-save" onClick={(e) => { e.stopPropagation(); handleSaveTitle(sl); }}>💾</button>
                                            <button className="btn-inline-cancel" onClick={(e) => { e.stopPropagation(); setEditingTitleId(null); }}>✖</button>
                                        </>
                                    ) : (
                                        <>
                                            <span className="lesson-title">{cleanTitle(sl.title)}</span>
                                            <button
                                                className="btn-inline-edit"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setEditingTitleId(sl.id);
                                                    setEditingTitleValue(cleanTitle(sl.title));
                                                }}
                                                title="Sửa tên bài"
                                            >✏️</button>
                                        </>
                                    )}
                                    {sl.lessonId && (
                                        <span className="lesson-linked">🔗 Đã tạo</span>
                                    )}
                                    {sl.textbookContent && (
                                        <button
                                            className="btn-quick-download"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleExportSingleLessonDocx(sl);
                                            }}
                                            title="Tải nhanh giáo trình DOCX"
                                        >
                                            📥
                                        </button>
                                    )}
                                    <span className="lesson-expand">{expandedLesson === sl.id ? '▲' : '▼'}</span>
                                    {sl.textbookStatus === 'done' && <span className="lesson-tb-badge done">📗</span>}
                                    {sl.textbookStatus === 'generating' && <span className="lesson-tb-badge gen">⏳</span>}
                                    {sl.textbookStatus === 'error' && <span className="lesson-tb-badge err">⚠️</span>}
                                </div>
                                {expandedLesson === sl.id && (
                                    <div className="lesson-outline-preview" onClick={(e) => e.stopPropagation()}>
                                        {editingOutlineId === sl.id ? (
                                            <div className="outline-edit-area">
                                                <textarea
                                                    className="textbook-textarea"
                                                    value={editingOutlineValue}
                                                    onChange={(e) => setEditingOutlineValue(e.target.value)}
                                                    rows={12}
                                                />
                                                <div className="textbook-edit-actions">
                                                    <button className="btn-bridge btn-create" onClick={() => handleSaveOutline(sl)}>💾 Lưu nội dung</button>
                                                    <button className="btn-bridge btn-open" onClick={() => setEditingOutlineId(null)}>Hủy</button>
                                                </div>
                                            </div>
                                        ) : (
                                            <>
                                                <div className="markdown-content">
                                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{sl.outline || ''}</ReactMarkdown>
                                                </div>
                                                <button
                                                    className="btn-bridge btn-open" style={{ margin: '0.5rem 0' }}
                                                    onClick={() => { setEditingOutlineId(sl.id); setEditingOutlineValue(sl.outline || ''); }}
                                                >✏️ Sửa nội dung thô</button>
                                            </>
                                        )}
                                        <div className="syllabus-lesson-actions">
                                            {sl.lessonId ? (
                                                <button
                                                    className="btn-bridge btn-open"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        navigate(`/lessons/${sl.lessonId}`);
                                                    }}
                                                >
                                                    📝 Mở bài giảng
                                                </button>
                                            ) : (
                                                <button
                                                    className="btn-bridge btn-create"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleCreateBridge(sl);
                                                    }}
                                                >
                                                    ➕ Tạo bài giảng
                                                </button>
                                            )}
                                            <button
                                                className={`btn-bridge btn-pro ${sl.textbookStatus === 'done' ? 'btn-open' : 'btn-create'} ${generatingTextbookId === sl.id ? 'btn-generating' : ''}`}
                                                disabled={generatingTextbookId === sl.id || sl.textbookStatus === 'generating'}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleGenerateTextbookPro(sl);
                                                }}
                                                title="Tạo textbook 5 bước: trích xuất ref → plan → viết → minh họa → review"
                                            >
                                                {generatingTextbookId === sl.id
                                                    ? '⏳ Đang xử lý...'
                                                    : sl.textbookStatus === 'done'
                                                        ? '🔄 Tạo lại textbook PRO'
                                                        : '🚀 Tạo textbook PRO'}
                                            </button>
                                            {/* Progress bar for Pro mode */}
                                            {generatingTextbookId === sl.id && proStatus && (
                                                <div className="textbook-pro-progress">
                                                    <div className="pro-progress-bar">
                                                        <div className="pro-progress-fill" style={{ width: `${proStatus.progress}%` }} />
                                                    </div>
                                                    <span className="pro-progress-text">{proStatus.message}</span>
                                                </div>
                                            )}
                                            {sl.textbookContent && (
                                                <button
                                                    className="btn-bridge btn-export"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleExportSingleLessonDocx(sl);
                                                    }}
                                                >
                                                    📥 Xuất DOCX
                                                </button>
                                            )}
                                        </div>
                                        {generatingTextbookId === sl.id && (
                                            <div className="textbook-generating-indicator">
                                                <div className="generating-spinner" />
                                                <span>AI đang tạo nội dung textbook... Quá trình này có thể mất 1-3 phút.</span>
                                            </div>
                                        )}
                                        {sl.textbookContent && (
                                            <details className="textbook-preview">
                                                <summary>📖 Xem/sửa textbook ({Math.round(sl.textbookContent.length / 1000)}k ký tự)</summary>
                                                {editingTextbook?.id === sl.id ? (
                                                    <div className="textbook-edit-area">
                                                        <textarea
                                                            className="textbook-textarea"
                                                            value={editingTextbook.content}
                                                            onChange={(e) => setEditingTextbook({ id: sl.id, content: e.target.value })}
                                                            rows={15}
                                                        />
                                                        <div className="textbook-edit-actions">
                                                            <button className="btn-bridge btn-create" onClick={handleSaveTextbook}>💾 Lưu</button>
                                                            <button className="btn-bridge btn-open" onClick={() => setEditingTextbook(null)}>Hủy</button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div>
                                                        <div className="markdown-content textbook-markdown">
                                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{sl.textbookContent}</ReactMarkdown>
                                                        </div>
                                                        <button
                                                            className="btn-bridge btn-open"
                                                            style={{ margin: '0.5rem 0.75rem' }}
                                                            onClick={() => setEditingTextbook({ id: sl.id, content: sl.textbookContent! })}
                                                        >
                                                            ✏️ Chỉnh sửa Markdown
                                                        </button>
                                                    </div>
                                                )}
                                            </details>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
