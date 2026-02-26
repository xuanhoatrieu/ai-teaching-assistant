import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import './TTSDictionaryManager.css';

interface DictEntry {
    id: string;
    type: string;
    original: string;
    replacement: string;
    scope: string;
    userId: string | null;
    createdAt: string;
}

export function TTSDictionaryManager() {
    const [entries, setEntries] = useState<DictEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [filterType, setFilterType] = useState<string>('all');
    const [searchTerm, setSearchTerm] = useState('');

    // Form state
    const [showForm, setShowForm] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);
    const [formType, setFormType] = useState('acronym');
    const [formOriginal, setFormOriginal] = useState('');
    const [formReplacement, setFormReplacement] = useState('');

    // CSV import state
    const [showCsvImport, setShowCsvImport] = useState(false);
    const [csvType, setCsvType] = useState('acronym');
    const [csvContent, setCsvContent] = useState('');

    useEffect(() => {
        loadEntries();
    }, []);

    const loadEntries = async () => {
        try {
            setIsLoading(true);
            const response = await api.get('/admin/tts-dictionaries');
            setEntries(response.data);
        } catch (error) {
            console.error('Error loading TTS dictionaries:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSubmit = async () => {
        if (!formOriginal.trim() || !formReplacement.trim()) return;

        try {
            if (editId) {
                await api.put(`/admin/tts-dictionaries/${editId}`, {
                    original: formOriginal.trim(),
                    replacement: formReplacement.trim(),
                });
            } else {
                await api.post('/admin/tts-dictionaries', {
                    type: formType,
                    original: formOriginal.trim(),
                    replacement: formReplacement.trim(),
                });
            }
            resetForm();
            await loadEntries();
        } catch (error: any) {
            const msg = error?.response?.data?.message || 'Lỗi khi lưu từ điển';
            alert(msg);
        }
    };

    const handleDelete = async (id: string, original: string) => {
        if (!confirm(`Xóa "${original}" khỏi từ điển hệ thống?`)) return;
        try {
            await api.delete(`/admin/tts-dictionaries/${id}`);
            await loadEntries();
        } catch (error) {
            console.error('Error deleting entry:', error);
            alert('Lỗi khi xóa');
        }
    };

    const handleEdit = (entry: DictEntry) => {
        setEditId(entry.id);
        setFormType(entry.type);
        setFormOriginal(entry.original);
        setFormReplacement(entry.replacement);
        setShowForm(true);
    };

    const resetForm = () => {
        setShowForm(false);
        setEditId(null);
        setFormType('acronym');
        setFormOriginal('');
        setFormReplacement('');
    };

    const handleCsvImport = async () => {
        if (!csvContent.trim()) return;
        try {
            const result = await api.post('/admin/tts-dictionaries/import-csv', {
                type: csvType,
                csvContent: csvContent.trim(),
            });
            alert(`Import xong: ${result.data.created} mục, ${result.data.skipped} bỏ qua`);
            setCsvContent('');
            setShowCsvImport(false);
            await loadEntries();
        } catch (error) {
            console.error('Error importing CSV:', error);
            alert('Lỗi import CSV');
        }
    };

    const handleExportCsv = async () => {
        try {
            const response = await api.get('/admin/tts-dictionaries/export-csv', {
                responseType: 'blob',
            });
            const blob = new Blob([response.data], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'tts-dictionaries-system.csv';
            a.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Error exporting CSV:', error);
        }
    };

    const filteredEntries = entries.filter((e) => {
        const matchesType = filterType === 'all' || e.type === filterType;
        const matchesSearch =
            !searchTerm ||
            e.original.toLowerCase().includes(searchTerm.toLowerCase()) ||
            e.replacement.toLowerCase().includes(searchTerm.toLowerCase());
        return matchesType && matchesSearch;
    });

    if (isLoading) {
        return <div className="dict-loading">Đang tải từ điển TTS...</div>;
    }

    return (
        <div className="dict-manager">
            <div className="dict-header">
                <div className="dict-header-left">
                    <h3>📖 Từ Điển TTS Hệ Thống</h3>
                    <span className="dict-count">{entries.length} mục</span>
                </div>
                <div className="dict-header-actions">
                    <button className="dict-btn dict-btn-add" onClick={() => setShowForm(true)}>
                        ➕ Thêm
                    </button>
                    <button className="dict-btn dict-btn-import" onClick={() => setShowCsvImport(!showCsvImport)}>
                        📥 Import CSV
                    </button>
                    <button className="dict-btn dict-btn-export" onClick={handleExportCsv}>
                        📤 Export CSV
                    </button>
                </div>
            </div>

            {/* CSV Import */}
            {showCsvImport && (
                <div className="dict-csv-section">
                    <div className="dict-csv-row">
                        <select value={csvType} onChange={(e) => setCsvType(e.target.value)}>
                            <option value="acronym">Viết tắt (acronym)</option>
                            <option value="word">Từ nước ngoài (word)</option>
                        </select>
                        <button className="dict-btn dict-btn-primary" onClick={handleCsvImport}>
                            Import
                        </button>
                        <button className="dict-btn dict-btn-cancel" onClick={() => setShowCsvImport(false)}>
                            Hủy
                        </button>
                    </div>
                    <textarea
                        className="dict-csv-textarea"
                        value={csvContent}
                        onChange={(e) => setCsvContent(e.target.value)}
                        placeholder={`original,replacement\nCPU,xê pê u\nRAM,ram`}
                        rows={5}
                    />
                </div>
            )}

            {/* Add/Edit Form */}
            {showForm && (
                <div className="dict-form">
                    <h4>{editId ? '✏️ Sửa' : '➕ Thêm mới'}</h4>
                    <div className="dict-form-row">
                        <select value={formType} onChange={(e) => setFormType(e.target.value)} disabled={!!editId}>
                            <option value="acronym">Viết tắt</option>
                            <option value="word">Từ nước ngoài</option>
                        </select>
                        <input
                            type="text"
                            value={formOriginal}
                            onChange={(e) => setFormOriginal(e.target.value)}
                            placeholder="Từ gốc (vd: CPU)"
                        />
                        <span className="dict-arrow">→</span>
                        <input
                            type="text"
                            value={formReplacement}
                            onChange={(e) => setFormReplacement(e.target.value)}
                            placeholder="Phát âm (vd: xê pê u)"
                        />
                        <button className="dict-btn dict-btn-primary" onClick={handleSubmit}>
                            {editId ? '💾 Lưu' : '➕ Thêm'}
                        </button>
                        <button className="dict-btn dict-btn-cancel" onClick={resetForm}>
                            Hủy
                        </button>
                    </div>
                </div>
            )}

            {/* Search & Filter */}
            <div className="dict-filters">
                <input
                    type="text"
                    className="dict-search"
                    placeholder="🔍 Tìm kiếm..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
                <div className="dict-type-filter">
                    <button className={`dict-filter-btn ${filterType === 'all' ? 'active' : ''}`} onClick={() => setFilterType('all')}>
                        Tất cả
                    </button>
                    <button className={`dict-filter-btn ${filterType === 'acronym' ? 'active' : ''}`} onClick={() => setFilterType('acronym')}>
                        Viết tắt
                    </button>
                    <button className={`dict-filter-btn ${filterType === 'word' ? 'active' : ''}`} onClick={() => setFilterType('word')}>
                        Từ nước ngoài
                    </button>
                </div>
            </div>

            {/* Entries Table */}
            <div className="dict-table-container">
                <table className="dict-table">
                    <thead>
                        <tr>
                            <th>Loại</th>
                            <th>Từ gốc</th>
                            <th>Phát âm</th>
                            <th>Hành động</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredEntries.map((entry) => (
                            <tr key={entry.id}>
                                <td>
                                    <span className={`dict-type-tag ${entry.type}`}>
                                        {entry.type === 'acronym' ? 'VT' : 'TN'}
                                    </span>
                                </td>
                                <td className="dict-original">{entry.original}</td>
                                <td className="dict-replacement">{entry.replacement}</td>
                                <td className="dict-actions-cell">
                                    <button className="dict-action-btn edit" onClick={() => handleEdit(entry)} title="Sửa">
                                        ✏️
                                    </button>
                                    <button className="dict-action-btn delete" onClick={() => handleDelete(entry.id, entry.original)} title="Xóa">
                                        🗑️
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {filteredEntries.length === 0 && (
                            <tr>
                                <td colSpan={4} className="dict-empty">
                                    {searchTerm ? 'Không tìm thấy kết quả' : 'Chưa có mục nào'}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
