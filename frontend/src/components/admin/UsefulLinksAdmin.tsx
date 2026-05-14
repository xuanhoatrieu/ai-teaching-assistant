import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import './UsefulLinksAdmin.css';

interface UsefulLink {
    id: string;
    title: string;
    url: string;
    icon: string;
    description: string | null;
    sortOrder: number;
    isActive: boolean;
}

const EMOJI_OPTIONS = ['🔗', '📄', '🎥', '🎧', '📊', '🧰', '🌐', '📝', '📚', '🎓', '💡', '🔍', '📦', '⚡', '🎯'];

export function UsefulLinksAdmin() {
    const [links, setLinks] = useState<UsefulLink[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [editingLink, setEditingLink] = useState<UsefulLink | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [formData, setFormData] = useState({ title: '', url: '', icon: '🔗', description: '', sortOrder: 0 });
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        loadLinks();
    }, []);

    const loadLinks = async () => {
        try {
            setIsLoading(true);
            const res = await api.get('/admin/useful-links');
            setLinks(res.data || []);
        } catch (err) {
            console.error('Failed to load useful links:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSave = async () => {
        if (!formData.title.trim() || !formData.url.trim()) return;
        setIsSaving(true);
        try {
            if (editingLink) {
                await api.put(`/admin/useful-links/${editingLink.id}`, formData);
            } else {
                await api.post('/admin/useful-links', formData);
            }
            setShowForm(false);
            setEditingLink(null);
            setFormData({ title: '', url: '', icon: '🔗', description: '', sortOrder: 0 });
            await loadLinks();
        } catch (err) {
            console.error('Failed to save link:', err);
            alert('Lỗi khi lưu link');
        } finally {
            setIsSaving(false);
        }
    };

    const handleEdit = (link: UsefulLink) => {
        setEditingLink(link);
        setFormData({
            title: link.title,
            url: link.url,
            icon: link.icon,
            description: link.description || '',
            sortOrder: link.sortOrder,
        });
        setShowForm(true);
    };

    const handleDelete = async (link: UsefulLink) => {
        if (!confirm(`Xóa "${link.title}"?`)) return;
        try {
            await api.delete(`/admin/useful-links/${link.id}`);
            await loadLinks();
        } catch (err) {
            console.error('Failed to delete link:', err);
            alert('Lỗi khi xóa link');
        }
    };

    const handleToggleActive = async (link: UsefulLink) => {
        try {
            await api.put(`/admin/useful-links/${link.id}`, { isActive: !link.isActive });
            await loadLinks();
        } catch (err) {
            console.error('Failed to toggle link:', err);
        }
    };

    const handleCancel = () => {
        setShowForm(false);
        setEditingLink(null);
        setFormData({ title: '', url: '', icon: '🔗', description: '', sortOrder: 0 });
    };

    return (
        <div className="settings-section useful-links-section">
            <div className="section-header-row">
                <h2>🧰 Công cụ hữu ích</h2>
                <button className="primary-btn small" onClick={() => { handleCancel(); setShowForm(true); }}>
                    + Thêm Link
                </button>
            </div>
            <p className="section-desc">Quản lý danh sách link công cụ hiển thị cho user trên thanh điều hướng.</p>

            {showForm && (
                <div className="link-form">
                    <h3>{editingLink ? '✏️ Sửa link' : '➕ Thêm link mới'}</h3>
                    <div className="form-row">
                        <div className="form-group icon-picker">
                            <label>Icon</label>
                            <div className="emoji-grid">
                                {EMOJI_OPTIONS.map(e => (
                                    <button
                                        key={e}
                                        type="button"
                                        className={`emoji-btn ${formData.icon === e ? 'active' : ''}`}
                                        onClick={() => setFormData(f => ({ ...f, icon: e }))}
                                    >{e}</button>
                                ))}
                            </div>
                        </div>
                        <div className="form-group" style={{ flex: 2 }}>
                            <label>Tiêu đề *</label>
                            <input
                                type="text"
                                value={formData.title}
                                onChange={e => setFormData(f => ({ ...f, title: e.target.value }))}
                                placeholder="PDF Converter"
                            />
                        </div>
                        <div className="form-group" style={{ flex: 1 }}>
                            <label>Thứ tự</label>
                            <input
                                type="number"
                                value={formData.sortOrder}
                                onChange={e => setFormData(f => ({ ...f, sortOrder: parseInt(e.target.value) || 0 }))}
                            />
                        </div>
                    </div>
                    <div className="form-group">
                        <label>URL *</label>
                        <input
                            type="url"
                            value={formData.url}
                            onChange={e => setFormData(f => ({ ...f, url: e.target.value }))}
                            placeholder="https://pdf.hoclieu.id.vn"
                        />
                    </div>
                    <div className="form-group">
                        <label>Mô tả</label>
                        <input
                            type="text"
                            value={formData.description}
                            onChange={e => setFormData(f => ({ ...f, description: e.target.value }))}
                            placeholder="Chuyển đổi PDF sang các định dạng khác"
                        />
                    </div>
                    <div className="form-actions">
                        <button className="primary-btn" onClick={handleSave} disabled={isSaving || !formData.title || !formData.url}>
                            {isSaving ? 'Đang lưu...' : editingLink ? 'Cập nhật' : 'Thêm'}
                        </button>
                        <button className="secondary-btn" onClick={handleCancel}>Hủy</button>
                    </div>
                </div>
            )}

            {isLoading ? (
                <p>Đang tải...</p>
            ) : links.length === 0 ? (
                <p className="empty-state">Chưa có link nào. Nhấn "Thêm Link" để bắt đầu.</p>
            ) : (
                <table className="links-table">
                    <thead>
                        <tr>
                            <th style={{ width: 40 }}>#</th>
                            <th style={{ width: 40 }}></th>
                            <th>Tiêu đề</th>
                            <th>URL</th>
                            <th style={{ width: 80 }}>Trạng thái</th>
                            <th style={{ width: 120 }}>Thao tác</th>
                        </tr>
                    </thead>
                    <tbody>
                        {links.map((link) => (
                            <tr key={link.id} className={!link.isActive ? 'inactive-row' : ''}>
                                <td>{link.sortOrder}</td>
                                <td className="link-icon">{link.icon}</td>
                                <td>
                                    <strong>{link.title}</strong>
                                    {link.description && <br />}
                                    {link.description && <small className="text-muted">{link.description}</small>}
                                </td>
                                <td className="link-url">
                                    <a href={link.url} target="_blank" rel="noopener noreferrer">{link.url}</a>
                                </td>
                                <td>
                                    <button
                                        className={`toggle-btn ${link.isActive ? 'active' : ''}`}
                                        onClick={() => handleToggleActive(link)}
                                        title={link.isActive ? 'Ẩn khỏi user' : 'Hiện cho user'}
                                    >
                                        {link.isActive ? '✅' : '⬜'}
                                    </button>
                                </td>
                                <td className="actions-cell">
                                    <button className="edit-btn" onClick={() => handleEdit(link)} title="Sửa">✏️</button>
                                    <button className="delete-btn" onClick={() => handleDelete(link)} title="Xóa">🗑️</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}
