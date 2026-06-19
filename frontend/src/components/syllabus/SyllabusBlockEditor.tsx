import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { SyllabusBlock } from '../../lib/syllabus-api';
import { syllabusApi } from '../../lib/syllabus-api';
import {
    parseSegments,
    serializeSegments,
    getCellSpan,
    type Segment,
    type TableSegment,
} from '../../lib/markdown-table';

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

    // Structured editing: ordered list of text/table segments.
    const [segments, setSegments] = useState<Segment[]>([]);
    const [viewMode, setViewMode] = useState<'structured' | 'raw'>('structured');

    // Sync when block changes
    useEffect(() => {
        setContent(block.content);
        setTitle(block.title);
    }, [block]);

    const icon = BLOCK_ICONS[block.blockType] || '📄';
    const hasContent = block.content.trim().length > 0;

    const handleStartEdit = () => {
        setSegments(parseSegments(content));
        setViewMode('structured');
        setIsEditing(true);
    };

    const handleSwitchToRaw = () => {
        setContent(serializeSegments(segments));
        setViewMode('raw');
    };

    const handleSwitchToStructured = () => {
        setSegments(parseSegments(content));
        setViewMode('structured');
    };

    const handleSave = async () => {
        setIsSaving(true);
        setError('');
        try {
            const finalContent = viewMode === 'structured' ? serializeSegments(segments) : content;
            const res = await syllabusApi.updateBlock(syllabusId, block.id, { title, content: finalContent });
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

    // ---- Segment-level operations ----
    const updateTable = (segIndex: number, updater: (t: TableSegment) => TableSegment) =>
        setSegments((prev) => prev.map((s, i) => (i === segIndex && s.type === 'table' ? updater(s) : s)));

    const updateText = (segIndex: number, text: string) =>
        setSegments((prev) => prev.map((s, i) => (i === segIndex && s.type === 'text' ? { ...s, text } : s)));

    const deleteSegment = (segIndex: number) => {
        if (!window.confirm('Xóa mục này khỏi nội dung?')) return;
        setSegments((prev) => prev.filter((_, i) => i !== segIndex));
    };

    const addTextSegment = () =>
        setSegments((prev) => [...prev, { type: 'text', text: '' }]);

    const addTableSegment = () =>
        setSegments((prev) => [...prev, { type: 'table', headers: ['Cột 1', 'Cột 2'], rows: [['', '']] }]);

    // ---- Table cell / structure operations (operate on segments[segIndex]) ----
    const handleCellChange = (segIndex: number, r: number, c: number, value: string) =>
        updateTable(segIndex, (t) => ({
            ...t,
            rows: t.rows.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? value : cell)) : row)),
        }));

    const handleHeaderChange = (segIndex: number, c: number, value: string) =>
        updateTable(segIndex, (t) => ({
            ...t,
            headers: t.headers.map((h, ci) => (ci === c ? value : h)),
        }));

    const addRow = (segIndex: number) =>
        updateTable(segIndex, (t) => ({ ...t, rows: [...t.rows, Array(t.headers.length).fill('')] }));

    const deleteRow = (segIndex: number, r: number) =>
        updateTable(segIndex, (t) => ({ ...t, rows: t.rows.filter((_, i) => i !== r) }));

    const addColumn = (segIndex: number) => {
        const colName = window.prompt('Nhập tên cột mới:');
        if (colName === null) return;
        updateTable(segIndex, (t) => ({
            ...t,
            headers: [...t.headers, colName.trim()],
            rows: t.rows.map((row) => [...row, '']),
        }));
    };

    const deleteColumn = (segIndex: number, c: number) => {
        const seg = segments[segIndex];
        if (seg?.type !== 'table') return;
        if (seg.headers.length <= 1) {
            alert('Bảng phải có ít nhất 1 cột.');
            return;
        }
        if (!window.confirm(`Xóa cột "${seg.headers[c] || c + 1}"?`)) return;
        updateTable(segIndex, (t) => ({
            ...t,
            headers: t.headers.filter((_, i) => i !== c),
            rows: t.rows.map((row) => row.filter((_, i) => i !== c)),
        }));
    };

    const mergeRight = (segIndex: number, r: number, c: number) => {
        const seg = segments[segIndex];
        if (seg?.type !== 'table') return;
        const span = getCellSpan(seg.rows, r, c);
        const target = c + span.colSpan;
        if (target >= (seg.rows[0]?.length || 0)) {
            alert('Không thể gộp sang phải ngoài phạm vi bảng.');
            return;
        }
        updateTable(segIndex, (t) => ({
            ...t,
            rows: t.rows.map((row, ri) =>
                ri >= r && ri < r + span.rowSpan ? row.map((cell, ci) => (ci === target ? '>' : cell)) : row,
            ),
        }));
    };

    const mergeDown = (segIndex: number, r: number, c: number) => {
        const seg = segments[segIndex];
        if (seg?.type !== 'table') return;
        const span = getCellSpan(seg.rows, r, c);
        const target = r + span.rowSpan;
        if (target >= seg.rows.length) {
            alert('Không thể gộp xuống dưới ngoài phạm vi bảng.');
            return;
        }
        updateTable(segIndex, (t) => ({
            ...t,
            rows: t.rows.map((row, ri) => {
                if (ri !== target) return row;
                return row.map((cell, ci) => {
                    if (ci === c) return '^';
                    if (ci > c && ci < c + span.colSpan) return '>';
                    return cell;
                });
            }),
        }));
    };

    const splitCell = (segIndex: number, r: number, c: number) => {
        const seg = segments[segIndex];
        if (seg?.type !== 'table') return;
        const span = getCellSpan(seg.rows, r, c);
        if (span.colSpan === 1 && span.rowSpan === 1) return;
        updateTable(segIndex, (t) => ({
            ...t,
            rows: t.rows.map((row, ri) => {
                if (ri < r || ri >= r + span.rowSpan) return row;
                return row.map((cell, ci) => {
                    if (ri === r && ci === c) return cell;
                    if (ci >= c && ci < c + span.colSpan) return '';
                    return cell;
                });
            }),
        }));
    };

    // ---- Render: one table editor grid ----
    const renderTableEditor = (seg: TableSegment, segIndex: number) => {
        const allHeadersEmpty = seg.headers.every((h) => h.trim() === '');
        return (
            <div className="visual-table-editor-wrapper">
                <div className="table-editor-actions">
                    <button type="button" className="btn-table-action" onClick={() => addRow(segIndex)}>
                        ➕ Thêm hàng
                    </button>
                    <button type="button" className="btn-table-action" onClick={() => addColumn(segIndex)}>
                        ➕ Thêm cột
                    </button>
                    {allHeadersEmpty && (
                        <span className="empty-header-hint">Bảng này không có tiêu đề cột</span>
                    )}
                </div>
                <div className="table-editor-scrollable">
                    <table className="visual-table-editor-grid">
                        <thead>
                            <tr>
                                <th className="action-col-header">Xóa</th>
                                {seg.headers.map((header, colIndex) => (
                                    <th key={colIndex}>
                                        <div className="table-editor-header-cell">
                                            <input
                                                type="text"
                                                className="table-editor-header-input"
                                                value={header}
                                                placeholder="(không có tiêu đề cột)"
                                                onChange={(e) => handleHeaderChange(segIndex, colIndex, e.target.value)}
                                            />
                                            <button
                                                type="button"
                                                className="btn-delete-col"
                                                onClick={() => deleteColumn(segIndex, colIndex)}
                                                title="Xóa cột"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {seg.rows.map((row, rowIndex) => (
                                <tr key={rowIndex}>
                                    <td className="action-col-cell">
                                        <button
                                            type="button"
                                            className="btn-delete-row"
                                            onClick={() => deleteRow(segIndex, rowIndex)}
                                            title="Xóa hàng"
                                        >
                                            🗑️
                                        </button>
                                    </td>
                                    {row.map((cell, colIndex) => {
                                        const span = getCellSpan(seg.rows, rowIndex, colIndex);
                                        if (span.isMerged) return null;
                                        const showMergeRight = colIndex + span.colSpan < (seg.rows[0]?.length || 0);
                                        const showMergeDown = rowIndex + span.rowSpan < seg.rows.length;
                                        const isMergedCell = span.colSpan > 1 || span.rowSpan > 1;
                                        return (
                                            <td key={colIndex} colSpan={span.colSpan} rowSpan={span.rowSpan}>
                                                <div className="table-editor-cell-wrapper">
                                                    <textarea
                                                        className="table-editor-cell-textarea"
                                                        value={cell}
                                                        onChange={(e) => handleCellChange(segIndex, rowIndex, colIndex, e.target.value)}
                                                        rows={Math.max(2, span.rowSpan * 2)}
                                                        placeholder="Nhập nội dung ô..."
                                                    />
                                                    <div className="cell-merge-toolbar">
                                                        {showMergeRight && (
                                                            <button type="button" className="btn-merge-action" onClick={() => mergeRight(segIndex, rowIndex, colIndex)} title="Gộp ô sang phải">➡️</button>
                                                        )}
                                                        {showMergeDown && (
                                                            <button type="button" className="btn-merge-action" onClick={() => mergeDown(segIndex, rowIndex, colIndex)} title="Gộp ô xuống dưới">⬇️</button>
                                                        )}
                                                        {isMergedCell && (
                                                            <button type="button" className="btn-merge-action btn-split" onClick={() => splitCell(segIndex, rowIndex, colIndex)} title="Hủy gộp ô">🔓</button>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    // ---- Render: one table in view (read-only) mode ----
    const renderTableView = (seg: TableSegment, key: number) => (
        <div className="table-responsive" key={key}>
            <table className="custom-syllabus-table">
                <thead>
                    <tr>
                        {seg.headers.map((header, i) => (
                            <th key={i}>
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{header}</ReactMarkdown>
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {seg.rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                            {row.map((cell, colIndex) => {
                                const span = getCellSpan(seg.rows, rowIndex, colIndex);
                                if (span.isMerged) return null;
                                return (
                                    <td key={colIndex} colSpan={span.colSpan} rowSpan={span.rowSpan}>
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{cell || ' '}</ReactMarkdown>
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );

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
                            <button className="btn-save" onClick={handleSave} disabled={isSaving}>
                                {isSaving ? '⏳' : '💾'} Lưu
                            </button>
                            <button className="btn-cancel" onClick={handleCancel}>↩️ Hủy</button>
                        </>
                    ) : (
                        <button className="btn-edit" onClick={handleStartEdit}>✏️ Sửa</button>
                    )}
                </div>
            </div>

            {error && <div className="block-error">{error}</div>}

            <div className="block-body">
                {isEditing ? (
                    <div className="block-editor-container">
                        {/* PLACEHOLDER_EDIT_BODY */}
                        <div className="editor-mode-selector">
                            <button
                                type="button"
                                className={`btn-mode-toggle ${viewMode === 'structured' ? 'active' : ''}`}
                                onClick={handleSwitchToStructured}
                            >
                                📊 Soạn thảo trực quan
                            </button>
                            <button
                                type="button"
                                className={`btn-mode-toggle ${viewMode === 'raw' ? 'active' : ''}`}
                                onClick={handleSwitchToRaw}
                            >
                                📝 Mã Markdown
                            </button>
                        </div>

                        {viewMode === 'structured' ? (
                            <div className="segment-list">
                                {segments.map((seg, segIndex) => (
                                    <div className="segment-item" key={segIndex}>
                                        <div className="segment-toolbar">
                                            <span className="segment-label">
                                                {seg.type === 'table' ? '📊 Bảng' : '📝 Đoạn văn'}
                                            </span>
                                            <button
                                                type="button"
                                                className="btn-delete-segment"
                                                onClick={() => deleteSegment(segIndex)}
                                                title="Xóa mục này"
                                            >
                                                🗑️ Xóa mục
                                            </button>
                                        </div>
                                        {seg.type === 'table' ? (
                                            renderTableEditor(seg, segIndex)
                                        ) : (
                                            <textarea
                                                className="table-text-textarea"
                                                value={seg.text}
                                                onChange={(e) => updateText(segIndex, e.target.value)}
                                                placeholder="Nhập nội dung văn bản..."
                                                rows={Math.max(3, seg.text.split('\n').length)}
                                            />
                                        )}
                                    </div>
                                ))}
                                {segments.length === 0 && (
                                    <p className="block-empty">Mục này chưa có nội dung. Thêm đoạn văn hoặc bảng bên dưới.</p>
                                )}
                                <div className="segment-add-actions">
                                    <button type="button" className="btn-table-action" onClick={addTextSegment}>
                                        ➕ Thêm đoạn văn
                                    </button>
                                    <button type="button" className="btn-table-action" onClick={addTableSegment}>
                                        ➕ Thêm bảng
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <textarea
                                className="block-content-editor"
                                value={content}
                                onChange={(e) => setContent(e.target.value)}
                                placeholder="Nhập nội dung mục này..."
                                rows={15}
                            />
                        )}
                    </div>
                ) : (
                    <div className="block-content-view">
                        {hasContent ? (
                            <div className="segment-list">
                                {parseSegments(block.content).map((seg, i) =>
                                    seg.type === 'table' ? (
                                        renderTableView(seg, i)
                                    ) : (
                                        <div className="markdown-content block-markdown" key={i}>
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{seg.text}</ReactMarkdown>
                                        </div>
                                    ),
                                )}
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
