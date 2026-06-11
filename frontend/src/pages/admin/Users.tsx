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
        </div>
    );
}
