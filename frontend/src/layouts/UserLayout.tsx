import { useState, useEffect, useRef } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import './UserLayout.css';

interface UsefulLink {
    id: string;
    title: string;
    url: string;
    icon: string;
    description: string | null;
}

const menuItems = [
    { path: '/', label: 'Subjects', icon: '📚' },
    { path: '/pptx-audio-tool', label: 'PPTX Audio', icon: '🎙️' },
    { path: '/settings', label: 'Settings', icon: '⚙️' },
];

export function UserLayout() {
    const { user, logout } = useAuth();
    const location = useLocation();
    const [usefulLinks, setUsefulLinks] = useState<UsefulLink[]>([]);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [isToolsSheetOpen, setIsToolsSheetOpen] = useState(false);
    const [dismissProfileBanner, setDismissProfileBanner] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const fetchLinks = async () => {
            try {
                const res = await api.get('/useful-links');
                setUsefulLinks(res.data || []);
            } catch (err) {
                console.error('Failed to load useful links', err);
            }
        };
        fetchLinks();
    }, []);

    // Close tools sheet when changing location
    useEffect(() => {
        setIsToolsSheetOpen(false);
    }, [location]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const isSubjectsActive = location.pathname === '/' || location.pathname.startsWith('/subjects') || location.pathname.startsWith('/lessons');
    const isPptxActive = location.pathname === '/pptx-audio-tool';
    const isSettingsActive = location.pathname === '/settings';

    return (
        <div className="user-layout">
            <header className="user-header">
                <Link to="/" className="header-logo">
                    <span className="logo-badge">🎓</span>
                    <h1>AI Teaching Assistant</h1>
                </Link>

                {/* Mobile Header Actions (Clean, Thumb-Friendly, No Duplicate Hamburger) */}
                <div className="mobile-header-actions">
                    <div className="mobile-user-chip" title={user?.email || ''}>
                        <span className="mobile-user-icon">👤</span>
                        <span className="mobile-user-name">{user?.email ? user.email.split('@')[0] : ''}</span>
                    </div>
                    <button 
                        className="mobile-logout-btn" 
                        onClick={logout}
                        aria-label="Đăng xuất"
                        title="Đăng xuất"
                    >
                        🚪
                    </button>
                </div>

                {/* Overlay for Tools Bottom Sheet */}
                {isToolsSheetOpen && (
                    <div 
                        className="mobile-sheet-overlay" 
                        onClick={() => setIsToolsSheetOpen(false)}
                    />
                )}

                {/* Desktop Navigation (Hidden on mobile via CSS) */}
                <div className="header-navigation-wrapper">
                    <div className="header-left">
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
                            
                            {usefulLinks.length > 0 && (
                                <div className="nav-dropdown" ref={dropdownRef}>
                                    <button 
                                        className={`nav-link dropdown-toggle ${isDropdownOpen ? 'open' : ''}`}
                                        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                                    >
                                        <span>🧰</span>
                                        Công cụ
                                        <span className="dropdown-arrow">▼</span>
                                    </button>
                                    {isDropdownOpen && (
                                        <div className="dropdown-menu">
                                            {usefulLinks.map(link => (
                                                <a 
                                                    key={link.id} 
                                                    href={link.url} 
                                                    target="_blank" 
                                                    rel="noopener noreferrer"
                                                    className="dropdown-item"
                                                >
                                                    <span className="item-icon">{link.icon}</span>
                                                    <div className="item-content">
                                                        <span className="item-title">{link.title}</span>
                                                        {link.description && <span className="item-desc">{link.description}</span>}
                                                    </div>
                                                </a>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </nav>
                    </div>

                    <div className="header-right">
                        <div className="user-profile-badge">
                            <span className="user-avatar-icon">👤</span>
                            <span className="user-email">{user?.email}</span>
                        </div>
                        {user?.role === 'ADMIN' && (
                            <Link to="/admin" className="admin-link">🛡️ Admin</Link>
                        )}
                        <button className="logout-btn" onClick={logout}>Đăng xuất</button>
                    </div>
                </div>
            </header>

            {user?.requireProfileUpdate && !dismissProfileBanner && (
                <div className="profile-update-banner">
                    <div className="banner-text">
                        <span className="banner-icon">⚠️</span>
                        <span>Vui lòng bổ sung đầy đủ <strong>Họ tên, SĐT và Đơn vị</strong>.</span>
                    </div>
                    <div className="banner-actions">
                        <Link to="/settings" className="banner-cta">
                            Cập nhật ngay →
                        </Link>
                        <button 
                            className="banner-dismiss-btn" 
                            onClick={() => setDismissProfileBanner(true)}
                            aria-label="Đóng thông báo"
                        >
                            ✕
                        </button>
                    </div>
                </div>
            )}

            <main className="user-main">
                <Outlet />
            </main>

            {/* Mobile Bottom Sheet for Tools */}
            <div className={`mobile-bottom-sheet ${isToolsSheetOpen ? 'open' : ''}`}>
                <div className="sheet-handle" onClick={() => setIsToolsSheetOpen(false)} />
                <div className="sheet-header">
                    <h3>🧰 Công cụ & Tiện ích giảng dạy</h3>
                    <button className="sheet-close-btn" onClick={() => setIsToolsSheetOpen(false)}>✕</button>
                </div>
                <div className="sheet-body">
                    {usefulLinks.length === 0 ? (
                        <p className="sheet-empty">Chưa có liên kết công cụ nào được cấu hình.</p>
                    ) : (
                        <div className="sheet-tools-grid">
                            {usefulLinks.map(link => (
                                <a
                                    key={link.id}
                                    href={link.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="sheet-tool-card"
                                    onClick={() => setIsToolsSheetOpen(false)}
                                >
                                    <span className="sheet-tool-icon">{link.icon}</span>
                                    <div className="sheet-tool-info">
                                        <span className="sheet-tool-title">{link.title}</span>
                                        {link.description && <span className="sheet-tool-desc">{link.description}</span>}
                                    </div>
                                    <span className="sheet-tool-arrow">↗</span>
                                </a>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Mobile Bottom Navigation Bar (Thumb-zone 44px+) */}
            <nav className="mobile-bottom-nav" aria-label="Điều hướng chính">
                <Link
                    to="/"
                    className={`bottom-nav-item ${isSubjectsActive ? 'active' : ''}`}
                >
                    <span className="bottom-nav-icon">📚</span>
                    <span className="bottom-nav-label">Môn học</span>
                </Link>

                <Link
                    to="/pptx-audio-tool"
                    className={`bottom-nav-item ${isPptxActive ? 'active' : ''}`}
                >
                    <span className="bottom-nav-icon">🎙️</span>
                    <span className="bottom-nav-label">Audio PPTX</span>
                </Link>

                <button
                    type="button"
                    className={`bottom-nav-item bottom-nav-btn ${isToolsSheetOpen ? 'active' : ''}`}
                    onClick={() => setIsToolsSheetOpen(!isToolsSheetOpen)}
                >
                    <span className="bottom-nav-icon">🧰</span>
                    <span className="bottom-nav-label">Công cụ</span>
                </button>

                <Link
                    to="/settings"
                    className={`bottom-nav-item ${isSettingsActive ? 'active' : ''}`}
                >
                    <span className="bottom-nav-icon">⚙️</span>
                    <span className="bottom-nav-label">Cài đặt</span>
                </Link>

                {user?.role === 'ADMIN' && (
                    <Link
                        to="/admin"
                        className={`bottom-nav-item admin-tab ${location.pathname.startsWith('/admin') ? 'active' : ''}`}
                    >
                        <span className="bottom-nav-icon">🛡️</span>
                        <span className="bottom-nav-label">Admin</span>
                    </Link>
                )}
            </nav>

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
