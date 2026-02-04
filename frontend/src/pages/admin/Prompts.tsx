import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import './AdminPage.css';

interface Prompt {
    id: string;
    slug: string;
    name: string;
    content: string;
    variables: string[];
    isActive: boolean;
    version: number;
}

interface PromptForm {
    slug: string;
    name: string;
    content: string;
    isActive: boolean;
}

const initialForm: PromptForm = {
    slug: '',
    name: '',
    content: '',
    isActive: true,
};

export function PromptsPage() {
    const [prompts, setPrompts] = useState<Prompt[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
    const [form, setForm] = useState<PromptForm>(initialForm);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        fetchPrompts();
    }, []);

    const fetchPrompts = async () => {
        try {
            const response = await api.get('/admin/prompts');
            setPrompts(response.data);
        } catch (err: any) {
            setError(err.response?.data?.message || 'Failed to load prompts');
        } finally {
            setIsLoading(false);
        }
    };

    const openAddModal = () => {
        setEditingPrompt(null);
        setForm(initialForm);
        setShowModal(true);
    };

    const openEditModal = (prompt: Prompt) => {
        setEditingPrompt(prompt);
        setForm({
            slug: prompt.slug,
            name: prompt.name,
            content: prompt.content,
            isActive: prompt.isActive,
        });
        setShowModal(true);
    };

    const closeModal = () => {
        setShowModal(false);
        setEditingPrompt(null);
        setForm(initialForm);
        setError('');
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        setError('');

        try {
            if (editingPrompt) {
                await api.patch(`/admin/prompts/${editingPrompt.id}`, form);
            } else {
                await api.post('/admin/prompts', form);
            }
            await fetchPrompts();
            closeModal();
        } catch (err: any) {
            setError(err.response?.data?.message || 'Failed to save prompt');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this prompt?')) return;

        try {
            await api.delete(`/admin/prompts/${id}`);
            await fetchPrompts();
        } catch (err: any) {
            setError(err.response?.data?.message || 'Failed to delete prompt');
        }
    };

    const handleToggleActive = async (prompt: Prompt) => {
        try {
            await api.patch(`/admin/prompts/${prompt.id}`, { isActive: !prompt.isActive });
            await fetchPrompts();
        } catch (err: any) {
            setError(err.response?.data?.message || 'Failed to update prompt');
        }
    };

    if (isLoading) {
        return <div className="admin-page loading">Loading...</div>;
    }

    return (
        <div className="admin-page">
            <div className="page-header">
                <div>
                    <h1>Prompts Management</h1>
                    <p>Manage AI generation prompts</p>
                </div>
                <button className="primary-btn" onClick={openAddModal}>+ Add Prompt</button>
            </div>

            {error && <div className="error-banner">{error}</div>}

            <div className="data-table">
                <table>
                    <thead>
                        <tr>
                            <th>Slug</th>
                            <th>Name</th>
                            <th>Variables</th>
                            <th>Version</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {prompts.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="empty-state">No prompts found</td>
                            </tr>
                        ) : (
                            prompts.map((prompt) => (
                                <tr key={prompt.id}>
                                    <td><code>{prompt.slug}</code></td>
                                    <td>{prompt.name}</td>
                                    <td>
                                        {prompt.variables.map((v) => (
                                            <span key={v} className="tag">{v}</span>
                                        ))}
                                    </td>
                                    <td>v{prompt.version}</td>
                                    <td>
                                        <span
                                            className={`status ${prompt.isActive ? 'active' : 'inactive'}`}
                                            onClick={() => handleToggleActive(prompt)}
                                            style={{ cursor: 'pointer' }}
                                            title="Click to toggle"
                                        >
                                            {prompt.isActive ? 'Active' : 'Inactive'}
                                        </span>
                                    </td>
                                    <td>
                                        <button className="icon-btn" onClick={() => openEditModal(prompt)} title="Edit">✏️</button>
                                        <button className="icon-btn danger" onClick={() => handleDelete(prompt.id)} title="Delete">🗑️</button>
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
                            <h2>{editingPrompt ? 'Edit Prompt' : 'Add New Prompt'}</h2>
                            <button className="close-btn" onClick={closeModal}>×</button>
                        </div>
                        <form onSubmit={handleSubmit}>
                            <div className="form-group">
                                <label>Slug</label>
                                <input
                                    type="text"
                                    value={form.slug}
                                    onChange={(e) => setForm({ ...form, slug: e.target.value })}
                                    placeholder="e.g., pptx_content"
                                    required
                                    disabled={!!editingPrompt}
                                />
                                <small>Unique identifier (cannot change after creation)</small>
                            </div>
                            <div className="form-group">
                                <label>Name</label>
                                <input
                                    type="text"
                                    value={form.name}
                                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                                    placeholder="e.g., PPTX Content Generator"
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>Content</label>
                                <textarea
                                    value={form.content}
                                    onChange={(e) => setForm({ ...form, content: e.target.value })}
                                    placeholder="Prompt content with variables like {title}, {content}..."
                                    required
                                    rows={10}
                                />
                                <small>Use curly braces for variables: {'{variable_name}'}</small>
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
                                    {isSaving ? 'Saving...' : (editingPrompt ? 'Update' : 'Create')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

