import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import './UserTTSDictionary.css';

interface DictEntry {
    id: string;
    type: string;
    original: string;
    replacement: string;
    scope: string;
    userId: string | null;
}

export function UserTTSDictionary() {
    const [systemEntries, setSystemEntries] = useState<DictEntry[]>([]);
    const [userEntries, setUserEntries] = useState<DictEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    // Form state
    const [showForm, setShowForm] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);
    const [formType, setFormType] = useState('acronym');
    const [formOriginal, setFormOriginal] = useState('');
    const [formReplacement, setFormReplacement] = useState('');

    useEffect(() => {
        loadEntries();
    }, []);

    const loadEntries = async () => {
        try {
            setIsLoading(true);
            const response = await api.get('/tts-dictionaries');
            setSystemEntries(response.data.system || []);
            setUserEntries(response.data.user || []);
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
                await api.put(`/tts-dictionaries/${editId}`, {
                    original: formOriginal.trim(),
                    replacement: formReplacement.trim(),
                });
            } else {
                await api.post('/tts-dictionaries', {
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
        if (!confirm(`Xóa "${original}" khỏi từ điển cá nhân?`)) return;
        try {
            await api.delete(`/tts-dictionaries/${id}`);
            await loadEntries();
        } catch (error) {
            console.error('Error deleting entry:', error);
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

    const filterEntries = (entries: DictEntry[]) =>
        entries.filter(
            (e) =>
                !searchTerm ||
                e.original.toLowerCase().includes(searchTerm.toLowerCase()) ||
                e.replacement.toLowerCase().includes(searchTerm.toLowerCase()),
        );

    if (isLoading) {
        return <div className="user-dict-loading">Đang tải từ điển TTS...</div>;
    }

    return (
        <div className="user-dict">
            <div className="user-dict-header">
                <div className="user-dict-header-left">
                    <h3>📖 Từ Điển TTS Cá Nhân</h3>
                    <span className="user-dict-count">
                        {userEntries.length} cá nhân + {systemEntries.length} hệ thống
                    </span>
                </div>
                <button className="dict-btn dict-btn-add" onClick={() => setShowForm(true)}>
                    ➕ Thêm từ
                </button>
            </div>

            {/* Add/Edit Form */}
            {showForm && (
                <div className="user-dict-form">
                    <h4>{editId ? '✏️ Sửa' : '➕ Thêm từ mới'}</h4>
                    <p className="user-dict-form-hint">
                        Nếu từ đã có trong từ điển hệ thống, bạn không thể thêm lại.
                    </p>
                    <div className="user-dict-form-row">
                        <select value={formType} onChange={(e) => setFormType(e.target.value)} disabled={!!editId}>
                            <option value="acronym">Viết tắt</option>
                            <option value="word">Từ nước ngoài</option>
                        </select>
                        <input
                            type="text"
                            value={formOriginal}
                            onChange={(e) => setFormOriginal(e.target.value)}
                            placeholder="Từ gốc"
                        />
                        <span className="dict-arrow">→</span>
                        <input
                            type="text"
                            value={formReplacement}
                            onChange={(e) => setFormReplacement(e.target.value)}
                            placeholder="Phát âm TTS"
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

            {/* Search */}
            <input
                type="text"
                className="user-dict-search"
                placeholder="🔍 Tìm kiếm từ..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
            />

            {/* User Entries */}
            {userEntries.length > 0 && (
                <div className="user-dict-section">
                    <h4 className="section-label">✏️ Từ điển cá nhân ({userEntries.length})</h4>
                    <div className="user-dict-list">
                        {filterEntries(userEntries).map((entry) => (
                            <div key={entry.id} className="user-dict-item editable">
                                <span className={`dict-type-tag ${entry.type}`}>
                                    {entry.type === 'acronym' ? 'VT' : 'TN'}
                                </span>
                                <span className="user-dict-original">{entry.original}</span>
                                <span className="dict-arrow">→</span>
                                <span className="user-dict-replacement">{entry.replacement}</span>
                                <div className="user-dict-item-actions">
                                    <button onClick={() => handleEdit(entry)} title="Sửa">✏️</button>
                                    <button onClick={() => handleDelete(entry.id, entry.original)} title="Xóa">🗑️</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* System Entries (readonly) */}
            <div className="user-dict-section">
                <h4 className="section-label">🔒 Từ điển hệ thống ({systemEntries.length})</h4>
                <p className="section-hint">Được admin quản lý, áp dụng cho tất cả người dùng.</p>
                <div className="user-dict-list">
                    {filterEntries(systemEntries).map((entry) => (
                        <div key={entry.id} className="user-dict-item readonly">
                            <span className={`dict-type-tag ${entry.type}`}>
                                {entry.type === 'acronym' ? 'VT' : 'TN'}
                            </span>
                            <span className="user-dict-original">{entry.original}</span>
                            <span className="dict-arrow">→</span>
                            <span className="user-dict-replacement">{entry.replacement}</span>
                            <span className="readonly-badge">🔒</span>
                        </div>
                    ))}
                    {filterEntries(systemEntries).length === 0 && (
                        <div className="user-dict-empty">
                            {searchTerm ? 'Không tìm thấy' : 'Chưa có từ điển hệ thống'}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
