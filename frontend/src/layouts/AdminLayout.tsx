import { useState, useEffect } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './AdminLayout.css';

const menuItems = [
    { path: '/admin', label: 'Dashboard', icon: '📊' },
    { path: '/admin/prompts', label: 'Prompts', icon: '📝' },
    { path: '/admin/templates', label: 'Templates', icon: '🎨' },
    { path: '/admin/tts-providers', label: 'TTS Providers', icon: '🔊' },
    { path: '/admin/api-keys', label: 'API Keys', icon: '🔑' },
    { path: '/admin/users', label: 'Users', icon: '👥' },
    { path: '/admin/settings', label: 'Settings', icon: '⚙️' },
];

export function AdminLayout() {
    const { user, logout } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const [isAdminSidebarOpen, setIsAdminSidebarOpen] = useState(false);

    const handleExitAdmin = () => {
        navigate('/');
    };

    // Close admin sidebar when route changes
    useEffect(() => {
        setIsAdminSidebarOpen(false);
    }, [location]);

    return (
        <div className="admin-layout">
            {/* Mobile Admin Header */}
            <header className="admin-mobile-header">
                <button 
                    className="admin-menu-toggle"
                    onClick={() => setIsAdminSidebarOpen(!isAdminSidebarOpen)}
                    aria-label="Toggle admin menu"
                >
                    ☰ Menu
                </button>
                <div className="admin-mobile-title">
                    <span>AI Teaching</span>
                    <span className="admin-badge">Admin</span>
                </div>
            </header>

            {/* Mobile Admin Overlay */}
            {isAdminSidebarOpen && (
                <div 
                    className="admin-sidebar-overlay"
                    onClick={() => setIsAdminSidebarOpen(false)}
                />
            )}

            <aside className={`admin-sidebar ${isAdminSidebarOpen ? 'open' : ''}`}>
                <div className="sidebar-header">
                    <h1>AI Teaching</h1>
                    <span className="admin-badge">Admin</span>
                </div>

                <nav className="sidebar-nav">
                    {menuItems.map((item) => (
                        <Link
                            key={item.path}
                            to={item.path}
                            className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
                            onClick={() => setIsAdminSidebarOpen(false)}
                        >
                            <span className="nav-icon">{item.icon}</span>
                            <span className="nav-label">{item.label}</span>
                        </Link>
                    ))}
                </nav>

                <div className="sidebar-footer">
                    <button className="exit-admin-btn" onClick={handleExitAdmin}>
                        🏠 Exit Admin
                    </button>
                    <div className="user-info">
                        <span className="user-email">{user?.email}</span>
                    </div>
                    <button className="logout-btn" onClick={logout}>
                        Logout
                    </button>
                </div>
            </aside>

            <main className="admin-main">
                <Outlet />
            </main>
        </div>
    );
}
