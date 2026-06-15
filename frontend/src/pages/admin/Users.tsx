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

            <div className="data-table">
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

            {/* Reset Password Modal */}
            {resettingUser && (
                <div className="modal-overlay" onClick={handleCloseResetModal} style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    zIndex: 1000
                }}>
                    <div className="modal-content" onClick={e => e.stopPropagation()} style={{
                        backgroundColor: 'white',
                        padding: '24px',
                        borderRadius: '8px',
                        width: '400px',
                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
                    }}>
                        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', margin: 0 }}>Đặt lại mật khẩu</h2>
                            <button onClick={handleCloseResetModal} style={{ border: 'none', background: 'none', fontSize: '1.5rem', cursor: 'pointer', padding: 0 }}>×</button>
                        </div>

                        <p style={{ fontSize: '0.9rem', color: '#4b5563', marginBottom: '16px', marginTop: 0 }}>
                            Thay đổi mật khẩu cho tài khoản: <strong>{resettingUser.email}</strong>
                        </p>

                        {resetError && <div className="error-banner" style={{ marginBottom: '12px', padding: '8px', backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: '4px', fontSize: '0.85rem' }}>{resetError}</div>}
                        {resetSuccess && <div className="success-banner" style={{ marginBottom: '12px', padding: '8px', backgroundColor: '#dcfce7', color: '#166534', borderRadius: '4px', fontSize: '0.85rem' }}>{resetSuccess}</div>}

                        {!resetSuccess && (
                            <form onSubmit={handleResetPasswordSubmit}>
                                <div className="form-group" style={{ marginBottom: '16px' }}>
                                    <label htmlFor="new-pass" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '6px', textAlign: 'left' }}>Mật khẩu mới *</label>
                                    <input
                                        id="new-pass"
                                        type="text"
                                        value={newPassword}
                                        onChange={e => setNewPassword(e.target.value)}
                                        placeholder="Nhập mật khẩu mới (ít nhất 6 ký tự)"
                                        required
                                        style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px', boxSizing: 'border-box' }}
                                    />
                                </div>

                                <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                    <button type="button" className="secondary-btn" onClick={handleCloseResetModal} style={{ padding: '6px 12px', border: '1px solid #d1d5db', borderRadius: '4px', background: 'white', cursor: 'pointer', fontSize: '0.85rem' }}>
                                        Hủy
                                    </button>
                                    <button type="submit" disabled={isResetting} style={{ padding: '6px 12px', border: 'none', borderRadius: '4px', background: '#3b82f6', color: 'white', cursor: 'pointer', fontSize: '0.85rem' }}>
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
