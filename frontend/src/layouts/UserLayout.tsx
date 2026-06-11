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

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

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
                    <span className="user-email">{user?.email}</span>
                    {user?.role === 'ADMIN' && (
                        <Link to="/admin" className="admin-link">Admin</Link>
                    )}
                    <button className="logout-btn" onClick={logout}>Logout</button>
                </div>
            </header>

            {user?.requireProfileUpdate && (
                <div className="profile-update-banner" style={{
                    backgroundColor: '#fffbeb',
                    borderBottom: '1px solid #fef3c7',
                    color: '#b45309',
                    padding: '10px 20px',
                    textAlign: 'center',
                    fontSize: '0.9rem',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: '10px'
                }}>
                    <span>⚠️</span>
                    <strong>Thông báo:</strong> Thầy/cô vui lòng bổ sung đầy đủ Họ tên, Số điện thoại và Đơn vị công tác để hoàn thiện thông tin tài khoản.
                    <Link to="/settings" style={{
                        color: '#d97706',
                        textDecoration: 'underline',
                        fontWeight: 'bold',
                        marginLeft: '5px'
                    }}>
                        Cập nhật ngay
                    </Link>
                </div>
            )}

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
