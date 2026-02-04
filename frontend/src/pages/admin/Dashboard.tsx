import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import './Dashboard.css';

interface Stats {
    totalUsers: number;
    activePrompts: number;
    totalTTSProviders: number;
    totalLessons: number;
}

export function AdminDashboard() {
    const navigate = useNavigate();
    const [stats, setStats] = useState<Stats | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        fetchStats();
    }, []);

    const fetchStats = async () => {
        try {
            const response = await api.get('/admin/stats');
            setStats(response.data);
        } catch (err) {
            console.error('Failed to fetch stats:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const formatStat = (value: number | undefined) => {
        if (isLoading) return '...';
        return value ?? '--';
    };

    return (
        <div className="dashboard">
            <div className="dashboard-header">
                <h1>Admin Dashboard</h1>
                <p>Welcome to the AI Teaching Assistant admin panel</p>
            </div>

            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-icon">👥</div>
                    <div className="stat-info">
                        <span className="stat-value">{formatStat(stats?.totalUsers)}</span>
                        <span className="stat-label">Total Users</span>
                    </div>
                </div>

                <div className="stat-card">
                    <div className="stat-icon">📝</div>
                    <div className="stat-info">
                        <span className="stat-value">{formatStat(stats?.activePrompts)}</span>
                        <span className="stat-label">Active Prompts</span>
                    </div>
                </div>

                <div className="stat-card">
                    <div className="stat-icon">🔊</div>
                    <div className="stat-info">
                        <span className="stat-value">{formatStat(stats?.totalTTSProviders)}</span>
                        <span className="stat-label">TTS Providers</span>
                    </div>
                </div>

                <div className="stat-card">
                    <div className="stat-icon">📚</div>
                    <div className="stat-info">
                        <span className="stat-value">{formatStat(stats?.totalLessons)}</span>
                        <span className="stat-label">Total Lessons</span>
                    </div>
                </div>
            </div>

            <div className="quick-actions">
                <h2>Quick Actions</h2>
                <div className="actions-grid">
                    <button className="action-btn" onClick={() => navigate('/admin/prompts')}>
                        <span>📝</span>
                        Manage Prompts
                    </button>
                    <button className="action-btn" onClick={() => navigate('/admin/tts-providers')}>
                        <span>🔊</span>
                        TTS Providers
                    </button>
                    <button className="action-btn" onClick={() => navigate('/admin/users')}>
                        <span>👥</span>
                        View Users
                    </button>
                    <button className="action-btn" onClick={() => navigate('/admin/settings')}>
                        <span>⚙️</span>
                        API Settings
                    </button>
                </div>
            </div>
        </div>
    );
}

