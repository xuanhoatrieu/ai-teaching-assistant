import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import './Auth.css';

export function ForgotPasswordPage() {
    const [email, setEmail] = useState('');
    const [error, setError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccessMsg('');
        setIsLoading(true);

        try {
            const res = await api.post('/auth/forgot-password', { email });
            setSuccessMsg(res.data.message || 'Yêu cầu đặt lại mật khẩu đã được gửi qua email.');
            setEmail('');
        } catch (err: any) {
            setError(err.response?.data?.message || 'Có lỗi xảy ra, vui lòng thử lại sau.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="auth-container">
            <div className="auth-card">
                <div className="auth-header">
                    <h1>AI Teaching Assistant</h1>
                    <p>Quên mật khẩu</p>
                </div>

                {error && <div className="auth-error">{error}</div>}
                {successMsg && <div className="auth-success" style={{ color: '#10b981', backgroundColor: '#ecfdf5', padding: '12px', borderRadius: '6px', marginBottom: '16px', fontSize: '0.875rem' }}>{successMsg}</div>}

                {!successMsg ? (
                    <form onSubmit={handleSubmit} className="auth-form">
                        <div className="form-group">
                            <label htmlFor="email">Email tài khoản</label>
                            <input
                                id="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="Nhập email đăng ký của bạn"
                                required
                            />
                        </div>

                        <button type="submit" className="auth-button" disabled={isLoading}>
                            {isLoading ? 'Đang xử lý...' : 'Gửi yêu cầu reset'}
                        </button>
                    </form>
                ) : (
                    <div style={{ textAlign: 'center', marginTop: '16px' }}>
                        <p style={{ fontSize: '0.9rem', color: '#6b7280' }}>
                            Vui lòng kiểm tra hộp thư đến (và thư rác) để nhấp vào đường link thay đổi mật khẩu.
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
