import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import './AdminPage.css';

interface User {
    id: string;
    email: string;
    role: 'ADMIN' | 'USER';
    fullName?: string;
    phone?: string;
    organization?: string;
    status?: 'PENDING' | 'APPROVED' | 'REJECTED';
    createdAt: string;
}

export function UsersPage() {
    const { user: currentUser } = useAuth();
    const [users, setUsers] = useState<User[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    // Reset password modal state
    const [resettingUser, setResettingUser] = useState<User | null>(null);
    const [newPassword, setNewPassword] = useState('');
    const [resetSuccess, setResetSuccess] = useState('');
    const [resetError, setResetError] = useState('');
    const [isResetting, setIsResetting] = useState(false);

    useEffect(() => {
        fetchUsers();
    }, []);

    const fetchUsers = async () => {
        try {
            const response = await api.get('/admin/users');
            setUsers(response.data);
        } catch (err: any) {
            setError(err.response?.data?.message || 'Failed to load users');
        } finally {
            setIsLoading(false);
        }
    };

    const handleUpdateStatus = async (id: string, status: 'APPROVED' | 'REJECTED') => {
        if (!window.confirm(`Bạn có chắc chắn muốn ${status === 'APPROVED' ? 'duyệt' : 'từ chối'} tài khoản này?`)) {
            return;
        }

        setActionLoading(id);
        setError('');
        try {
            await api.patch(`/admin/users/${id}/status`, { status });
            setUsers(users.map(u => u.id === id ? { ...u, status } : u));
        } catch (err: any) {
            setError(err.response?.data?.message || 'Thực hiện thất bại.');
        } finally {
            setActionLoading(null);
        }
    };

    const handleDelete = async (id: string, email: string) => {
        if (id === currentUser?.id) {
            alert('Bạn không thể tự xóa tài khoản của chính mình!');
            return;
        }

        if (!window.confirm(`Bạn có chắc chắn muốn xóa tài khoản ${email}? Hành động này sẽ xóa toàn bộ môn học, bài giảng và dữ liệu liên quan và KHÔNG thể hoàn tác.`)) {
            return;
        }

        setActionLoading(id);
        setError('');
        try {
            await api.delete(`/admin/users/${id}`);
            setUsers(users.filter(u => u.id !== id));
        } catch (err: any) {
            setError(err.response?.data?.message || 'Xóa tài khoản thất bại.');
        } finally {
            setActionLoading(null);
        }
    };

    const handleOpenResetModal = (user: User) => {
        setResettingUser(user);
        setNewPassword('');
        setResetSuccess('');
        setResetError('');
    };

    const handleCloseResetModal = () => {
        setResettingUser(null);
    };

    const handleResetPasswordSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!resettingUser) return;
        if (newPassword.length < 6) {
            setResetError('Mật khẩu phải từ 6 ký tự trở lên.');
            return;
        }

        setIsResetting(true);
        setResetError('');
        setResetSuccess('');

        try {
            await api.patch(`/admin/users/${resettingUser.id}/reset-password`, {
                password: newPassword,
            });
            setResetSuccess(`Đã đặt lại mật khẩu thành công cho tài khoản ${resettingUser.email}`);
            setTimeout(() => {
                handleCloseResetModal();
            }, 2000);
        } catch (err: any) {
            setResetError(err.response?.data?.message || 'Có lỗi xảy ra khi đặt lại mật khẩu.');
        } finally {
            setIsResetting(false);
        }
    };

    if (isLoading) {
        return <div className="admin-page loading">Loading...</div>;
    }

    return (
        <div className="admin-page">
            <div className="page-header">
                <div>
                    <h1>Quản lý người dùng</h1>
                    <p>Duyệt đăng ký tài khoản và quản lý thành viên</p>
                </div>
            </div>

            {error && <div className="error-banner">{error}</div>}

            <div className="data-table desktop-users-table">
                <table>
                    <thead>
                        <tr>
                            <th>Họ và tên</th>
                            <th>Email</th>
                            <th>Số điện thoại</th>
                            <th>Đơn vị công tác</th>
                            <th>Vai trò</th>
                            <th>Trạng thái</th>
                            <th>Ngày đăng ký</th>
                            <th>Hành động</th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.length === 0 ? (
                            <tr>
                                <td colSpan={8} className="empty-state">Không tìm thấy người dùng nào</td>
                            </tr>
                        ) : (
                            users.map((user) => (
                                <tr key={user.id}>
                                    <td><strong>{user.fullName || 'Chưa cập nhật'}</strong></td>
                                    <td>{user.email}</td>
                                    <td>{user.phone || 'Chưa cập nhật'}</td>
                                    <td>{user.organization || 'Chưa cập nhật'}</td>
                                    <td>
                                        <span className={`role-badge ${user.role.toLowerCase()}`}>
                                            {user.role}
                                        </span>
                                    </td>
                                    <td>
                                        <span className={`status-badge ${user.status?.toLowerCase() || 'approved'}`} style={{
                                            padding: '4px 8px',
                                            borderRadius: '4px',
                                            fontSize: '0.8rem',
                                            fontWeight: 'bold',
                                            display: 'inline-block',
                                            backgroundColor: user.status === 'APPROVED' ? '#dcfce7' : user.status === 'REJECTED' ? '#fee2e2' : '#fef3c7',
                                            color: user.status === 'APPROVED' ? '#166534' : user.status === 'REJECTED' ? '#991b1b' : '#92400e',
                                        }}>
                                            {user.status === 'APPROVED' ? 'Đã duyệt' : user.status === 'REJECTED' ? 'Từ chối' : 'Chờ duyệt'}
                                        </span>
                                    </td>
                                    <td>{new Date(user.createdAt).toLocaleDateString('vi-VN')}</td>
                                    <td>
                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                            {user.status === 'PENDING' && (
                                                <>
                                                    <button
                                                        onClick={() => handleUpdateStatus(user.id, 'APPROVED')}
                                                        disabled={actionLoading !== null}
                                                        style={{
                                                            padding: '4px 8px',
                                                            backgroundColor: '#22c55e',
                                                            color: 'white',
                                                            border: 'none',
                                                            borderRadius: '4px',
                                                            cursor: 'pointer',
                                                            fontSize: '0.8rem'
                                                        }}
                                                    >
                                                        Duyệt
                                                    </button>
                                                    <button
                                                        onClick={() => handleUpdateStatus(user.id, 'REJECTED')}
                                                        disabled={actionLoading !== null}
                                                        style={{
                                                            padding: '4px 8px',
                                                            backgroundColor: '#eab308',
                                                            color: 'white',
                                                            border: 'none',
                                                            borderRadius: '4px',
                                                            cursor: 'pointer',
                                                            fontSize: '0.8rem'
                                                        }}
                                                    >
                                                        Từ chối
                                                    </button>
                                                </>
                                            )}
                                            <button
                                                onClick={() => handleOpenResetModal(user)}
                                                disabled={actionLoading !== null}
                                                style={{
                                                    padding: '4px 8px',
                                                    backgroundColor: '#3b82f6',
                                                    color: 'white',
                                                    border: 'none',
                                                    borderRadius: '4px',
                                                    cursor: 'pointer',
                                                    fontSize: '0.8rem'
                                                }}
                                            >
                                                Reset MK
                                            </button>
                                            {user.id !== currentUser?.id && (
                                                <button
                                                    onClick={() => handleDelete(user.id, user.email)}
                                                    disabled={actionLoading !== null}
                                                    style={{
                                                        padding: '4px 8px',
                                                        backgroundColor: '#ef4444',
                                                        color: 'white',
                                                        border: 'none',
                                                        borderRadius: '4px',
                                                        cursor: 'pointer',
                                                        fontSize: '0.8rem'
                                                    }}
                                                >
                                                    Xóa
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Mobile User Cards */}
            <div className="mobile-users-cards">
                {users.length === 0 ? (
                    <div className="empty-state">Không tìm thấy người dùng nào</div>
                ) : (
                    users.map((user) => (
                        <div key={user.id} className="user-card-item">
                            <div className="user-card-header">
                                <div>
                                    <div className="user-card-name">{user.fullName || 'Chưa cập nhật tên'}</div>
                                    <div className="user-card-email">{user.email}</div>
                                </div>
                                <div className="user-card-badges">
                                    <span className={`role-badge ${user.role.toLowerCase()}`}>{user.role}</span>
                                    <span className={`status-badge ${user.status?.toLowerCase() || 'approved'}`}>
                                        {user.status === 'APPROVED' ? 'Đã duyệt' : user.status === 'REJECTED' ? 'Từ chối' : 'Chờ duyệt'}
                                    </span>
                                </div>
                            </div>
                            <div className="user-card-details">
                                <div className="detail-row">
                                    <span className="detail-label">📱 SĐT:</span>
                                    <span className="detail-value">{user.phone || 'Chưa cập nhật'}</span>
                                </div>
                                <div className="detail-row">
                                    <span className="detail-label">🏢 Đơn vị:</span>
                                    <span className="detail-value">{user.organization || 'Chưa cập nhật'}</span>
                                </div>
                                <div className="detail-row">
                                    <span className="detail-label">📅 Ngày ĐK:</span>
                                    <span className="detail-value">{new Date(user.createdAt).toLocaleDateString('vi-VN')}</span>
                                </div>
                            </div>
                            <div className="user-card-actions">
                                {user.status === 'PENDING' && (
                                    <>
                                        <button
                                            onClick={() => handleUpdateStatus(user.id, 'APPROVED')}
                                            disabled={actionLoading !== null}
                                            className="btn-user-action btn-approve"
                                        >
                                            ✓ Duyệt
                                        </button>
                                        <button
                                            onClick={() => handleUpdateStatus(user.id, 'REJECTED')}
                                            disabled={actionLoading !== null}
                                            className="btn-user-action btn-reject"
                                        >
                                            ✕ Từ chối
                                        </button>
                                    </>
                                )}
                                <button
                                    onClick={() => handleOpenResetModal(user)}
                                    disabled={actionLoading !== null}
                                    className="btn-user-action btn-reset"
                                >
                                    🔑 Đặt lại MK
                                </button>
                                {user.id !== currentUser?.id && (
                                    <button
                                        onClick={() => handleDelete(user.id, user.email)}
                                        disabled={actionLoading !== null}
                                        className="btn-user-action btn-delete"
                                    >
                                        🗑️ Xóa
                                    </button>
                                )}
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Reset Password Modal */}
            {resettingUser && (
                <div className="admin-modal-backdrop" onClick={handleCloseResetModal}>
                    <div className="admin-modal-content" onClick={e => e.stopPropagation()}>
                        <div className="sheet-handle"></div>
                        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', margin: 0, color: '#f1f5f9' }}>Đặt lại mật khẩu</h2>
                            <button onClick={handleCloseResetModal} style={{ border: 'none', background: 'none', fontSize: '1.5rem', cursor: 'pointer', padding: 0, color: '#94a3b8' }}>×</button>
                        </div>

                        <p style={{ fontSize: '0.9rem', color: '#94a3b8', marginBottom: '16px', marginTop: 0 }}>
                            Thay đổi mật khẩu cho tài khoản: <strong style={{ color: '#f1f5f9' }}>{resettingUser.email}</strong>
                        </p>

                        {resetError && <div className="error-banner" style={{ marginBottom: '12px' }}>{resetError}</div>}
                        {resetSuccess && <div className="success-banner" style={{ marginBottom: '12px', padding: '10px 14px', backgroundColor: 'rgba(34, 197, 94, 0.15)', color: '#86efac', border: '1px solid rgba(34, 197, 94, 0.3)', borderRadius: '8px', fontSize: '0.875rem' }}>{resetSuccess}</div>}

                        {!resetSuccess && (
                            <form onSubmit={handleResetPasswordSubmit}>
                                <div className="setting-group" style={{ marginBottom: '16px' }}>
                                    <label htmlFor="new-pass" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '6px', textAlign: 'left', color: '#cbd5e1' }}>Mật khẩu mới *</label>
                                    <input
                                        id="new-pass"
                                        type="text"
                                        value={newPassword}
                                        onChange={e => setNewPassword(e.target.value)}
                                        placeholder="Nhập mật khẩu mới (ít nhất 6 ký tự)"
                                        required
                                        style={{ width: '100%', padding: '10px', backgroundColor: '#0f172a', color: '#f1f5f9', border: '1px solid rgba(148, 163, 184, 0.2)', borderRadius: '8px', boxSizing: 'border-box' }}
                                    />
                                </div>

                                <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                    <button type="button" className="secondary-btn" onClick={handleCloseResetModal} style={{ padding: '8px 16px', margin: 0 }}>
                                        Hủy
                                    </button>
                                    <button type="submit" className="primary-btn" disabled={isResetting} style={{ padding: '8px 16px', margin: 0 }}>
                                        {isResetting ? 'Đang cập nhật...' : 'Xác nhận'}
                                    </button>
                                </div>
                            </form>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
