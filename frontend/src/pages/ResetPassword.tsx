import { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import './Auth.css';

export function ResetPasswordPage() {
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token') || '';
    const navigate = useNavigate();

    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccessMsg('');

        if (!token) {
            setError('Mã xác minh (token) không tồn tại hoặc không hợp lệ.');
            return;
        }

        if (newPassword !== confirmPassword) {
            setError('Mật khẩu xác nhận không khớp.');
            return;
        }

        if (newPassword.length < 6) {
            setError('Mật khẩu mới phải có ít nhất 6 ký tự.');
            return;
        }

        setIsLoading(true);

        try {
            const res = await api.post('/auth/reset-password', {
                token,
                newPassword,
            });
            setSuccessMsg(res.data.message || 'Mật khẩu đã được đặt lại thành công.');
            setTimeout(() => {
                navigate('/login');
            }, 3000);
        } catch (err: any) {
            setError(err.response?.data?.message || 'Yêu cầu không hợp lệ hoặc link đã hết hạn.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="auth-container">
            <div className="auth-card">
                <div className="auth-header">
                    <h1>AI Teaching Assistant</h1>
                    <p>Đặt lại mật khẩu</p>
                </div>

                {error && <div className="auth-error">{error}</div>}
                {successMsg && <div className="auth-success" style={{ color: '#10b981', backgroundColor: '#ecfdf5', padding: '12px', borderRadius: '6px', marginBottom: '16px', fontSize: '0.875rem' }}>{successMsg}</div>}

                {!token && (
                    <div className="auth-error">
                        Link đặt lại mật khẩu không hợp lệ. Vui lòng yêu cầu link mới.
                    </div>
                )}

                {token && !successMsg && (
                    <form onSubmit={handleSubmit} className="auth-form">
                        <div className="form-group">
                            <label htmlFor="new-password">Mật khẩu mới *</label>
                            <input
                                id="new-password"
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                placeholder="Tối thiểu 6 ký tự"
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor="confirm-password">Xác nhận mật khẩu mới *</label>
                            <input
                                id="confirm-password"
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="Nhập lại mật khẩu mới"
                                required
                            />
                        </div>

                        <button type="submit" className="auth-button" disabled={isLoading}>
                            {isLoading ? 'Đang xử lý...' : 'Cập nhật mật khẩu'}
                        </button>
                    </form>
                )}

                {successMsg && (
                    <div style={{ textAlign: 'center', marginTop: '16px' }}>
                        <p style={{ fontSize: '0.9rem', color: '#6b7280' }}>
                            Đang chuyển hướng về trang đăng nhập...
                        </p>
                    </div>
                )}

                <div className="auth-footer">
                    <p>
                        Quay lại <Link to="/login">Đăng nhập</Link>
                    </p>
                </div>
            </div>
        </div>
    );
}
