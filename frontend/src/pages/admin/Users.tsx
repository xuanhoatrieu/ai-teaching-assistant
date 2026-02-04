import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import './AdminPage.css';

interface User {
    id: string;
    email: string;
    role: 'ADMIN' | 'USER';
    createdAt: string;
}

export function UsersPage() {
    const [users, setUsers] = useState<User[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

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

    if (isLoading) {
        return <div className="admin-page loading">Loading...</div>;
    }

    return (
        <div className="admin-page">
            <div className="page-header">
                <div>
                    <h1>Users</h1>
                    <p>View and manage users</p>
                </div>
            </div>

            {error && <div className="error-banner">{error}</div>}

            <div className="data-table">
                <table>
                    <thead>
                        <tr>
                            <th>Email</th>
                            <th>Role</th>
                            <th>Created</th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.length === 0 ? (
                            <tr>
                                <td colSpan={3} className="empty-state">No users found</td>
                            </tr>
                        ) : (
                            users.map((user) => (
                                <tr key={user.id}>
                                    <td>{user.email}</td>
                                    <td>
                                        <span className={`role-badge ${user.role.toLowerCase()}`}>
                                            {user.role}
                                        </span>
                                    </td>
                                    <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
