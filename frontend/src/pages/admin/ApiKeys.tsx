import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import './AdminPage.css';

interface ApiKey {
    id: string;
    name: string;
    service: 'GEMINI' | 'GOOGLE_CLOUD_TTS' | 'IMAGEN';
    hasKey: boolean;
    createdAt: string;
    updatedAt: string;
}

const SERVICE_OPTIONS = [
    { value: 'GEMINI', label: 'Gemini AI', icon: '🤖' },
    { value: 'GOOGLE_CLOUD_TTS', label: 'Google Cloud TTS', icon: '🔊' },
    { value: 'IMAGEN', label: 'Imagen (Image Gen)', icon: '🖼️' },
];

export function ApiKeysPage() {
    const [keys, setKeys] = useState<ApiKey[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [editingKey, setEditingKey] = useState<ApiKey | null>(null);
    const [formData, setFormData] = useState<{
        name: string;
        service: 'GEMINI' | 'GOOGLE_CLOUD_TTS' | 'IMAGEN';
        key: string;
    }>({
        name: '',
        service: 'GEMINI',
        key: '',
    });

    const fetchKeys = async () => {
        try {
            setIsLoading(true);
            const response = await api.get('/admin/api-keys');
            setKeys(response.data);
        } catch (err: any) {
            setError(err.response?.data?.message || 'Không thể tải danh sách API Keys');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchKeys();
    }, []);

    const handleOpenModal = (key?: ApiKey) => {
        if (key) {
            setEditingKey(key);
            setFormData({
                name: key.name,
                service: key.service,
                key: '',
            });
        } else {
            setEditingKey(null);
            setFormData({
                name: '',
                service: 'GEMINI',
                key: '',
            });
        }
        setShowModal(true);
    };

    const handleCloseModal = () => {
        setShowModal(false);
        setEditingKey(null);
        setFormData({ name: '', service: 'GEMINI', key: '' });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccessMsg('');

        try {
            if (editingKey) {
                await api.put(`/admin/api-keys/${editingKey.id}`, {
                    name: formData.name,
                    key: formData.key || undefined,
                });
                setSuccessMsg('Đã cập nhật API Key thành công!');
            } else {
                await api.post('/admin/api-keys', formData);
                setSuccessMsg('Đã thêm API Key mới thành công!');
            }
            handleCloseModal();
            fetchKeys();
        } catch (err: any) {
            setError(err.response?.data?.message || 'Lỗi khi lưu API Key');
        }
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm('Bạn có chắc muốn xóa API Key này?')) return;

        try {
            await api.delete(`/admin/api-keys/${id}`);
            setSuccessMsg('Đã xóa API Key thành công!');
            fetchKeys();
        } catch (err: any) {
            setError(err.response?.data?.message || 'Lỗi khi xóa API Key');
        }
    };

    const getServiceInfo = (service: string) => {
        return SERVICE_OPTIONS.find(s => s.value === service) || { label: service, icon: '🔑' };
    };

    if (isLoading) {
        return <div className="admin-page loading">Đang tải...</div>;
    }

    return (
        <div className="admin-page">
            <div className="page-header">
                <h1>🔑 API Keys Management</h1>
                <p>Quản lý API Keys hệ thống cho các dịch vụ AI và TTS</p>
            </div>

            {error && <div className="message-banner error">{error}</div>}
            {successMsg && <div className="message-banner success">{successMsg}</div>}

            <div className="page-actions">
                <button className="btn-primary" onClick={() => handleOpenModal()}>
                    + Thêm API Key
                </button>
            </div>

            <div className="api-keys-grid">
                {keys.length === 0 ? (
                    <div className="empty-state">
                        <span className="empty-icon">🔑</span>
                        <h3>Chưa có API Key nào</h3>
                        <p>Thêm API Key để kích hoạt các dịch vụ AI</p>
                    </div>
                ) : (
                    keys.map((key) => {
                        const serviceInfo = getServiceInfo(key.service);
                        return (
                            <div key={key.id} className="api-key-card">
                                <div className="key-header">
                                    <span className="service-icon">{serviceInfo.icon}</span>
                                    <div className="key-info">
                                        <h3>{key.name}</h3>
                                        <span className="service-label">{serviceInfo.label}</span>
                                    </div>
                                    <span className={`key-status ${key.hasKey ? 'configured' : 'missing'}`}>
                                        {key.hasKey ? '✓ Đã cấu hình' : '⚠ Thiếu key'}
                                    </span>
                                </div>
                                <div className="key-meta">
                                    <span>Cập nhật: {new Date(key.updatedAt).toLocaleDateString('vi-VN')}</span>
                                </div>
                                <div className="key-actions">
                                    <button className="btn-edit" onClick={() => handleOpenModal(key)}>
                                        ✏️ Sửa
                                    </button>
                                    <button className="btn-delete" onClick={() => handleDelete(key.id)}>
                                        🗑️ Xóa
                                    </button>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={handleCloseModal}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>{editingKey ? 'Sửa API Key' : 'Thêm API Key'}</h2>
                            <button className="modal-close" onClick={handleCloseModal}>×</button>
                        </div>
                        <form onSubmit={handleSubmit}>
                            <div className="form-group">
                                <label>Tên hiển thị</label>
                                <input
                                    type="text"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="VD: System Gemini Key"
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>Dịch vụ</label>
                                <select
                                    value={formData.service}
                                    onChange={(e) => setFormData({ ...formData, service: e.target.value as any })}
                                    disabled={!!editingKey}
                                >
                                    {SERVICE_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.icon} {opt.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group">
                                <label>
                                    API Key {editingKey && '(để trống nếu không đổi)'}
                                </label>
                                <input
                                    type="password"
                                    value={formData.key}
                                    onChange={(e) => setFormData({ ...formData, key: e.target.value })}
                                    placeholder={editingKey ? '••••••••' : 'Nhập API Key'}
                                    required={!editingKey}
                                />
                            </div>
                            <div className="modal-actions">
                                <button type="button" className="btn-cancel" onClick={handleCloseModal}>
                                    Hủy
                                </button>
                                <button type="submit" className="btn-primary">
                                    {editingKey ? 'Cập nhật' : 'Thêm'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
