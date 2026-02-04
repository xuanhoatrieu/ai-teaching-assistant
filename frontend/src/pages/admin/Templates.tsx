import { useState, useEffect, useRef } from 'react';
import { adminTemplatesApi, type PPTXTemplate } from '../../lib/templates-api';
import './Templates.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

export function TemplatesPage() {
    const [templates, setTemplates] = useState<PPTXTemplate[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [editingTemplate, setEditingTemplate] = useState<PPTXTemplate | null>(null);

    // 2-image upload state
    const [titleBgFile, setTitleBgFile] = useState<File | null>(null);
    const [contentBgFile, setContentBgFile] = useState<File | null>(null);
    const [titleBgPreview, setTitleBgPreview] = useState<string | null>(null);
    const [contentBgPreview, setContentBgPreview] = useState<string | null>(null);

    const titleBgInputRef = useRef<HTMLInputElement>(null);
    const contentBgInputRef = useRef<HTMLInputElement>(null);

    const [formData, setFormData] = useState({
        name: '',
        description: '',
        isDefault: false,
    });

    useEffect(() => {
        loadTemplates();
    }, []);

    const loadTemplates = async () => {
        try {
            const response = await adminTemplatesApi.getAll();
            setTemplates(response.data);
        } catch (err: any) {
            setError(err.response?.data?.message || 'Failed to load templates');
        } finally {
            setIsLoading(false);
        }
    };

    const handleFileChange = (type: 'titleBg' | 'contentBg', file: File | null) => {
        if (type === 'titleBg') {
            setTitleBgFile(file);
            if (file) {
                const url = URL.createObjectURL(file);
                setTitleBgPreview(url);
            } else {
                setTitleBgPreview(null);
            }
        } else {
            setContentBgFile(file);
            if (file) {
                const url = URL.createObjectURL(file);
                setContentBgPreview(url);
            } else {
                setContentBgPreview(null);
            }
        }
    };

    const handleSubmit = async () => {
        try {
            setIsUploading(true);

            if (editingTemplate) {
                // Update existing template
                await adminTemplatesApi.update(editingTemplate.id, formData);
            } else if (titleBgFile && contentBgFile) {
                // Create new template with 2 images
                const data = new FormData();
                data.append('titleBg', titleBgFile);
                data.append('contentBg', contentBgFile);
                data.append('name', formData.name);
                data.append('description', formData.description || '');
                data.append('isDefault', String(formData.isDefault));

                await adminTemplatesApi.upload(data);
            } else {
                setError('Please select both title and content background images');
                setIsUploading(false);
                return;
            }

            setShowModal(false);
            resetForm();
            loadTemplates();
        } catch (err: any) {
            setError(err.response?.data?.message || err.message || 'Operation failed');
        } finally {
            setIsUploading(false);
        }
    };

    const handleEdit = (template: PPTXTemplate) => {
        setEditingTemplate(template);
        setFormData({
            name: template.name,
            description: template.description || '',
            isDefault: template.isDefault,
        });
        setTitleBgFile(null);
        setContentBgFile(null);
        // Set previews from existing URLs
        setTitleBgPreview(template.titleBgUrl ? `${API_BASE}${template.titleBgUrl}` : null);
        setContentBgPreview(template.contentBgUrl ? `${API_BASE}${template.contentBgUrl}` : null);
        setShowModal(true);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this template?')) return;
        try {
            await adminTemplatesApi.delete(id);
            loadTemplates();
        } catch (err: any) {
            setError(err.response?.data?.message || 'Delete failed');
        }
    };

    const handleToggle = async (id: string) => {
        try {
            await adminTemplatesApi.toggle(id);
            loadTemplates();
        } catch (err: any) {
            setError(err.response?.data?.message || 'Toggle failed');
        }
    };

    const resetForm = () => {
        setEditingTemplate(null);
        setTitleBgFile(null);
        setContentBgFile(null);
        setTitleBgPreview(null);
        setContentBgPreview(null);
        setFormData({
            name: '',
            description: '',
            isDefault: false,
        });
        if (titleBgInputRef.current) titleBgInputRef.current.value = '';
        if (contentBgInputRef.current) contentBgInputRef.current.value = '';
    };

    const openCreateModal = () => {
        resetForm();
        setShowModal(true);
    };

    if (isLoading) {
        return <div className="loading-state">Loading templates...</div>;
    }

    return (
        <div className="templates-page">
            <div className="page-header">
                <h1>📊 PPTX Templates</h1>
                <button className="primary-btn" onClick={openCreateModal}>
                    + Add Template
                </button>
            </div>

            {error && <div className="error-banner">{error}</div>}

            <div className="templates-table">
                <table>
                    <thead>
                        <tr>
                            <th>Title BG</th>
                            <th>Content BG</th>
                            <th>Name</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {templates.map((tpl) => (
                            <tr key={tpl.id}>
                                <td>
                                    <div className="preview-thumb">
                                        {tpl.titleBgUrl ? (
                                            <img src={`${API_BASE}${tpl.titleBgUrl}`} alt="Title BG" />
                                        ) : (
                                            <span>🖼️</span>
                                        )}
                                    </div>
                                </td>
                                <td>
                                    <div className="preview-thumb">
                                        {tpl.contentBgUrl ? (
                                            <img src={`${API_BASE}${tpl.contentBgUrl}`} alt="Content BG" />
                                        ) : (
                                            <span>🖼️</span>
                                        )}
                                    </div>
                                </td>
                                <td>
                                    <div className="tpl-name">
                                        {tpl.name}
                                        {tpl.isDefault && <span className="default-tag">Default</span>}
                                    </div>
                                    {tpl.description && <small>{tpl.description}</small>}
                                </td>
                                <td>
                                    <span className={`status-badge ${tpl.isActive ? 'active' : 'inactive'}`}>
                                        {tpl.isActive ? 'Active' : 'Inactive'}
                                    </span>
                                </td>
                                <td>
                                    <div className="actions">
                                        <button onClick={() => handleEdit(tpl)}>✏️</button>
                                        <button onClick={() => handleToggle(tpl.id)}>
                                            {tpl.isActive ? '🔒' : '🔓'}
                                        </button>
                                        <button onClick={() => handleDelete(tpl.id)}>🗑️</button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>

                {templates.length === 0 && (
                    <div className="empty-state">
                        <p>No templates yet. Add your first template!</p>
                    </div>
                )}
            </div>

            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal template-modal" onClick={(e) => e.stopPropagation()}>
                        <h2>{editingTemplate ? 'Edit Template' : 'Create New Template'}</h2>

                        <div className="form-group">
                            <label>Name *</label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                placeholder="e.g., TUAF Green"
                            />
                        </div>

                        <div className="form-group">
                            <label>Description</label>
                            <input
                                type="text"
                                value={formData.description}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                placeholder="Optional description"
                            />
                        </div>

                        {!editingTemplate && (
                            <div className="image-upload-row">
                                <div className="image-upload-group">
                                    <label>Title Slide Background *</label>
                                    <div className="image-preview-box">
                                        {titleBgPreview ? (
                                            <img src={titleBgPreview} alt="Title BG Preview" />
                                        ) : (
                                            <span className="placeholder">🖼️ Click to select</span>
                                        )}
                                    </div>
                                    <input
                                        ref={titleBgInputRef}
                                        type="file"
                                        accept="image/*"
                                        onChange={(e) => handleFileChange('titleBg', e.target.files?.[0] || null)}
                                    />
                                </div>
                                <div className="image-upload-group">
                                    <label>Content Slide Background *</label>
                                    <div className="image-preview-box">
                                        {contentBgPreview ? (
                                            <img src={contentBgPreview} alt="Content BG Preview" />
                                        ) : (
                                            <span className="placeholder">🖼️ Click to select</span>
                                        )}
                                    </div>
                                    <input
                                        ref={contentBgInputRef}
                                        type="file"
                                        accept="image/*"
                                        onChange={(e) => handleFileChange('contentBg', e.target.files?.[0] || null)}
                                    />
                                </div>
                            </div>
                        )}

                        {editingTemplate && (
                            <div className="image-preview-row">
                                <div className="image-preview-group">
                                    <label>Current Title BG</label>
                                    <div className="image-preview-box">
                                        {titleBgPreview ? (
                                            <img src={titleBgPreview} alt="Title BG" />
                                        ) : (
                                            <span className="placeholder">No image</span>
                                        )}
                                    </div>
                                </div>
                                <div className="image-preview-group">
                                    <label>Current Content BG</label>
                                    <div className="image-preview-box">
                                        {contentBgPreview ? (
                                            <img src={contentBgPreview} alt="Content BG" />
                                        ) : (
                                            <span className="placeholder">No image</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="form-group checkbox">
                            <label>
                                <input
                                    type="checkbox"
                                    checked={formData.isDefault}
                                    onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                                />
                                Set as default template
                            </label>
                        </div>

                        <div className="modal-actions">
                            <button className="secondary-btn" onClick={() => setShowModal(false)}>
                                Cancel
                            </button>
                            <button
                                className="primary-btn"
                                onClick={handleSubmit}
                                disabled={!formData.name || (!editingTemplate && (!titleBgFile || !contentBgFile)) || isUploading}
                            >
                                {isUploading ? 'Uploading...' : (editingTemplate ? 'Save Changes' : 'Create Template')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
