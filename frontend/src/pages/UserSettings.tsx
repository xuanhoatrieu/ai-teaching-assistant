import { useState, useEffect } from 'react';
import { api, API_BASE_URL } from '../lib/api';
import { UserTTSDictionary } from '../components/UserTTSDictionary';
import './UserSettings.css';

interface UserApiKey {
    id: string;
    name: string;
    service: 'GEMINI' | 'GOOGLE_CLOUD_TTS' | 'IMAGEN' | 'VBEE' | 'VITTS';
    hasKey: boolean;
    createdAt: string;
}

type APIService = 'GEMINI' | 'GOOGLE_CLOUD_TTS' | 'IMAGEN' | 'VBEE' | 'VITTS';

interface AvailableModel {
    name: string;
    displayName: string;
    description?: string;
    supportedTasks: string[];
}

interface ModelConfig {
    provider: string;
    modelName: string;
}

interface UserTemplate {
    id: string;
    name: string;
    description?: string;
    titleBgUrl?: string;
    contentBgUrl?: string;
    createdAt: string;
}

const TASK_TYPE_INFO: Record<string, { icon: string; label: string; desc: string }> = {
    OUTLINE: { icon: '📋', label: 'Tạo Outline', desc: 'Chuyển đổi outline thô thành chi tiết' },
    SLIDES: { icon: '🎨', label: 'Kịch Bản Slide', desc: 'Tạo nội dung và speaker notes' },
    QUESTIONS: { icon: '❓', label: 'Ngân Hàng Câu Hỏi', desc: 'Tạo câu hỏi trắc nghiệm' },
    IMAGE: { icon: '🖼️', label: 'Tạo Hình Ảnh', desc: 'Hình minh họa cho slide' },
    TTS: { icon: '🔊', label: 'Text-to-Speech', desc: 'Giọng đọc cho presentation' },
};

// My Templates Section Component
function MyTemplatesSection() {
    const [templates, setTemplates] = useState<UserTemplate[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isUploading, setIsUploading] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [error, setError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');
    const [templateName, setTemplateName] = useState('');
    const [templateDesc, setTemplateDesc] = useState('');
    const [titleBgFile, setTitleBgFile] = useState<File | null>(null);
    const [contentBgFile, setContentBgFile] = useState<File | null>(null);
    const [titleBgPreview, setTitleBgPreview] = useState<string | null>(null);
    const [contentBgPreview, setContentBgPreview] = useState<string | null>(null);

    useEffect(() => {
        fetchTemplates();
    }, []);

    const fetchTemplates = async () => {
        try {
            const res = await api.get('/user/templates');
            setTemplates(res.data);
        } catch (err: any) {
            setError('Không thể tải danh sách mẫu');
        } finally {
            setIsLoading(false);
        }
    };

    const handleTitleBgChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setTitleBgFile(file);
            setTitleBgPreview(URL.createObjectURL(file));
        }
    };

    const handleContentBgChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setContentBgFile(file);
            setContentBgPreview(URL.createObjectURL(file));
        }
    };

    const handleUpload = async () => {
        if (!titleBgFile || !contentBgFile || !templateName) {
            setError('Vui lòng chọn cả 2 ảnh nền và nhập tên mẫu');
            return;
        }

        setIsUploading(true);
        setError('');

        const formData = new FormData();
        formData.append('titleBg', titleBgFile);
        formData.append('contentBg', contentBgFile);
        formData.append('name', templateName);
        formData.append('description', templateDesc);

        try {
            const token = localStorage.getItem('accessToken');
            const res = await fetch(`${API_BASE_URL}/user/templates/upload`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData,
            });

            if (!res.ok) throw new Error('Upload failed');

            setSuccessMsg('Đã tải lên mẫu thành công!');
            closeModal();
            fetchTemplates();
        } catch (err: any) {
            setError(err.message || 'Lỗi khi tải lên');
        } finally {
            setIsUploading(false);
        }
    };

    const closeModal = () => {
        setShowModal(false);
        setTemplateName('');
        setTemplateDesc('');
        setTitleBgFile(null);
        setContentBgFile(null);
        setTitleBgPreview(null);
        setContentBgPreview(null);
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm('Bạn có chắc muốn xóa mẫu này?')) return;
        try {
            await api.delete(`/user/templates/${id}`);
            setSuccessMsg('Đã xóa mẫu!');
            fetchTemplates();
        } catch (err: any) {
            setError(err.response?.data?.message || 'Lỗi khi xóa');
        }
    };

    if (isLoading) {
        return <section className="settings-section"><p>Đang tải...</p></section>;
    }

    return (
        <section className="settings-section">
            <div className="section-header">
                <div>
                    <h2>📑 Mẫu PPTX cá nhân</h2>
                    <p className="section-desc">
                        Upload 2 ảnh nền (Title + Content) để làm mẫu PowerPoint
                    </p>
                </div>
                <button className="btn-add" onClick={() => setShowModal(true)}>
                    + Thêm Mẫu
                </button>
            </div>

            {error && <div className="settings-message error">{error}</div>}
            {successMsg && <div className="settings-message success">{successMsg}</div>}

            {templates.length === 0 ? (
                <div className="empty-keys">
                    <span>📑</span>
                    <p>Bạn chưa có mẫu PPTX cá nhân nào</p>
                    <small>Upload 2 ảnh nền để tạo mẫu riêng</small>
                </div>
            ) : (
                <div className="user-keys-list">
                    {templates.map(t => (
                        <div key={t.id} className="user-key-item template-item">
                            <div className="template-previews">
                                {t.titleBgUrl && (
                                    <img src={`${API_BASE_URL}${t.titleBgUrl}`} alt="Title BG" title="Ảnh nền Title" />
                                )}
                                {t.contentBgUrl && (
                                    <img src={`${API_BASE_URL}${t.contentBgUrl}`} alt="Content BG" title="Ảnh nền Content" />
                                )}
                            </div>
                            <div className="key-details">
                                <strong>{t.name}</strong>
                                <span>{t.description || 'Không có mô tả'}</span>
                            </div>
                            <div className="key-actions">
                                <button onClick={() => handleDelete(t.id)}>🗑️</button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Upload Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={closeModal}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Thêm Mẫu PPTX</h2>
                            <button className="modal-close" onClick={closeModal}>×</button>
                        </div>
                        <div className="form-group">
                            <label>Tên mẫu *</label>
                            <input
                                type="text"
                                value={templateName}
                                onChange={e => setTemplateName(e.target.value)}
                                placeholder="VD: Mẫu bài giảng xanh"
                            />
                        </div>
                        <div className="form-group">
                            <label>Mô tả</label>
                            <input
                                type="text"
                                value={templateDesc}
                                onChange={e => setTemplateDesc(e.target.value)}
                                placeholder="Mô tả ngắn về mẫu"
                            />
                        </div>
                        <div className="form-group">
                            <label>Ảnh nền Title (16:9) *</label>
                            <div className="image-upload-box">
                                {titleBgPreview ? (
                                    <img src={titleBgPreview} alt="Title preview" />
                                ) : (
                                    <span className="placeholder">📷 Chọn ảnh</span>
                                )}
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={handleTitleBgChange}
                                />
                            </div>
                        </div>
                        <div className="form-group">
                            <label>Ảnh nền Content (16:9) *</label>
                            <div className="image-upload-box">
                                {contentBgPreview ? (
                                    <img src={contentBgPreview} alt="Content preview" />
                                ) : (
                                    <span className="placeholder">📷 Chọn ảnh</span>
                                )}
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={handleContentBgChange}
                                />
                            </div>
                        </div>
                        <div className="modal-actions">
                            <button type="button" className="btn-cancel" onClick={closeModal}>
                                Hủy
                            </button>
                            <button
                                className="btn-save"
                                onClick={handleUpload}
                                disabled={!templateName || !titleBgFile || !contentBgFile || isUploading}
                            >
                                {isUploading ? 'Đang tải...' : 'Tải lên'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}

function ModelConfigSection({ serviceStatus }: { serviceStatus: Record<string, boolean> }) {
    const [configs, setConfigs] = useState<Record<string, ModelConfig>>({});
    const [availableModels, setAvailableModels] = useState<Record<string, AvailableModel[]>>({});
    const [taskTypes, setTaskTypes] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isDiscovering, setIsDiscovering] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        fetchConfigs();
    }, []);

    const fetchConfigs = async () => {
        try {
            setIsLoading(true);
            const res = await api.get('/user/model-config');
            setConfigs(res.data.configs);
            setTaskTypes(res.data.taskTypes);
        } catch (err: any) {
            setError('Không thể tải cấu hình model');
        } finally {
            setIsLoading(false);
        }
    };

    const discoverModels = async () => {
        if (!serviceStatus['GEMINI']) {
            setError('Vui lòng cấu hình Gemini API Key trước');
            return;
        }
        try {
            setIsDiscovering(true);
            setError('');
            const res = await api.get('/user/model-config/discover');
            setAvailableModels(res.data.models);
            setMessage('Đã tìm thấy các model khả dụng!');
        } catch (err: any) {
            setError(err.response?.data?.message || 'Không thể kết nối để lấy danh sách model');
        } finally {
            setIsDiscovering(false);
        }
    };

    const handleModelChange = (taskType: string, modelName: string) => {
        // Determine provider based on model name prefix
        let provider = 'GEMINI';
        if (modelName.startsWith('cliproxy:')) provider = 'CLIPROXY';
        else if (modelName.startsWith('vitts:')) provider = 'VITTS';
        else if (modelName.startsWith('vbee:')) provider = 'VBEE';
        else if (modelName.includes('imagen')) provider = 'IMAGEN';
        else if (modelName.includes('Neural') || modelName.includes('vi-VN')) provider = 'GOOGLE_TTS';

        setConfigs(prev => ({
            ...prev,
            [taskType]: { provider, modelName }
        }));
    };

    const saveConfigs = async () => {
        try {
            setIsSaving(true);
            setError('');
            const configsToSave = Object.entries(configs).map(([taskType, config]) => ({
                taskType,
                provider: config.provider,
                modelName: config.modelName,
            }));
            await api.post('/user/model-config/bulk', { configs: configsToSave });
            setMessage('Đã lưu cấu hình model!');
        } catch (err: any) {
            setError(err.response?.data?.message || 'Lỗi khi lưu');
        } finally {
            setIsSaving(false);
        }
    };

    const getModelsForTask = (taskType: string): AvailableModel[] => {
        // Merge models from ALL providers: GEMINI, CLIPROXY, VITTS, VBEE
        const allModels: AvailableModel[] = [
            ...(availableModels.GEMINI || []),
            ...(availableModels.CLIPROXY || []),
            ...(availableModels.VITTS || []),
            ...(availableModels.VBEE || []),
        ];
        return allModels.filter(model => model.supportedTasks.includes(taskType));
    };

    if (isLoading) {
        return <section className="settings-section"><p>Đang tải...</p></section>;
    }

    return (
        <section className="settings-section">
            <div className="section-header">
                <div>
                    <h2>🤖 Cấu hình Model AI</h2>
                    <p className="section-desc">
                        Chọn model AI cho từng tác vụ. Model mạnh hơn cho kết quả tốt hơn nhưng chậm hơn.
                    </p>
                </div>
                <button
                    className="btn-discover"
                    onClick={discoverModels}
                    disabled={isDiscovering || !serviceStatus['GEMINI']}
                >
                    {isDiscovering ? '⏳ Đang kiểm tra...' : '🔍 Khám phá Models'}
                </button>
            </div>

            {error && <div className="settings-message error">{error}</div>}
            {message && <div className="settings-message success">{message}</div>}

            <div className="model-config-grid">
                {taskTypes.map(taskType => {
                    const info = TASK_TYPE_INFO[taskType] || { icon: '⚙️', label: taskType, desc: '' };
                    const currentConfig = configs[taskType] || { provider: '', modelName: '' };
                    const models = getModelsForTask(taskType);

                    return (
                        <div key={taskType} className="model-config-card">
                            <div className="model-task-info">
                                <span className="task-icon">{info.icon}</span>
                                <div>
                                    <strong>{info.label}</strong>
                                    <small>{info.desc}</small>
                                </div>
                            </div>
                            <select
                                value={currentConfig.modelName}
                                onChange={(e) => handleModelChange(taskType, e.target.value)}
                                disabled={models.length === 0}
                            >
                                {models.length === 0 ? (
                                    <option value={currentConfig.modelName}>
                                        {currentConfig.modelName || 'Nhấn "Khám phá Models"'}
                                    </option>
                                ) : (
                                    models.map(model => (
                                        <option key={model.name} value={model.name}>
                                            {model.displayName}
                                        </option>
                                    ))
                                )}
                            </select>
                        </div>
                    );
                })}
            </div>

            <div className="model-config-actions">
                <button
                    className="btn-save-config"
                    onClick={saveConfigs}
                    disabled={isSaving}
                >
                    {isSaving ? '⏳ Đang lưu...' : '💾 Lưu Cấu Hình'}
                </button>
            </div>
        </section>
    );
}

const SERVICE_OPTIONS = [
    { value: 'GEMINI' as APIService, label: 'Gemini AI', icon: '🤖', desc: 'Tạo nội dung, hình ảnh, giọng nói' },
    { value: 'VBEE' as APIService, label: 'Vbee TTS', icon: '🇻🇳', desc: 'Giọng đọc tiếng Việt chất lượng cao' },
    { value: 'VITTS' as APIService, label: 'ViTTS Local', icon: '🎙️', desc: 'Giọng đọc tiếng Việt local server' },
    { value: 'GOOGLE_CLOUD_TTS' as APIService, label: 'Google Cloud TTS', icon: '🔊', desc: 'Giọng đọc đa ngôn ngữ' },
    { value: 'IMAGEN' as APIService, label: 'Imagen', icon: '🖼️', desc: 'Tạo hình ảnh minh họa' },
];

export function UserSettingsPage() {
    const [keys, setKeys] = useState<UserApiKey[]>([]);
    const [serviceStatus, setServiceStatus] = useState<Record<string, boolean>>({});
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [editingKey, setEditingKey] = useState<UserApiKey | null>(null);
    const [formData, setFormData] = useState<{
        name: string;
        service: APIService;
        key: string;
        vbeeToken: string;
        vbeeAppId: string;
        vittsApiKey: string;
        vittsBaseUrl: string;
    }>({
        name: '',
        service: 'GEMINI',
        key: '',
        vbeeToken: '',
        vbeeAppId: '',
        vittsApiKey: '',
        vittsBaseUrl: 'http://117.0.36.6:8000',
    });

    const fetchData = async () => {
        try {
            setIsLoading(true);
            const [keysRes, ...statusRes] = await Promise.all([
                api.get('/user/api-keys'),
                ...SERVICE_OPTIONS.map(s => api.get(`/user/api-keys/check/${s.value}`))
            ]);
            setKeys(keysRes.data);

            const status: Record<string, boolean> = {};
            statusRes.forEach((res: { data: { hasKey: boolean } }, idx: number) => {
                status[SERVICE_OPTIONS[idx].value] = res.data.hasKey;
            });
            setServiceStatus(status);
        } catch (err: any) {
            setError(err.response?.data?.message || 'Không thể tải cài đặt');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const handleOpenModal = (key?: UserApiKey) => {
        if (key) {
            setEditingKey(key);
            setFormData({ name: key.name, service: key.service, key: '', vbeeToken: '', vbeeAppId: '', vittsApiKey: '', vittsBaseUrl: 'http://117.0.36.6:8000' });
        } else {
            setEditingKey(null);
            setFormData({ name: '', service: 'GEMINI', key: '', vbeeToken: '', vbeeAppId: '', vittsApiKey: '', vittsBaseUrl: 'http://117.0.36.6:8000' });
        }
        setShowModal(true);
    };

    const handleCloseModal = () => {
        setShowModal(false);
        setEditingKey(null);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccessMsg('');

        // For Vbee, combine token and appId into JSON
        let keyToSubmit = formData.key;
        if (formData.service === 'VBEE') {
            if (!formData.vbeeToken || !formData.vbeeAppId) {
                setError('Vui lòng nhập cả Vbee Token và App ID');
                return;
            }
            keyToSubmit = JSON.stringify({
                token: formData.vbeeToken,
                appId: formData.vbeeAppId
            });
        } else if (formData.service === 'VITTS') {
            if (!formData.vittsApiKey) {
                setError('Vui lòng nhập ViTTS API Key');
                return;
            }
            keyToSubmit = JSON.stringify({
                apiKey: formData.vittsApiKey,
                baseUrl: formData.vittsBaseUrl || 'http://117.0.36.6:8000'
            });
        }

        try {
            if (editingKey) {
                await api.put(`/user/api-keys/${editingKey.id}`, {
                    name: formData.name,
                    key: keyToSubmit || undefined,
                });
                setSuccessMsg('Đã cập nhật API Key!');
            } else {
                await api.post('/user/api-keys', {
                    name: formData.name,
                    service: formData.service,
                    key: keyToSubmit
                });
                setSuccessMsg('Đã thêm API Key mới!');
            }
            handleCloseModal();
            fetchData();
        } catch (err: any) {
            setError(err.response?.data?.message || 'Lỗi khi lưu');
        }
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm('Bạn có chắc muốn xóa API Key này?')) return;
        try {
            await api.delete(`/user/api-keys/${id}`);
            setSuccessMsg('Đã xóa API Key!');
            fetchData();
        } catch (err: any) {
            setError(err.response?.data?.message || 'Lỗi khi xóa');
        }
    };

    const getServiceInfo = (service: string) => {
        return SERVICE_OPTIONS.find(s => s.value === service) || { label: service, icon: '🔑', desc: '' };
    };

    if (isLoading) {
        return <div className="user-settings loading">Đang tải...</div>;
    }

    return (
        <div className="user-settings">
            <div className="settings-header">
                <h1>⚙️ Cài đặt</h1>
                <p>Quản lý API Keys cá nhân của bạn</p>
            </div>

            {error && <div className="settings-message error">{error}</div>}
            {successMsg && <div className="settings-message success">{successMsg}</div>}

            {/* Service Status Cards */}
            <section className="settings-section">
                <h2>Trạng thái dịch vụ</h2>
                <p className="section-desc">
                    Các dịch vụ có thể sử dụng key hệ thống hoặc key cá nhân của bạn
                </p>
                <div className="service-status-grid">
                    {SERVICE_OPTIONS.map(service => (
                        <div key={service.value} className="service-status-card">
                            <span className="service-icon">{service.icon}</span>
                            <div className="service-info">
                                <h3>{service.label}</h3>
                                <p>{service.desc}</p>
                            </div>
                            <span className={`status-badge ${serviceStatus[service.value] ? 'ready' : 'unavailable'}`}>
                                {serviceStatus[service.value] ? '✓ Sẵn sàng' : '✗ Chưa cấu hình'}
                            </span>
                        </div>
                    ))}
                </div>
            </section>

            {/* User's API Keys */}
            <section className="settings-section">
                <div className="section-header">
                    <div>
                        <h2>API Keys cá nhân</h2>
                        <p className="section-desc">
                            Key cá nhân sẽ được ưu tiên sử dụng thay vì key hệ thống
                        </p>
                    </div>
                    <button className="btn-add" onClick={() => handleOpenModal()}>
                        + Thêm Key
                    </button>
                </div>

                {keys.length === 0 ? (
                    <div className="empty-keys">
                        <span>🔑</span>
                        <p>Bạn chưa có API Key cá nhân nào</p>
                        <small>Thêm key để sử dụng quota riêng của bạn</small>
                    </div>
                ) : (
                    <div className="user-keys-list">
                        {keys.map(key => {
                            const info = getServiceInfo(key.service);
                            return (
                                <div key={key.id} className="user-key-item">
                                    <span className="key-icon">{info.icon}</span>
                                    <div className="key-details">
                                        <strong>{key.name}</strong>
                                        <span>{info.label}</span>
                                    </div>
                                    <div className="key-actions">
                                        <button onClick={() => handleOpenModal(key)}>✏️</button>
                                        <button onClick={() => handleDelete(key.id)}>🗑️</button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            {/* Model Configuration Section */}
            <ModelConfigSection serviceStatus={serviceStatus} />

            {/* My Templates Section */}
            <MyTemplatesSection />

            {/* TTS Dictionary Section */}
            <UserTTSDictionary />

            {/* Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={handleCloseModal}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>{editingKey ? 'Sửa API Key' : 'Thêm API Key'}</h2>
                            <button className="modal-close" onClick={handleCloseModal}>×</button>
                        </div>
                        <form onSubmit={handleSubmit}>
                            <div className="form-group">
                                <label>Tên gợi nhớ</label>
                                <input
                                    type="text"
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="VD: My Gemini Key"
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>Dịch vụ</label>
                                <select
                                    value={formData.service}
                                    onChange={e => setFormData({ ...formData, service: e.target.value as any })}
                                    disabled={!!editingKey}
                                >
                                    {SERVICE_OPTIONS.map(opt => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.icon} {opt.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Show different fields based on service */}
                            {formData.service === 'VBEE' ? (
                                <>
                                    <div className="form-group">
                                        <label>Vbee Token {editingKey && '(để trống nếu không đổi)'}</label>
                                        <input
                                            type="password"
                                            value={formData.vbeeToken}
                                            onChange={e => setFormData({ ...formData, vbeeToken: e.target.value })}
                                            placeholder="Nhập Vbee Bearer Token"
                                            required={!editingKey}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Vbee App ID {editingKey && '(để trống nếu không đổi)'}</label>
                                        <input
                                            type="text"
                                            value={formData.vbeeAppId}
                                            onChange={e => setFormData({ ...formData, vbeeAppId: e.target.value })}
                                            placeholder="Nhập App ID từ Vbee"
                                            required={!editingKey}
                                        />
                                    </div>
                                </>
                            ) : formData.service === 'VITTS' ? (
                                <>
                                    <div className="form-group">
                                        <label>ViTTS API Key {editingKey && '(để trống nếu không đổi)'}</label>
                                        <input
                                            type="password"
                                            value={formData.vittsApiKey}
                                            onChange={e => setFormData({ ...formData, vittsApiKey: e.target.value })}
                                            placeholder="vitts_xxxxxxxxxxxx"
                                            required={!editingKey}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>ViTTS Base URL</label>
                                        <input
                                            type="text"
                                            value={formData.vittsBaseUrl}
                                            onChange={e => setFormData({ ...formData, vittsBaseUrl: e.target.value })}
                                            placeholder="http://117.0.36.6:8000"
                                        />
                                    </div>
                                </>
                            ) : (
                                <div className="form-group">
                                    <label>API Key {editingKey && '(để trống nếu không đổi)'}</label>
                                    <input
                                        type="password"
                                        value={formData.key}
                                        onChange={e => setFormData({ ...formData, key: e.target.value })}
                                        placeholder={editingKey ? '••••••••' : 'Nhập API Key'}
                                        required={!editingKey}
                                    />
                                </div>
                            )}
                            <div className="modal-actions">
                                <button type="button" className="btn-cancel" onClick={handleCloseModal}>
                                    Hủy
                                </button>
                                <button type="submit" className="btn-save">
                                    {editingKey ? 'Cập nhật' : 'Thêm'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
