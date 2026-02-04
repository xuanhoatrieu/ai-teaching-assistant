import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import './AdminPage.css';

interface TTSProvider {
    id: string;
    name: string;
    type: string;
    endpoint: string | null;
    requiredFields: string[];
    isActive: boolean;
    isSystem: boolean;
}

interface ProviderForm {
    name: string;
    type: string;
    endpoint: string;
    requiredFields: string;
    isActive: boolean;
}

const initialForm: ProviderForm = {
    name: '',
    type: 'GEMINI',
    endpoint: '',
    requiredFields: '',
    isActive: true,
};

const providerTypes = ['GEMINI', 'GOOGLE_CLOUD', 'VBEE', 'AZURE', 'AWS_POLLY'];

export function TTSProvidersPage() {
    const [providers, setProviders] = useState<TTSProvider[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [editingProvider, setEditingProvider] = useState<TTSProvider | null>(null);
    const [form, setForm] = useState<ProviderForm>(initialForm);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        fetchProviders();
    }, []);

    const fetchProviders = async () => {
        try {
            const response = await api.get('/admin/tts-providers');
            setProviders(response.data);
        } catch (err: any) {
            setError(err.response?.data?.message || 'Failed to load providers');
        } finally {
            setIsLoading(false);
        }
    };

    const openAddModal = () => {
        setEditingProvider(null);
        setForm(initialForm);
        setShowModal(true);
    };

    const openEditModal = (provider: TTSProvider) => {
        setEditingProvider(provider);
        setForm({
            name: provider.name,
            type: provider.type,
            endpoint: provider.endpoint || '',
            requiredFields: provider.requiredFields.join(', '),
            isActive: provider.isActive,
        });
        setShowModal(true);
    };

    const closeModal = () => {
        setShowModal(false);
        setEditingProvider(null);
        setForm(initialForm);
        setError('');
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        setError('');

        const payload = {
            name: form.name,
            type: form.type,
            endpoint: form.endpoint || null,
            requiredFields: form.requiredFields.split(',').map(f => f.trim()).filter(Boolean),
            isActive: form.isActive,
        };

        try {
            if (editingProvider) {
                await api.put(`/admin/tts-providers/${editingProvider.id}`, payload);
            } else {
                await api.post('/admin/tts-providers', payload);
            }
            await fetchProviders();
            closeModal();
        } catch (err: any) {
            setError(err.response?.data?.message || 'Failed to save provider');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this provider?')) return;

        try {
            await api.delete(`/admin/tts-providers/${id}`);
            await fetchProviders();
        } catch (err: any) {
            setError(err.response?.data?.message || 'Failed to delete provider');
        }
    };

    const handleToggleActive = async (provider: TTSProvider) => {
        try {
            await api.put(`/admin/tts-providers/${provider.id}`, {
                ...provider,
                isActive: !provider.isActive
            });
            await fetchProviders();
        } catch (err: any) {
            setError(err.response?.data?.message || 'Failed to update provider');
        }
    };

    if (isLoading) {
        return <div className="admin-page loading">Loading...</div>;
    }

    return (
        <div className="admin-page">
            <div className="page-header">
                <div>
                    <h1>TTS Providers</h1>
                    <p>Manage text-to-speech providers</p>
                </div>
                <button className="primary-btn" onClick={openAddModal}>+ Add Provider</button>
            </div>

            {error && <div className="error-banner">{error}</div>}

            <div className="data-table">
                <table>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Type</th>
                            <th>System</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {providers.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="empty-state">No providers found</td>
                            </tr>
                        ) : (
                            providers.map((provider) => (
                                <tr key={provider.id}>
                                    <td>{provider.name}</td>
                                    <td><code>{provider.type}</code></td>
                                    <td>{provider.isSystem ? '✓' : '-'}</td>
                                    <td>
                                        <span
                                            className={`status ${provider.isActive ? 'active' : 'inactive'}`}
                                            onClick={() => handleToggleActive(provider)}
                                            style={{ cursor: 'pointer' }}
                                            title="Click to toggle"
                                        >
                                            {provider.isActive ? 'Active' : 'Inactive'}
                                        </span>
                                    </td>
                                    <td>
                                        <button className="icon-btn" onClick={() => openEditModal(provider)} title="Edit">✏️</button>
                                        {!provider.isSystem && (
                                            <button className="icon-btn danger" onClick={() => handleDelete(provider.id)} title="Delete">🗑️</button>
                                        )}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Modal Form */}
            {showModal && (
                <div className="modal-overlay" onClick={closeModal}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>{editingProvider ? 'Edit Provider' : 'Add New Provider'}</h2>
                            <button className="close-btn" onClick={closeModal}>×</button>
                        </div>
                        <form onSubmit={handleSubmit}>
                            <div className="form-group">
                                <label>Name</label>
                                <input
                                    type="text"
                                    value={form.name}
                                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                                    placeholder="e.g., My Custom TTS"
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>Type</label>
                                <select
                                    value={form.type}
                                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                                    required
                                >
                                    {providerTypes.map(type => (
                                        <option key={type} value={type}>{type}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group">
                                <label>Endpoint (optional)</label>
                                <input
                                    type="text"
                                    value={form.endpoint}
                                    onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
                                    placeholder="e.g., https://api.example.com/tts"
                                />
                                <small>Custom API endpoint for this provider</small>
                            </div>
                            <div className="form-group">
                                <label>Required Fields</label>
                                <input
                                    type="text"
                                    value={form.requiredFields}
                                    onChange={(e) => setForm({ ...form, requiredFields: e.target.value })}
                                    placeholder="e.g., api_key, project_id"
                                />
                                <small>Comma-separated list of required configuration fields</small>
                            </div>
                            <div className="form-group checkbox-group">
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={form.isActive}
                                        onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                                    />
                                    Active
                                </label>
                            </div>
                            {error && <div className="form-error">{error}</div>}
                            <div className="modal-footer">
                                <button type="button" className="secondary-btn" onClick={closeModal}>Cancel</button>
                                <button type="submit" className="primary-btn" disabled={isSaving}>
                                    {isSaving ? 'Saving...' : (editingProvider ? 'Update' : 'Create')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

