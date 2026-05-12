import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { SyllabusBlock } from '../../lib/syllabus-api';
import { syllabusApi } from '../../lib/syllabus-api';

interface Props {
    block: SyllabusBlock;
    syllabusId: string;
    onSaved: (updated: SyllabusBlock) => void;
}

/** Labels for each block type */
const BLOCK_ICONS: Record<string, string> = {
    header: '🏛️',
    general_info: 'ℹ️',
    lecturers: '👨‍🏫',
    description: '📝',
    clo: '🎯',
    materials: '📚',
    student_tasks: '📋',
    assessment: '📊',
    content_detail: '📖',
    update_log: '🔄',
};

export function SyllabusBlockEditor({ block, syllabusId, onSaved }: Props) {
    const [isEditing, setIsEditing] = useState(false);
    const [content, setContent] = useState(block.content);
    const [title, setTitle] = useState(block.title);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');

    const icon = BLOCK_ICONS[block.blockType] || '📄';
    const hasContent = block.content.trim().length > 0;

    const handleSave = async () => {
        setIsSaving(true);
        setError('');
        try {
            const res = await syllabusApi.updateBlock(syllabusId, block.id, { title, content });
            onSaved(res.data);
            setIsEditing(false);
        } catch (err: any) {
            setError(err.response?.data?.message || 'Không thể lưu');
        } finally {
            setIsSaving(false);
        }
    };

    const handleCancel = () => {
        setContent(block.content);
        setTitle(block.title);
        setIsEditing(false);
        setError('');
    };

    return (
        <div className={`syllabus-block ${isEditing ? 'editing' : ''}`}>
            <div className="block-header">
                <div className="block-title-row">
                    <span className="block-icon">{icon}</span>
                    {isEditing ? (
                        <input
                            className="block-title-input"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="Tên mục..."
                        />
                    ) : (
                        <h3 className="block-title">{block.title}</h3>
                    )}
                    <span className="block-type-badge">{block.blockType}</span>
                </div>
                <div className="block-actions">
                    {isEditing ? (
                        <>
                            <button
                                className="btn-save"
                                onClick={handleSave}
                                disabled={isSaving}
                            >
                                {isSaving ? '⏳' : '💾'} Lưu
                            </button>
                            <button className="btn-cancel" onClick={handleCancel}>
                                ↩️ Hủy
                            </button>
                        </>
                    ) : (
                        <button className="btn-edit" onClick={() => setIsEditing(true)}>
                            ✏️ Sửa
                        </button>
                    )}
                </div>
            </div>

            {error && <div className="block-error">{error}</div>}

            <div className="block-body">
                {isEditing ? (
                    <textarea
                        className="block-content-editor"
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        placeholder="Nhập nội dung mục này..."
                        rows={8}
                    />
                ) : (
                    <div className="block-content-view">
                        {hasContent ? (
                            <div className="markdown-content block-markdown">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.content}</ReactMarkdown>
                            </div>
                        ) : (
                            <p className="block-empty">Chưa có nội dung. Nhấn ✏️ Sửa để thêm.</p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
