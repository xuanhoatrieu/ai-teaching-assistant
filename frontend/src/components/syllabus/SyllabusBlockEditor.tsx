import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { SyllabusBlock } from '../../lib/syllabus-api';
import { syllabusApi } from '../../lib/syllabus-api';
import { parseMarkdownTable, formatMarkdownTable } from '../../lib/markdown-table';

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

    // Table Editor States
    const [editorMode, setEditorMode] = useState<'markdown' | 'table'>('markdown');
    const [beforeText, setBeforeText] = useState('');
    const [afterText, setAfterText] = useState('');
    const [tableHeaders, setTableHeaders] = useState<string[]>([]);
    const [tableRows, setTableRows] = useState<string[][]>([]);

    // Sync content when block changes
    useEffect(() => {
        setContent(block.content);
        setTitle(block.title);
    }, [block]);

    const icon = BLOCK_ICONS[block.blockType] || '📄';
    const hasContent = block.content.trim().length > 0;

    const handleStartEdit = () => {
        const parsed = parseMarkdownTable(content);
        if (parsed) {
            setBeforeText(parsed.beforeText);
            setTableHeaders(parsed.headers);
            setTableRows(parsed.rows);
            setAfterText(parsed.afterText);
            setEditorMode('table');
        } else {
            setEditorMode('markdown');
        }
        setIsEditing(true);
    };

    const handleSwitchToMarkdown = () => {
        const serialized = formatMarkdownTable({
            beforeText,
            headers: tableHeaders,
            rows: tableRows,
            afterText,
        });
        setContent(serialized);
        setEditorMode('markdown');
    };

    const handleSwitchToTable = () => {
        const parsed = parseMarkdownTable(content);
        if (parsed) {
            setBeforeText(parsed.beforeText);
            setTableHeaders(parsed.headers);
            setTableRows(parsed.rows);
            setAfterText(parsed.afterText);
            setEditorMode('table');
        } else {
            alert('Nội dung hiện tại không chứa bảng Markdown hợp lệ hoặc bảng bị lỗi định dạng.');
        }
    };

    const handleCellChange = (rowIndex: number, colIndex: number, value: string) => {
        const updatedRows = [...tableRows];
        updatedRows[rowIndex] = [...updatedRows[rowIndex]];
        updatedRows[rowIndex][colIndex] = value;
        setTableRows(updatedRows);
    };

    const handleHeaderChange = (colIndex: number, value: string) => {
        const updatedHeaders = [...tableHeaders];
        updatedHeaders[colIndex] = value;
        setTableHeaders(updatedHeaders);
    };

    const addRow = () => {
        const newRow = Array(tableHeaders.length).fill('');
        setTableRows([...tableRows, newRow]);
    };

    const deleteRow = (rowIndex: number) => {
        setTableRows(tableRows.filter((_, i) => i !== rowIndex));
    };

    const addColumn = () => {
        const colName = window.prompt('Nhập tên cột mới:');
        if (colName && colName.trim()) {
            setTableHeaders([...tableHeaders, colName.trim()]);
            setTableRows(tableRows.map(row => [...row, '']));
        }
    };

    const deleteColumn = (colIndex: number) => {
        if (tableHeaders.length <= 1) {
            alert('Bảng phải có ít nhất 1 cột.');
            return;
        }
        if (window.confirm(`Bạn có chắc chắn muốn xóa cột "${tableHeaders[colIndex]}"?`)) {
            setTableHeaders(tableHeaders.filter((_, i) => i !== colIndex));
            setTableRows(tableRows.map(row => row.filter((_, i) => i !== colIndex)));
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        setError('');
        try {
            let finalContent = content;
            if (editorMode === 'table') {
                finalContent = formatMarkdownTable({
                    beforeText,
                    headers: tableHeaders,
                    rows: tableRows,
                    afterText,
                });
            }
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
                        <button className="btn-edit" onClick={handleStartEdit}>
                            ✏️ Sửa
                        </button>
                    )}
                </div>
            </div>

            {error && <div className="block-error">{error}</div>}

            <div className="block-body">
                {isEditing ? (
                    <div className="block-editor-container">
                        {/* Editor Mode Selector */}
                        <div className="editor-mode-selector">
                            <button 
                                type="button"
                                className={`btn-mode-toggle ${editorMode === 'table' ? 'active' : ''}`}
                                onClick={handleSwitchToTable}
                            >
                                🛠️ Chỉnh sửa dạng bảng trực quan
                            </button>
                            <button 
                                type="button"
                                className={`btn-mode-toggle ${editorMode === 'markdown' ? 'active' : ''}`}
                                onClick={handleSwitchToMarkdown}
                            >
                                📝 Chỉnh sửa dạng mã Markdown
                            </button>
                        </div>

                        {/* Editor Area */}
                        {editorMode === 'table' ? (
                            <div className="visual-table-editor-wrapper">
                                <div className="table-text-field">
                                    <label className="field-label">Văn bản phía trên bảng (Tiêu đề mục):</label>
                                    <input
                                        type="text"
                                        className="table-text-input"
                                        value={beforeText}
                                        onChange={(e) => setBeforeText(e.target.value)}
                                        placeholder="Nhập tiêu đề hoặc văn bản trước bảng..."
                                    />
                                </div>

                                <div className="table-editor-actions">
                                    <button type="button" className="btn-table-action" onClick={addRow}>
                                        ➕ Thêm hàng
                                    </button>
                                    <button type="button" className="btn-table-action" onClick={addColumn}>
                                        ➕ Thêm cột
                                    </button>
                                </div>

                                <div className="table-editor-scrollable">
                                    <table className="visual-table-editor-grid">
                                        <thead>
                                            <tr>
                                                {tableHeaders.map((header, colIndex) => (
                                                    <th key={colIndex}>
                                                        <div className="table-editor-header-cell">
                                                            <input
                                                                type="text"
                                                                className="table-editor-header-input"
                                                                value={header}
                                                                onChange={(e) => handleHeaderChange(colIndex, e.target.value)}
                                                            />
                                                            <button 
                                                                type="button"
                                                                className="btn-delete-col"
                                                                onClick={() => deleteColumn(colIndex)}
                                                                title="Xóa cột"
                                                            >
                                                                ✕
                                                            </button>
                                                        </div>
                                                    </th>
                                                ))}
                                                <th className="action-col-header">Xóa</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {tableRows.map((row, rowIndex) => (
                                                <tr key={rowIndex}>
                                                    {row.map((cell, colIndex) => (
                                                        <td key={colIndex}>
                                                            <textarea
                                                                className="table-editor-cell-textarea"
                                                                value={cell}
                                                                onChange={(e) => handleCellChange(rowIndex, colIndex, e.target.value)}
                                                                rows={2}
                                                                placeholder="Nhập nội dung ô..."
                                                            />
                                                        </td>
                                                    ))}
                                                    <td className="action-col-cell">
                                                        <button 
                                                            type="button"
                                                            className="btn-delete-row"
                                                            onClick={() => deleteRow(rowIndex)}
                                                            title="Xóa hàng"
                                                        >
                                                            🗑️
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="table-text-field" style={{ marginTop: '12px' }}>
                                    <label className="field-label">Văn bản phía dưới bảng (Lưu ý/Ghi chú):</label>
                                    <textarea
                                        className="table-text-textarea"
                                        value={afterText}
                                        onChange={(e) => setAfterText(e.target.value)}
                                        placeholder="Nhập văn bản sau bảng..."
                                        rows={2}
                                    />
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
