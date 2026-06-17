import { useState, useRef, useEffect } from 'react';
import { syllabusApi } from '../../lib/syllabus-api';
import type { SyllabusReference } from '../../lib/syllabus-api';

interface Props {
    syllabusId: string;
    references: SyllabusReference[];
    onUpdated: () => void;
}

const STATUS_MAP: Record<string, { icon: string; label: string }> = {
    pending: { icon: '⏳', label: 'Chờ xử lý' },
    processing: { icon: '⚙️', label: 'Đang xử lý' },
    done: { icon: '✅', label: 'Hoàn thành' },
    error: { icon: '❌', label: 'Lỗi' },
};

function formatFileSize(bytes: number | null): string {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ReferencePanel({ syllabusId, references, onUpdated }: Props) {
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const hasProcessing = references.some(
            (ref) => ref.status === 'processing' || ref.status === 'pending'
        );
        if (!hasProcessing) return;

        const interval = setInterval(() => {
            onUpdated();
        }, 3000);

        return () => clearInterval(interval);
    }, [references, onUpdated]);

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (fileInputRef.current) fileInputRef.current.value = '';

        setIsUploading(true);
        setError('');
        try {
            await syllabusApi.uploadReference(syllabusId, file);
            onUpdated();
        } catch (err: any) {
            setError(err.response?.data?.message || 'Upload thất bại');
        } finally {
            setIsUploading(false);
        }
    };

    const handleDelete = async (refId: string, fileName: string) => {
        if (!confirm(`Xóa tài liệu "${fileName}"?`)) return;
        try {
            await syllabusApi.deleteReference(syllabusId, refId);
            onUpdated();
        } catch {
            setError('Không thể xóa');
        }
    };

    return (
        <div className="reference-panel">
            <div className="ref-header">
                <h4>📚 Tài liệu tham khảo ({references.length})</h4>
                <button
                    className="btn-import"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                >
                    {isUploading ? '⏳ Đang upload...' : '📎 Thêm tài liệu'}
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".docx,.pdf,.pptx,.xlsx,.txt,.md"
                    onChange={handleUpload}
                    style={{ display: 'none' }}
                />
            </div>

            {error && <div className="syllabus-message error">{error}</div>}

            {references.length === 0 ? (
                <p className="ref-empty">
                    Chưa có tài liệu. Upload tài liệu tham khảo (DOCX, PDF, PPTX...) để AI sử dụng khi tạo bài giảng.
                </p>
            ) : (
                <div className="ref-list">
                    {references.map((ref) => {
                        const status = STATUS_MAP[ref.status] || STATUS_MAP.pending;
                        return (
                            <div key={ref.id} className="ref-item">
                                <div className="ref-info">
                                    <span className="ref-name">{ref.fileName}</span>
                                    <span className="ref-meta">
                                        {formatFileSize(ref.fileSize)} • {status.icon} {status.label}
                                    </span>
                                </div>
                                <button
                                    className="ref-delete-btn"
                                    onClick={() => handleDelete(ref.id, ref.fileName)}
                                    title="Xóa"
                                >
                                    🗑️
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
