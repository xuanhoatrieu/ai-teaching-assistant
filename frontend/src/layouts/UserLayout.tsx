import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './UserLayout.css';

const menuItems = [
    { path: '/', label: 'Subjects', icon: '📚' },
    { path: '/pptx-audio-tool', label: 'PPTX Audio', icon: '🎙️' },
    { path: '/settings', label: 'Settings', icon: '⚙️' },
];

export function UserLayout() {
    const { user, logout } = useAuth();
    const location = useLocation();

    return (
        <div className="user-layout">
            <header className="user-header">
                <div className="header-left">
                    <h1>AI Teaching Assistant</h1>
                    <nav className="header-nav">
                        {menuItems.map((item) => (
                            <Link
                                key={item.path}
                                to={item.path}
                                className={`nav-link ${location.pathname === item.path ? 'active' : ''}`}
                            >
                                <span>{item.icon}</span>
                                {item.label}
                            </Link>
                        ))}
                    </nav>
                </div>

                <div className="header-right">
                    <span className="user-email">{user?.email}</span>
                    {user?.role === 'ADMIN' && (
                        <Link to="/admin" className="admin-link">Admin</Link>
                    )}
                    <button className="logout-btn" onClick={logout}>Logout</button>
                </div>
            </header>

            <main className="user-main">
                <Outlet />
            </main>

            <footer className="user-footer">
                <span>© {new Date().getFullYear()} AI Teaching Assistant</span>
                <span className="footer-separator">·</span>
                <span>Developed by Triệu Xuân Hòa</span>
                <a href="https://www.facebook.com/aieduwork" target="_blank" rel="noopener noreferrer" className="footer-link" title="AIEduWork">
                    🌐
                </a>
            </footer>
        </div>
    );
}
